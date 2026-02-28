import Constants from "expo-constants";
import { Platform } from "react-native";
import { PostComment } from "../api/rule34vault";

// ══════════════════════════════════════════════════════════════════════
// MASTER TOGGLE — set to true to enable spam filtering
// ══════════════════════════════════════════════════════════════════════
const SPAM_FILTER_ENABLED = false;

const PUSH_SERVER_URL = Constants.expoConfig?.extra?.pushServerUrl || "";
const BLOCKLIST_CACHE_KEY = "spam_blocklist_v1";
const BLOCKLIST_ETAG_KEY = "spam_blocklist_etag";

// Simple storage helper (localStorage on web, in-memory fallback on native)
const storage = {
  get: (key: string): string | null => {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      return localStorage.getItem(key);
    }
    return null;
  },
  set: (key: string, value: string): void => {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  },
};

// ── Configuration ────────────────────────────────────────────────────
const SIMILARITY_THRESHOLD = 0.75; // 75% similar = likely spam
const DUPLICATE_WINDOW_SIZE = 100; // Check last N comments for duplicates
const MIN_COMMENT_LENGTH = 2; // Ignore very short comments for similarity
const MAX_SPAM_RATIO = 0.4; // If >40% of recent comments are similar, flag them
const RAPID_POST_WINDOW_MS = 60_000; // 1 minute window for rapid posting
const RAPID_POST_LIMIT = 5; // Max comments per user in rapid window
const SPAM_URL_THRESHOLD = 2; // Comments with 2+ URLs are suspicious
const REPEATED_CHAR_THRESHOLD = 0.6; // 60%+ same character = spam

// ── String Similarity (Bigram / Dice coefficient) ────────────────────
function getBigrams(str: string): Set<string> {
  const s = str.toLowerCase().trim();
  const bigrams = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.add(s.slice(i, i + 2));
  }
  return bigrams;
}

function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);
  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

// ── Normalize text for comparison ────────────────────────────────────
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // strip punctuation
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

// ── Pattern-based spam checks ────────────────────────────────────────
function hasExcessiveUrls(text: string): boolean {
  const urlPattern = /https?:\/\/[^\s]+/gi;
  const matches = text.match(urlPattern);
  return (matches?.length ?? 0) >= SPAM_URL_THRESHOLD;
}

function hasRepeatedChars(text: string): boolean {
  if (text.length < 10) return false;
  const cleaned = text.replace(/\s/g, "");
  if (cleaned.length < 5) return false;
  const charCounts = new Map<string, number>();
  for (const ch of cleaned.toLowerCase()) {
    charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1);
  }
  const maxCount = Math.max(...charCounts.values());
  return maxCount / cleaned.length > REPEATED_CHAR_THRESHOLD;
}

function isGibberish(text: string): boolean {
  // Check for repeated word patterns like "buy buy buy" or "click here click here"
  const words = text.toLowerCase().split(/\s+/);
  if (words.length < 4) return false;
  const uniqueWords = new Set(words);
  return uniqueWords.size / words.length < 0.3; // Less than 30% unique words
}

// ── Individual comment spam score (0 = clean, 1 = definitely spam) ──
function getSpamScore(text: string): number {
  let score = 0;
  if (hasExcessiveUrls(text)) score += 0.4;
  if (hasRepeatedChars(text)) score += 0.3;
  if (isGibberish(text)) score += 0.3;
  return Math.min(score, 1);
}

// ── Main spam filter (cached) ────────────────────────────────────────
export interface SpamFilterResult {
  spamIds: Set<number>;
  spamCount: number;
}

class SpamDetector {
  // Caches
  private knownIds = new Set<number>();
  private normCache = new Map<number, string>();        // commentId -> normalized text
  private scoreCache = new Map<number, number>();        // commentId -> individual spam score
  private spamIds = new Set<number>();
  private contentGroups = new Map<string, PostComment[]>(); // groupKey -> comments in group
  private userTimestamps = new Map<number, { id: number; time: number }[]>();

  /** Reset all caches (call on full refresh) */
  reset() {
    this.knownIds.clear();
    this.normCache.clear();
    this.scoreCache.clear();
    this.spamIds.clear();
    this.contentGroups.clear();
    this.userTimestamps.clear();
  }

  /** Detect spam in the full list, but only analyze new comments */
  detect(comments: PostComment[]): SpamFilterResult {
    if (comments.length === 0) return { spamIds: new Set(), spamCount: 0 };

    // Find new comments not yet in cache
    const newComments = comments.filter((c) => !this.knownIds.has(c.id));
    if (newComments.length === 0) {
      return { spamIds: new Set(this.spamIds), spamCount: this.spamIds.size };
    }

    // Cache normalized text and individual scores for new comments
    for (const c of newComments) {
      this.knownIds.add(c.id);
      this.normCache.set(c.id, normalize(c.content));
      this.scoreCache.set(c.id, getSpamScore(c.content));
    }

    // Pass 1: Flag individually spammy new comments
    for (const c of newComments) {
      if ((this.scoreCache.get(c.id) ?? 0) >= 0.5) {
        this.spamIds.add(c.id);
      }
    }

    // Pass 2: Add new comments to content groups and re-check group sizes
    for (const c of newComments) {
      const norm = this.normCache.get(c.id)!;
      if (norm.length < MIN_COMMENT_LENGTH) continue;

      let matched = false;
      for (const [key, group] of this.contentGroups) {
        if (diceCoefficient(norm, key) >= SIMILARITY_THRESHOLD) {
          group.push(c);
          matched = true;
          // Re-check if this group now exceeds threshold
          const uniqueUsers = new Set(group.map((g) => g.userId));
          if (uniqueUsers.size >= 3 || group.length >= 3) {
            for (const g of group) this.spamIds.add(g.id);
          }
          break;
        }
      }
      if (!matched) {
        this.contentGroups.set(norm, [c]);
      }
    }

    // Pass 3: Add new comment timestamps and check rapid-fire posting
    for (const c of newComments) {
      const times = this.userTimestamps.get(c.userId) ?? [];
      times.push({ id: c.id, time: new Date(c.created).getTime() });
      this.userTimestamps.set(c.userId, times);
    }

    // Only re-check rapid posting for users who had new comments
    const affectedUsers = new Set(newComments.map((c) => c.userId));
    for (const userId of affectedUsers) {
      const times = this.userTimestamps.get(userId)!;
      times.sort((a, b) => a.time - b.time);
      for (let i = 0; i < times.length; i++) {
        const windowEnd = times[i].time + RAPID_POST_WINDOW_MS;
        let count = 0;
        for (let j = i; j < times.length && times[j].time <= windowEnd; j++) {
          count++;
        }
        if (count >= RAPID_POST_LIMIT) {
          for (let j = i; j < times.length && times[j].time <= windowEnd; j++) {
            this.spamIds.add(times[j].id);
          }
        }
      }
    }

    // Pass 4: Check frequency of new messages in the recent window
    const recent = comments.slice(0, DUPLICATE_WINDOW_SIZE);
    const msgCounts = new Map<string, number>();
    for (const c of recent) {
      const norm = this.normCache.get(c.id) ?? normalize(c.content);
      if (norm.length < MIN_COMMENT_LENGTH) continue;
      msgCounts.set(norm, (msgCounts.get(norm) ?? 0) + 1);
    }
    const thresh = Math.max(3, Math.floor(recent.length * MAX_SPAM_RATIO));
    for (const [msg, count] of msgCounts) {
      if (count >= thresh) {
        for (const c of comments) {
          const norm = this.normCache.get(c.id) ?? normalize(c.content);
          if (diceCoefficient(norm, msg) >= SIMILARITY_THRESHOLD) {
            this.spamIds.add(c.id);
          }
        }
      }
    }

    return { spamIds: new Set(this.spamIds), spamCount: this.spamIds.size };
  }
}

// Singleton instance
const detector = new SpamDetector();

// ── Shared blocklist from push server ────────────────────────────────
let sharedBlocklist = new Set<number>();
let blocklistLoaded = false;
let blocklistLoading = false;
let sessionFetched = false; // Only fetch once per app session
let cachedEtag: string | null = null;

/** Load blocklist from localStorage cache */
function loadCachedBlocklist(): boolean {
  try {
    const cached = storage.get(BLOCKLIST_CACHE_KEY);
    const etag = storage.get(BLOCKLIST_ETAG_KEY);
    if (cached && etag) {
      const ids = JSON.parse(cached) as number[];
      sharedBlocklist = new Set(ids);
      cachedEtag = etag;
      blocklistLoaded = true;
      return true;
    }
  } catch {}
  return false;
}

/** Save blocklist to localStorage cache */
function saveCachedBlocklist(etag: string): void {
  try {
    storage.set(BLOCKLIST_CACHE_KEY, JSON.stringify([...sharedBlocklist]));
    storage.set(BLOCKLIST_ETAG_KEY, etag);
  } catch {}
}

/** Fetch the shared spam blocklist from the push server (with caching) */
export async function fetchSharedBlocklist(): Promise<void> {
  if (!SPAM_FILTER_ENABLED) return;
  if (!PUSH_SERVER_URL || blocklistLoading) return;
  
  console.log("[spamFilter] Starting blocklist fetch from:", PUSH_SERVER_URL);
  
  // Only fetch once per session (unless forced)
  if (sessionFetched && blocklistLoaded) {
    console.log("[spamFilter] Already fetched this session, using cached data");
    return;
  }
  
  blocklistLoading = true;
  
  // Try loading from cache first
  const hadCache = loadCachedBlocklist();
  console.log("[spamFilter] Cache load result:", hadCache ? "found" : "not found");
  
  try {
    // Build request with ETag for conditional fetch
    const headers: HeadersInit = { Accept: "application/json" };
    if (cachedEtag) {
      headers["If-None-Match"] = cachedEtag;
      console.log("[spamFilter] Using ETag:", cachedEtag);
    }
    
    const resp = await fetch(`${PUSH_SERVER_URL}/api/spam/list`, {
      method: "GET",
      headers,
    });
    
    console.log("[spamFilter] Response status:", resp.status);
    
    // 304 Not Modified — cache is still valid
    if (resp.status === 304) {
      console.log("[spamFilter] 304 Not Modified - using cache");
      sessionFetched = true;
      return;
    }
    
    if (!resp.ok) {
      console.warn("[spamFilter] Failed to fetch blocklist, status:", resp.status);
      // If we had cache, use it; otherwise fail silently
      sessionFetched = hadCache;
      return;
    }
    
    const data = await resp.json();
    console.log("[spamFilter] Received data:", data);
    
    if (Array.isArray(data.ids)) {
      sharedBlocklist = new Set(data.ids);
      blocklistLoaded = true;
      sessionFetched = true;
      console.log("[spamFilter] Blocklist loaded, size:", sharedBlocklist.size);
      
      // Save to cache with ETag
      const newEtag = resp.headers.get("ETag");
      if (newEtag) {
        cachedEtag = newEtag;
        saveCachedBlocklist(newEtag);
        console.log("[spamFilter] Saved to cache with ETag:", newEtag);
      }
    } else {
      console.warn("[spamFilter] Unexpected response format:", data);
    }
  } catch (e: any) {
    console.error("[spamFilter] Network error:", e.message);
    // Network error — use cache if available
    sessionFetched = hadCache;
  } finally {
    blocklistLoading = false;
  }
}

/** Report detected spam IDs to the push server (best-effort, non-blocking) */
export function reportSpamToServer(commentIds: number[], authToken: string | null): void {
  if (!SPAM_FILTER_ENABLED) return;
  if (!PUSH_SERVER_URL || !authToken || commentIds.length === 0) return;
  fetch(`${PUSH_SERVER_URL}/api/spam/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ commentIds }),
  }).catch(() => {});
}

/** Detect spam (cached — only analyzes new comments). Merges with shared blocklist. */
export function detectSpamComments(comments: PostComment[]): SpamFilterResult {
  if (!SPAM_FILTER_ENABLED) return { spamIds: new Set(), spamCount: 0 };
  const result = detector.detect(comments);
  // Merge shared blocklist
  for (const id of sharedBlocklist) {
    if (comments.some((c) => c.id === id)) {
      result.spamIds.add(id);
    }
  }
  return { spamIds: result.spamIds, spamCount: result.spamIds.size };
}

/** Reset the spam cache (call when doing a full refresh of comments). */
export function resetSpamCache(): void {
  detector.reset();
}

/** Check if shared blocklist has been loaded at least once */
export function isBlocklistLoaded(): boolean {
  return blocklistLoaded;
}

/** Check if a comment ID is in the shared server blocklist */
export function isBlocklisted(commentId: number): boolean {
  if (!SPAM_FILTER_ENABLED) return false;
  return sharedBlocklist.has(commentId);
}

/** Get the number of IDs in the shared blocklist */
export function getBlocklistSize(): number {
  return sharedBlocklist.size;
}

// ── Distributed scanning (client as worker) ──────────────────────────
export interface DistScanResult {
  success: boolean;
  commentsProcessed: number;
  spamDetected: number;
  newSpamAdded: number;
  error?: string;
}

/**
 * Run one distributed scan cycle:
 * 1. Claim a work unit from the push server (gets a cursor)
 * 2. Fetch raw comments from rule34vault using that cursor
 * 3. Submit raw comments back to the push server for server-side detection
 *
 * The server runs its own spam detection — the client just fetches data.
 * Returns the result of the submission.
 */
export async function runDistributedScanCycle(authToken: string): Promise<DistScanResult> {
  if (!PUSH_SERVER_URL) {
    return { success: false, commentsProcessed: 0, spamDetected: 0, newSpamAdded: 0, error: "No push server URL" };
  }

  // Step 1: Claim work
  let claimToken: string;
  let fetchUrl: string;
  try {
    const claimResp = await fetch(`${PUSH_SERVER_URL}/api/spam/claim-work`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
    });
    if (!claimResp.ok) {
      const err = await claimResp.json().catch(() => ({ error: "Unknown" }));
      return { success: false, commentsProcessed: 0, spamDetected: 0, newSpamAdded: 0, error: err.error || `HTTP ${claimResp.status}` };
    }
    const claimData = await claimResp.json();
    claimToken = claimData.claimToken;
    fetchUrl = claimData.fetchUrl;
  } catch (e: any) {
    return { success: false, commentsProcessed: 0, spamDetected: 0, newSpamAdded: 0, error: `Claim failed: ${e.message}` };
  }

  // Step 2: Fetch comments from rule34vault
  let comments: Array<{ id: number; content: string; userId: number }>;
  let nextCursor: string | null;
  try {
    const commentsResp = await fetch(fetchUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!commentsResp.ok) {
      return { success: false, commentsProcessed: 0, spamDetected: 0, newSpamAdded: 0, error: `Fetch comments failed: HTTP ${commentsResp.status}` };
    }
    const data = await commentsResp.json();
    if (!data.items || data.items.length === 0) {
      return { success: true, commentsProcessed: 0, spamDetected: 0, newSpamAdded: 0, error: "No more comments to scan" };
    }
    comments = data.items.map((c: any) => ({
      id: c.id,
      content: c.content || "",
      userId: c.userId,
    }));
    nextCursor = data.cursor || null;
  } catch (e: any) {
    return { success: false, commentsProcessed: 0, spamDetected: 0, newSpamAdded: 0, error: `Fetch failed: ${e.message}` };
  }

  // Step 3: Submit raw comments to server for detection
  try {
    const submitResp = await fetch(`${PUSH_SERVER_URL}/api/spam/submit-work`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ claimToken, comments, nextCursor }),
    });
    if (!submitResp.ok) {
      const err = await submitResp.json().catch(() => ({ error: "Unknown" }));
      return { success: false, commentsProcessed: comments.length, spamDetected: 0, newSpamAdded: 0, error: err.error || `Submit HTTP ${submitResp.status}` };
    }
    const result = await submitResp.json();
    return {
      success: true,
      commentsProcessed: result.commentsProcessed || comments.length,
      spamDetected: result.spamDetected || 0,
      newSpamAdded: result.newSpamAdded || 0,
    };
  } catch (e: any) {
    return { success: false, commentsProcessed: comments.length, spamDetected: 0, newSpamAdded: 0, error: `Submit failed: ${e.message}` };
  }
}

/** Get distributed scan status from server */
export async function getDistributedScanStatus(): Promise<any> {
  if (!PUSH_SERVER_URL) return null;
  try {
    const resp = await fetch(`${PUSH_SERVER_URL}/api/spam/distributed-status`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}
