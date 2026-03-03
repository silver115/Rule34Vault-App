// Load env from parent .env for local dev (Docker passes env vars directly)
try { require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") }); } catch {}
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs   = require("fs");

// ── Config (from .env) ─────────────────────────────────────────────────
const PORT               = parseInt(process.env.PORT || "4830", 10);
const R34_BASE           = process.env.R34_API_BASE || "https://rule34vault.com";
const PROFILE_TTL_MS     = parseInt(process.env.PROFILE_TTL || "3600000", 10);
const MAX_SEEN           = parseInt(process.env.MAX_SEEN || "5000", 10);
const LIKED_HISTORY      = parseInt(process.env.LIKED_HISTORY || "100", 10);
const BOOKMARKED_HISTORY = parseInt(process.env.BOOKMARKED_HISTORY || "50", 10);
const DECAY_LAMBDA       = parseFloat(process.env.DECAY_LAMBDA || "0.03");
const DIVERSITY_ARTIST_CAP = parseInt(process.env.DIVERSITY_ARTIST_CAP || "3", 10);
const DIVERSITY_CHAR_CAP   = parseInt(process.env.DIVERSITY_CHAR_CAP || "5", 10);
const BANDIT_PRIOR_ALPHA   = parseInt(process.env.BANDIT_PRIOR_ALPHA || "1", 10);
const BANDIT_PRIOR_BETA    = parseInt(process.env.BANDIT_PRIOR_BETA || "10", 10);
const INCREMENTAL_TTL_MS  = parseInt(process.env.INCREMENTAL_TTL    || "60000",    10); // 60s — check for new likes/bookmarks
const FULL_REBUILD_TTL_MS = parseInt(process.env.FULL_REBUILD_TTL   || "86400000",  10); // 24 hours — full profile rebuild
const SEEN_SUPPRESSION_DAYS = parseInt(process.env.SEEN_SUPPRESSION_DAYS || "30", 10); // days to suppress already-seen posts
const MAX_HISTORY_PAGES   = parseInt(process.env.MAX_HISTORY_PAGES  || "100",      10); // max pages per history fetch on full rebuild (100×50=5000 posts)
const ADMIN_TOKEN         = process.env.ADMIN_TOKEN || ""; // optional: protect /admin endpoints

// ── Session momentum (in-memory, resets on server restart) ──────────
// Tracks per-user engagement quality within the current session.
// sessionState: { viewCount, engagedCount, sessionStart, lastSignalAt }
const sessionMap = new Map(); // userId → sessionState
const SESSION_TIMEOUT_MS  = 30 * 60 * 1000; // 30 min inactivity = new session
const ENGAGED_THRESHOLD_S = 15;             // >= 15s duration = "engaged" view

function getSession(userId) {
  const now = Date.now();
  let s = sessionMap.get(userId);
  if (!s || (now - s.lastSignalAt) > SESSION_TIMEOUT_MS) {
    s = { viewCount: 0, engagedCount: 0, sessionStart: now, lastSignalAt: now };
    sessionMap.set(userId, s);
  }
  return s;
}

function sessionMomentumMultiplier(session) {
  if (session.viewCount < 3) return 1.0; // not enough data yet
  const engageRatio = session.engagedCount / session.viewCount;
  if (engageRatio > 0.5) return 1.15;  // active deep-watch session → boost signals
  if (engageRatio < 0.2) return 0.6;   // browse session → dampen signals
  return 1.0;
}

// ── Database ─────────────────────────────────────────────────────────
const dbPath = path.join(__dirname, "data", "rec.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS user_profiles (
    user_id    INTEGER PRIMARY KEY,
    tags_json  TEXT    NOT NULL DEFAULT '{}',
    refreshed  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS seen_posts (
    user_id  INTEGER NOT NULL,
    post_id  INTEGER NOT NULL,
    seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, post_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    post_id    INTEGER NOT NULL,
    signal     TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// V2: Thompson Sampling bandit arms — per-user per-tag α/β
db.exec(`
  CREATE TABLE IF NOT EXISTS bandit_arms (
    user_id  INTEGER NOT NULL,
    tag      TEXT    NOT NULL,
    alpha    REAL    NOT NULL DEFAULT 1,
    beta     REAL    NOT NULL DEFAULT 10,
    PRIMARY KEY (user_id, tag)
  )
`);

// V2: Tag co-occurrence pairs — tracks which tag pairs appear together in liked content
db.exec(`
  CREATE TABLE IF NOT EXISTS tag_cooccurrence (
    user_id  INTEGER NOT NULL,
    tag_a    TEXT    NOT NULL,
    tag_b    TEXT    NOT NULL,
    count    INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, tag_a, tag_b)
  )
`);

// V2: Global tag document frequency for IDF calculation
db.exec(`
  CREATE TABLE IF NOT EXISTS tag_idf (
    tag        TEXT    PRIMARY KEY,
    doc_count  INTEGER NOT NULL DEFAULT 1
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS idf_meta (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  )
`);
db.exec(`INSERT OR IGNORE INTO idf_meta (key, value) VALUES ('total_docs', 0)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// ── One-time V5 migration ─────────────────────────────────────────────
// Expire all existing profiles built with old capped-history algorithm
// so they get a full rebuild with uncapped history on next request.
(function runMigrations() {
  const cur = parseInt(db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get()?.value ?? '0', 10);
  if (cur < 5) {
    db.exec(`UPDATE user_profiles SET refreshed = datetime('now', '-48 hours')`);
    db.exec(`DELETE FROM profile_cursors`);
    db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '5')`).run();
    console.log('[migration] V5: expired all profiles → full rebuild with uncapped history on next request');
  }
})();

// Add username column if upgrading from older schema (safe no-op if already exists)
try { db.exec(`ALTER TABLE user_profiles ADD COLUMN username TEXT`); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS profile_cursors (
    user_id  INTEGER NOT NULL,
    endpoint TEXT    NOT NULL,
    last_id  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, endpoint)
  )
`);

const stmtGetProfile   = db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`);
const stmtUpsertProfile = db.prepare(`
  INSERT INTO user_profiles (user_id, username, tags_json, refreshed)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    username  = COALESCE(excluded.username, user_profiles.username),
    tags_json = excluded.tags_json,
    refreshed = datetime('now')
`);
const stmtGetSeen = db.prepare(`
  SELECT post_id FROM seen_posts WHERE user_id = ?
  AND seen_at > ?
  ORDER BY seen_at DESC LIMIT ?
`);
const stmtMarkSeen = db.prepare(`
  INSERT OR IGNORE INTO seen_posts (user_id, post_id) VALUES (?, ?)
`);
const stmtSeenCount = db.prepare(`SELECT COUNT(*) as c FROM seen_posts WHERE user_id = ?`);
const stmtEvictSeen = db.prepare(`
  DELETE FROM seen_posts WHERE user_id = ? AND post_id IN (
    SELECT post_id FROM seen_posts WHERE user_id = ?
    ORDER BY seen_at ASC LIMIT ?
  )
`);
const stmtEvictOldSeen = db.prepare(`DELETE FROM seen_posts WHERE user_id = ? AND seen_at < ?`);
const stmtLogSignal = db.prepare(`
  INSERT INTO signals (user_id, post_id, signal) VALUES (?, ?, ?)
`);

// V2: Bandit arms
const stmtGetArms    = db.prepare(`SELECT tag, alpha, beta FROM bandit_arms WHERE user_id = ?`);
const stmtUpsertArm  = db.prepare(`
  INSERT INTO bandit_arms (user_id, tag, alpha, beta) VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, tag) DO UPDATE SET alpha = excluded.alpha, beta = excluded.beta
`);
const stmtDeleteArms = db.prepare(`DELETE FROM bandit_arms WHERE user_id = ?`);
const stmtGetArm     = db.prepare(`SELECT alpha, beta FROM bandit_arms WHERE user_id = ? AND tag = ?`);

// V2: Co-occurrence
const stmtGetCooccurrence    = db.prepare(`SELECT tag_a, tag_b, count FROM tag_cooccurrence WHERE user_id = ? ORDER BY count DESC LIMIT ?`);
const stmtUpsertCooccurrence = db.prepare(`
  INSERT INTO tag_cooccurrence (user_id, tag_a, tag_b, count) VALUES (?, ?, ?, 1)
  ON CONFLICT(user_id, tag_a, tag_b) DO UPDATE SET count = tag_cooccurrence.count + 1
`);
const stmtDeleteCooccurrence = db.prepare(`DELETE FROM tag_cooccurrence WHERE user_id = ?`);

// V2: IDF
const stmtGetIdf       = db.prepare(`SELECT doc_count FROM tag_idf WHERE tag = ?`);
const stmtUpsertIdf    = db.prepare(`INSERT INTO tag_idf (tag, doc_count) VALUES (?, 1) ON CONFLICT(tag) DO UPDATE SET doc_count = tag_idf.doc_count + 1`);
const stmtGetTotalDocs = db.prepare(`SELECT value FROM idf_meta WHERE key = 'total_docs'`);
const stmtIncTotalDocs  = db.prepare(`UPDATE idf_meta SET value = value + ? WHERE key = 'total_docs'`);
const stmtGetCursor    = db.prepare(`SELECT last_id FROM profile_cursors WHERE user_id = ? AND endpoint = ?`);
const stmtSetCursor    = db.prepare(`INSERT INTO profile_cursors (user_id, endpoint, last_id) VALUES (?, ?, ?) ON CONFLICT(user_id, endpoint) DO UPDATE SET last_id = excluded.last_id`);
const stmtClearCursors = db.prepare(`DELETE FROM profile_cursors WHERE user_id = ?`);

// ── Express ──────────────────────────────────────────────────────────
const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json());

// ── Auth middleware ──────────────────────────────────────────────────
async function jwtAuth(req, res, next) {
  const h = req.headers["authorization"];
  if (!h || !h.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }
  const jwt = h.slice(7);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${R34_BASE}/api/v2/account/me`, {
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return res.status(401).json({ error: "Invalid token" });
    const user = await r.json();
    if (!user?.id) return res.status(401).json({ error: "Could not identify user" });
    req.r34user = user;
    req.r34jwt  = jwt;
    next();
  } catch (e) {
    console.error("[auth]", e.message);
    return res.status(500).json({ error: "Auth check failed" });
  }
}

// ── R34 API helpers ──────────────────────────────────────────────────
const TAG_TYPE_WEIGHT = { 8: 5, 4: 4, 2: 3, 1: 1 };

async function r34Fetch(jwt, method, endpoint, body = null, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const opts = {
      method,
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      signal: ctrl.signal,
    };
    if (body !== null) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(`${R34_BASE}/api/v2${endpoint}`, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const r34Post = (jwt, endpoint, body, ms) => r34Fetch(jwt, "POST", endpoint, body, ms);
const r34Get  = (jwt, endpoint, ms)    => r34Fetch(jwt, "GET",  endpoint, null, ms ?? 10000);

// Paginate through posts; stop early if we hit an already-seen post ID (incremental)
async function fetchAllPaginated(jwt, endpoint, maxPages = 10, stopAtId = 0) {
  const all = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const body = { take: 50 };
    if (cursor) body.cursor = cursor;
    try {
      const res = await r34Post(jwt, endpoint, body);
      const items = res?.items ?? [];
      let hitStop = false;
      for (const item of items) {
        if (stopAtId > 0 && item.id <= stopAtId) { hitStop = true; break; }
        all.push(item);
      }
      cursor = res?.cursor ?? null;
      if (hitStop || !cursor || items.length < 50) break;
    } catch { break; }
  }
  return all;
}

async function fetchHistory(userId, jwt, incremental = false) {
  // Incremental: stop pagination when we reach a post ID we've already processed
  const likedStopId      = incremental ? (stmtGetCursor.get(userId, 'liked')?.last_id      ?? 0) : 0;
  const bookmarkedStopId = incremental ? (stmtGetCursor.get(userId, 'bookmarked')?.last_id  ?? 0) : 0;
  const superLikedStopId = incremental ? (stmtGetCursor.get(userId, 'super-liked')?.last_id ?? 0) : 0;

  // Full rebuild: fetch ALL history (no page cap); incremental: stop early at cursor
  const likedPages     = incremental ? 8  : MAX_HISTORY_PAGES;
  const bookmarkPages  = incremental ? 6  : MAX_HISTORY_PAGES;
  const superLikePages = incremental ? 4  : Math.ceil(MAX_HISTORY_PAGES / 2);

  const [liked, bookmarked, superLiked] = await Promise.all([
    fetchAllPaginated(jwt, `/post/search/liked/${userId}`, likedPages, likedStopId),
    fetchAllPaginated(jwt, `/post/search/bookmarked/${userId}`, bookmarkPages, bookmarkedStopId),
    fetchAllPaginated(jwt, `/post/search/super-liked/${userId}`, superLikePages, superLikedStopId),
  ]);

  // Save the newest item ID as the cursor for next incremental fetch
  const setCursors = db.transaction(() => {
    if (liked.length > 0)      stmtSetCursor.run(userId, 'liked', liked[0].id);
    if (bookmarked.length > 0) stmtSetCursor.run(userId, 'bookmarked', bookmarked[0].id);
    if (superLiked.length > 0) stmtSetCursor.run(userId, 'super-liked', superLiked[0].id);
  });
  setCursors();

  console.log(`[history] User ${userId} (${incremental ? 'incremental' : 'full'}): +${liked.length} liked, +${bookmarked.length} bookmarked, +${superLiked.length} super-liked`);
  return { liked, bookmarked, superLiked };
}

// Fetch tags from followed playlists by sampling posts from each
async function fetchPlaylistTags(userId, jwt) {
  try {
    const res = await r34Post(jwt, `/playlist/search/subscribed/${userId}`, { take: 20 });
    const playlists = res?.items ?? [];
    if (playlists.length === 0) return [];

    // Sample up to 10 posts from each of the top 10 playlists
    const tagCounts = {};
    const playlistSamples = await Promise.allSettled(
      playlists.slice(0, 10).map((pl) =>
        r34Post(jwt, `/post/search/playlist/${pl.id}`, { take: 10 })
          .then((r) => r?.items ?? [])
      )
    );
    for (const result of playlistSamples) {
      if (result.status !== "fulfilled") continue;
      for (const post of result.value) {
        for (const tag of post.tags ?? []) {
          tagCounts[tag.value] = (tagCounts[tag.value] ?? 0) + 1;
        }
      }
    }
    console.log(`[playlists] User ${userId}: ${playlists.length} playlists, ${Object.keys(tagCounts).length} unique tags`);
    return Object.entries(tagCounts).map(([tag, count]) => ({ value: tag, count }));
  } catch (e) {
    console.warn(`[playlists] Error for user ${userId}:`, e.message);
    return [];
  }
}

// Fetch user's active tag subscriptions
async function fetchTagSubscriptions(jwt) {
  try {
    const tags = await r34Get(jwt, "/tag/subscription/get-active");
    return Array.isArray(tags) ? tags : [];
  } catch (e) {
    console.warn("[tagSubs] Error:", e.message);
    return [];
  }
}

async function hydrateTagsForPosts(posts, jwt) {
  const missing = posts.filter((p) => !p.tags || p.tags.length === 0);
  if (missing.length === 0) return posts;
  const detailed = await Promise.allSettled(
    missing.slice(0, 40).map((p) =>
      fetch(`${R34_BASE}/api/v2/post/${p.id}`, {
        headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      }).then((r) => (r.ok ? r.json() : p))
    )
  );
  const dm = new Map(detailed.map((r) => {
    const p = r.status === "fulfilled" ? r.value : null;
    return p ? [p.id, p] : [-1, null];
  }).filter(([id]) => id !== -1));
  return posts.map((p) => dm.get(p.id) ?? p);
}

// ── IDF helpers ─────────────────────────────────────────────────────
function getIdfWeight(tag) {
  const totalDocs = stmtGetTotalDocs.get()?.value ?? 1;
  const row = stmtGetIdf.get(tag);
  const docCount = row?.doc_count ?? 0;
  if (docCount === 0) return 1.0;
  return Math.log((totalDocs + 1) / (docCount + 1)) + 1; // smoothed IDF
}

function updateIdfForPosts(posts) {
  const seenTags = new Set();
  for (const post of posts) {
    for (const tag of post.tags ?? []) {
      if (!seenTags.has(tag.value)) {
        seenTags.add(tag.value);
        stmtUpsertIdf.run(tag.value);
      }
    }
  }
  stmtIncTotalDocs.run(posts.length);
}

// ── Thompson Sampling ───────────────────────────────────────────────
// Hoisted helpers (module-level so they aren't re-created on every sampleBeta call)
function _tsRandn() {
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}
function _tsGamma(shape) {
  if (shape < 1) return _tsGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do { x = _tsRandn(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function sampleBeta(alpha, beta) {
  return _tsGamma(alpha) / (_tsGamma(alpha) + _tsGamma(beta));
}

function sampleArmsForUser(userId) {
  const rows = stmtGetArms.all(userId);
  if (rows.length === 0) return [];
  return rows
    .map((r) => ({ tag: r.tag, alpha: r.alpha, beta: r.beta, sampled: sampleBeta(r.alpha, r.beta) }))
    .sort((a, b) => b.sampled - a.sampled);
}

// ── Co-occurrence helpers ───────────────────────────────────────────
function recordCooccurrence(userId, tags) {
  const valuable = tags.filter((t) => [8, 4, 2].includes(t.type));
  for (let i = 0; i < valuable.length; i++) {
    for (let j = i + 1; j < valuable.length; j++) {
      const [a, b] = [valuable[i].value, valuable[j].value].sort();
      stmtUpsertCooccurrence.run(userId, a, b);
    }
  }
}

// ── Profile management ──────────────────────────────────────────────
async function refreshProfile(userId, jwt, incremental = false, username = null) {
  console.log(`[profile] ${incremental ? 'Incremental update' : 'Full rebuild'} for user ${userId}`);
  const { liked, bookmarked, superLiked } = await fetchHistory(userId, jwt, incremental);

  // Playlist tags + tag subs are expensive — only fetch on full rebuild
  const [playlistTags, tagSubs] = incremental
    ? [[], []]
    : await Promise.all([fetchPlaylistTags(userId, jwt), fetchTagSubscriptions(jwt)]);

  const raw = [...superLiked, ...bookmarked, ...liked];

  // Incremental with no new items — return existing profile unchanged
  if (raw.length === 0 && incremental) {
    const row = stmtGetProfile.get(userId);
    try { return JSON.parse(row?.tags_json ?? "{}"); } catch { return {}; }
  }

  if (raw.length === 0 && playlistTags.length === 0 && tagSubs.length === 0) {
    stmtUpsertProfile.run(userId, username, "{}");
    return {};
  }

  const hydrated = raw.length > 0 ? await hydrateTagsForPosts(raw, jwt) : [];

  // Load existing scores for incremental merge; start fresh for full rebuild
  let tagScore = {};
  if (incremental) {
    const row = stmtGetProfile.get(userId);
    try { tagScore = JSON.parse(row?.tags_json ?? "{}"); } catch {}
  }

  const superLikedIds = new Set(superLiked.map((p) => p.id));
  const bookmarkedIds = new Set(bookmarked.map((p) => p.id));

  hydrated.forEach((post, idx) => {
    const isSuperLiked  = superLikedIds.has(post.id);
    const isBookmarked  = bookmarkedIds.has(post.id);
    const actionW  = isSuperLiked ? 3.0 : isBookmarked ? 2.0 : 1.0;
    const recencyW = Math.exp(-DECAY_LAMBDA * idx);
    for (const tag of post.tags ?? []) {
      const tw  = TAG_TYPE_WEIGHT[tag.type] ?? 1;
      const idf = getIdfWeight(tag.value);
      tagScore[tag.value] = (tagScore[tag.value] ?? 0) + tw * actionW * recencyW * idf;
    }
  });

  if (!incremental) {
    // Boost tags from followed playlists (moderate weight)
    for (const { value, count } of playlistTags) {
      tagScore[value] = (tagScore[value] ?? 0) + Math.min(count, 5) * 1.5;
    }
    // Boost tags the user explicitly subscribes to (strong signal)
    for (const tag of tagSubs) {
      const tw = TAG_TYPE_WEIGHT[tag.type] ?? 1;
      tagScore[tag.value] = (tagScore[tag.value] ?? 0) + tw * 5.0;
    }
  }

  stmtUpsertProfile.run(userId, username, JSON.stringify(tagScore));

  // Update bandit arms
  const initArms = db.transaction((uid, scores) => {
    for (const [tag, score] of Object.entries(scores)) {
      const alpha = BANDIT_PRIOR_ALPHA + Math.min(score, 20);
      stmtUpsertArm.run(uid, tag, alpha, BANDIT_PRIOR_BETA);
    }
  });
  initArms(userId, tagScore);

  // Record tag co-occurrence from new posts
  const recordCooccurrences = db.transaction((uid, posts) => {
    for (const post of posts) {
      if (post.tags && post.tags.length > 0) recordCooccurrence(uid, post.tags);
    }
  });
  recordCooccurrences(userId, hydrated.slice(0, 80));

  console.log(`[profile] User ${userId}: ${Object.keys(tagScore).length} tags, +${hydrated.length} new posts${incremental ? '' : `, ${playlistTags.length} playlist tags, ${tagSubs.length} tag subs`}`);
  return tagScore;
}

async function getProfile(userId, jwt, forceRefresh = false, username = null) {
  if (forceRefresh) return refreshProfile(userId, jwt, false, username); // full rebuild
  const row = stmtGetProfile.get(userId);
  if (!row) return refreshProfile(userId, jwt, false, username);         // first time — full rebuild
  const ageMs = Date.now() - new Date(row.refreshed).getTime();
  if (ageMs < INCREMENTAL_TTL_MS) {
    try { return JSON.parse(row.tags_json); } catch {}                   // still fresh
  }
  if (ageMs >= FULL_REBUILD_TTL_MS) {
    return refreshProfile(userId, jwt, false, username);                 // very stale — full rebuild
  }
  return refreshProfile(userId, jwt, true, username);                    // incremental: only new items
}

// ── Algorithm helpers ────────────────────────────────────────────────
function fyShuffleAll(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function fyShuffleWindow(arr, w) {
  for (let i = 0; i < arr.length - 1; i++) {
    const max = Math.min(i + w, arr.length - 1);
    const j   = i + Math.floor(Math.random() * (max - i + 1));
    if (i !== j) [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function fyInterleave(...arrays) {
  const result = [];
  const maxLen = Math.max(0, ...arrays.map((a) => a.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of arrays) {
      if (i < arr.length) result.push(arr[i]);
    }
  }
  return result;
}

function scorePost(post, tagScore) {
  let s = 0;
  for (const tag of post.tags ?? []) {
    const baseScore = tagScore[tag.value] ?? 0;
    const idf = getIdfWeight(tag.value);
    s += baseScore * idf;
  }
  s += Math.log((post.likes ?? 0) + 1) * 1.5;
  const ageDays = (Date.now() - new Date(post.posted).getTime()) / 86_400_000;
  if (ageDays < 7)       s *= 1.20;
  else if (ageDays < 30) s *= 1.10;
  else if (ageDays < 90) s *= 1.05;
  return s;
}

// V2: Diversity enforcement — cap posts per artist/character
function enforceDiversity(posts) {
  const artistCount = {};
  const charCount   = {};
  return posts.filter((post) => {
    let dominated = false;
    for (const tag of post.tags ?? []) {
      if (tag.type === 8) { // artist
        artistCount[tag.value] = (artistCount[tag.value] ?? 0) + 1;
        if (artistCount[tag.value] > DIVERSITY_ARTIST_CAP) dominated = true;
      }
      if (tag.type === 4) { // character
        charCount[tag.value] = (charCount[tag.value] ?? 0) + 1;
        if (charCount[tag.value] > DIVERSITY_CHAR_CAP) dominated = true;
      }
    }
    return !dominated;
  });
}

async function buildRecommendations(userId, jwt, tagScore, seenSet, take, page, totalSeen = 0) {
  // V7: Thompson Sampling for tag selection
  const sampledArms = sampleArmsForUser(userId);
  const rankedTags = sampledArms.length > 0
    ? sampledArms.map((a) => a.tag)
    : Object.entries(tagScore).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([v]) => v);

  if (rankedTags.length === 0) {
    return []; // No interest data yet — caller will show empty/fallback
  }

  const topSampled = rankedTags.slice(0, 20);
  const cooccPairs = stmtGetCooccurrence.all(userId, 5);

  // V7: Split top 4 tags into individual pools so the interleave produces
  // tag1-tag2-tag3-tag4-discovery-explore alternation instead of a block of
  // 10 posts all sharing the same 2 core tags.
  const pool0Tags = topSampled[0] ? [topSampled[0]] : [];
  const pool1Tags = topSampled[1] ? [topSampled[1]] : [];
  const pool2Tags = topSampled[2] ? [topSampled[2]] : [];
  const pool3Tags = topSampled[3] ? [topSampled[3]] : [];
  const discoveryTags = topSampled.slice(4, 10);  // tags 5-10 — adjacent interests
  const exploreTags   = topSampled.slice(10, 20); // tags 11-20 — broader exploration
  const cooccTags     = cooccPairs.length > 0 ? [cooccPairs[0].tag_a, cooccPairs[0].tag_b] : [];

  // Smaller per-pool fetch since we now have 7 pools; 5x is enough with dedup
  const fetchN = Math.ceil(take * 5);
  // Random skip: offset into the result set so consecutive loads don't return
  // the same deterministic top-N posts every time.
  const rSkip = (max = 300) => Math.floor(Math.random() * max);

  // 7 parallel pool fetches — individual tags prevent clustering
  const results = await Promise.allSettled([
    pool0Tags.length ? r34Post(jwt, "/post/search/root", { take: fetchN, includeTags: pool0Tags, sortBy: 1, skip: rSkip() }).then(r => r?.items ?? []) : Promise.resolve([]),
    pool1Tags.length ? r34Post(jwt, "/post/search/root", { take: fetchN, includeTags: pool1Tags, sortBy: 1, skip: rSkip() }).then(r => r?.items ?? []) : Promise.resolve([]),
    pool2Tags.length ? r34Post(jwt, "/post/search/root", { take: fetchN, includeTags: pool2Tags, sortBy: 1, skip: rSkip() }).then(r => r?.items ?? []) : Promise.resolve([]),
    pool3Tags.length ? r34Post(jwt, "/post/search/root", { take: fetchN, includeTags: pool3Tags, sortBy: 1, skip: rSkip() }).then(r => r?.items ?? []) : Promise.resolve([]),
    discoveryTags.length ? r34Post(jwt, "/post/search/root", { take: fetchN, includeTags: discoveryTags, sortBy: 1, skip: rSkip() }).then(r => r?.items ?? []) : Promise.resolve([]),
    exploreTags.length   ? r34Post(jwt, "/post/search/root", { take: fetchN, includeTags: exploreTags,   sortBy: 1, skip: rSkip(150) }).then(r => r?.items ?? []) : Promise.resolve([]),
    cooccTags.length === 2 ? r34Post(jwt, "/post/search/root", { take: fetchN, includeTags: cooccTags, sortBy: 1, skip: rSkip() }).then(r => r?.items ?? []) : Promise.resolve([]),
  ]);

  const pools = results.map((r) => r.status === "fulfilled" ? r.value : []);

  // Dynamic 7-pool ratios: max single-tag share is now ≤ 0.16 (was 0.50 for 2 bundled tags)
  // New users exploit top tags more; veterans shift weight toward exploration.
  let ratios;
  if (totalSeen < 50) {
    ratios = [0.16, 0.14, 0.12, 0.10, 0.24, 0.14, 0.10]; // new — exploit known tags
  } else if (totalSeen < 500) {
    ratios = [0.14, 0.12, 0.10, 0.10, 0.24, 0.20, 0.10]; // growing — balanced
  } else if (totalSeen < 2000) {
    ratios = [0.12, 0.10, 0.10, 0.08, 0.24, 0.26, 0.10]; // veteran — more exploration
  } else {
    ratios = [0.10, 0.08, 0.08, 0.07, 0.22, 0.35, 0.10]; // saturated — max exploration
  }
  const poolMaxes = ratios.map(r => Math.ceil(take * r));

  const globalSeen = new Set(seenSet);

  function pickFromPool(pool, max) {
    const candidates = pool
      .filter((p) => !globalSeen.has(p.id))
      .map((p) => ({ post: p, score: scorePost(p, tagScore) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, max * 4); // 4x candidates for better diversity
    fyShuffleAll(candidates);
    const picked = [];
    for (const { post } of candidates) {
      if (!globalSeen.has(post.id) && picked.length < max) {
        picked.push(post);
        globalSeen.add(post.id);
      }
    }
    return picked;
  }

  const pickedPools = pools.map((pool, i) => pickFromPool(pool, poolMaxes[i]));

  // Interleave all pools → diversity caps → shuffle
  const interleaved = fyInterleave(...pickedPools);
  const diverse = enforceDiversity(interleaved);
  fyShuffleWindow(diverse, 10);

  // If diversity filtering removed too many, backfill from core interest pool
  if (diverse.length < take) {
    const needed = take - diverse.length;
    const backfill = pools[0]
      .filter((p) => !globalSeen.has(p.id))
      .map((p) => ({ post: p, score: scorePost(p, tagScore) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, needed * 2);
    fyShuffleAll(backfill);
    for (const { post } of backfill) {
      if (diverse.length >= take) break;
      if (!globalSeen.has(post.id)) {
        diverse.push(post);
        globalSeen.add(post.id);
      }
    }
  }

  // Update IDF counts for served content
  updateIdfForPosts(diverse.slice(0, take));

  return diverse.slice(0, take);
}

// ── Endpoints ────────────────────────────────────────────────────────

// Health check
app.get("/api/health", (req, res) => {
  const users   = db.prepare("SELECT COUNT(*) as c FROM user_profiles").get().c;
  const seen    = db.prepare("SELECT COUNT(*) as c FROM seen_posts").get().c;
  const signals = db.prepare("SELECT COUNT(*) as c FROM signals").get().c;
  const arms    = db.prepare("SELECT COUNT(*) as c FROM bandit_arms").get().c;
  const idfDocs  = stmtGetTotalDocs.get()?.value ?? 0;
  const dbSize = (() => { try { return fs.statSync(dbPath).size; } catch { return 0; } })();
  res.json({ status: "ok", version: 6, profiledUsers: users, seenRecords: seen, signals, banditArms: arms, idfDocs, dbSize });
});

// Get recommendations
app.post("/api/recommendations", jwtAuth, async (req, res) => {
  const userId = req.r34user.id;
  const take   = Math.min(parseInt(req.body.take ?? 30, 10), 50);

  try {
    // Load profile (auto-refreshes if stale)
    const tagScore = await getProfile(userId, req.r34jwt, false, req.r34user.username ?? req.r34user.name ?? null);

    // Load seen post IDs: only posts seen within the suppression window
    const seenCutoff = new Date(Date.now() - SEEN_SUPPRESSION_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const seenRows  = stmtGetSeen.all(userId, seenCutoff, MAX_SEEN);
    const seenSet   = new Set(seenRows.map((r) => r.post_id));

    // Page = total seen ÷ take (roughly how many pages in)
    const totalSeen = stmtSeenCount.get(userId).c;
    const page      = Math.floor(totalSeen / Math.max(take, 1));

    const posts = await buildRecommendations(userId, req.r34jwt, tagScore, seenSet, take, page, totalSeen);

    if (posts.length === 0) {
      return res.json({ posts: [], topTags: [] });
    }

    // Mark these as seen
    const markSeen = db.transaction((uid, items) => {
      for (const p of items) stmtMarkSeen.run(uid, p.id);
    });
    markSeen(userId, posts);

    // Evict posts older than suppression window — they're eligible to reappear after that
    const evictCutoff = new Date(Date.now() - SEEN_SUPPRESSION_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    stmtEvictOldSeen.run(userId, evictCutoff);
    // Hard cap safety net: trim oldest if DB still over limit
    const newCount = stmtSeenCount.get(userId).c;
    if (newCount > MAX_SEEN) {
      stmtEvictSeen.run(userId, userId, newCount - MAX_SEEN);
    }

    const topTags = Object.entries(tagScore)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([v]) => v);

    console.log(`[rec] User ${userId} — returned ${posts.length} posts, page ${page}`);
    res.json({ posts, topTags });
  } catch (e) {
    console.error(`[rec] Error for user ${userId}:`, e.message);
    res.status(500).json({ error: "Failed to build recommendations" });
  }
});

// Send engagement signal
// signal: "like" | "bookmark" | "skip" | "complete"
app.post("/api/signal", jwtAuth, async (req, res) => {
  const userId   = req.r34user.id;
  const username = req.r34user.username ?? req.r34user.name ?? null;
  const { postId, signal, tags } = req.body;

  if (!postId || !signal) {
    return res.status(400).json({ error: "Missing postId or signal" });
  }

  try {
    stmtLogSignal.run(userId, postId, signal);

    // Always load whatever profile we already have for the immediate delta update below.
    // For like/bookmark/super_like also trigger an incremental rebuild in the background
    // so the next recommendations batch reflects the updated history — but don't block the
    // response on the API round-trip (fire-and-forget).
    let profileRow = stmtGetProfile.get(userId);
    const isActionSignal = ["like", "bookmark", "super_like"].includes(signal);
    if (!profileRow) {
      // First-time user: must wait for initial profile build before we can apply deltas
      try {
        await refreshProfile(userId, req.r34jwt, false, username);
        profileRow = stmtGetProfile.get(userId);
      } catch (err) {
        console.warn(`[signal] Failed to build initial profile for user ${userId}:`, err.message);
      }
    } else if (isActionSignal) {
      // Profile exists — kick off incremental refresh in background, respond immediately
      refreshProfile(userId, req.r34jwt, true, username).catch((err) =>
        console.warn(`[signal] Background refresh failed for user ${userId}:`, err.message)
      );
    }

    // V2: Update bandit arms + profile based on signal
    if (tags && Array.isArray(tags) && tags.length > 0) {
      let profile = {};
      try { profile = JSON.parse(profileRow?.tags_json ?? "{}"); } catch { /* ok */ }

      // V6: Signal processing — research-backed weights
      // skip weakened: a pass isn't necessarily "I hate this", just "not now"
      const SIGNAL_ALPHA  = { like: 1.0, bookmark: 2.0, super_like: 3.0, complete: 0.5, skip: 0,   view_duration: 0, attention: 0 };
      const SIGNAL_BETA   = { like: 0,   bookmark: 0,   super_like: 0,   complete: 0,   skip: 0.5, view_duration: 0, attention: 0 };
      const PROFILE_DELTA = { like: 1.0, bookmark: 1.5, super_like: 2.5, complete: 0.5, skip: -0.25, view_duration: 0, attention: 0 };

      const duration = req.body.duration ?? 0; // seconds

      // Session momentum: quality multiplier based on this session's engagement ratio
      const session = getSession(userId);
      session.lastSignalAt = Date.now();
      const momentumMult = sessionMomentumMultiplier(session);

      // View duration: legacy signal from post-detail view (not TikTok mode)
      if (signal === "view_duration" && duration > 0) {
        if (duration < 3) {
          // < 3s = no meaningful data, skip entirely
        } else if (duration < 15) {
          SIGNAL_ALPHA.view_duration = (0.3 + duration * 0.05) * momentumMult;
          PROFILE_DELTA.view_duration = 0.3 * momentumMult;
        } else {
          SIGNAL_ALPHA.view_duration = (1.0 + Math.min(duration, 60) * 0.02) * momentumMult;
          PROFILE_DELTA.view_duration = 0.8 * momentumMult;
        }
      }

      // V6 Attention signal: tiered watch-depth scoring
      // Research basis (TikTok/YouTube Shorts): treat as tiers not a continuous score.
      // App guarantees duration >= 3s before sending — no negative branch needed.
      // Tiers:  brief (3-10s) → engaged (10-30s) → highly-engaged (30-60s) → loved (60s+)
      // Replay multiplier: each loop adds ×1.5 (capped ×3) — TikTok's #1 engagement signal
      let strongAttention = false; // flag for incremental profile refresh
      if (signal === "attention" && duration >= 3) {
        const completionRate = Math.max(0, Math.min(1, req.body.completionRate ?? 1.0));
        const liked    = req.body.liked === true;
        const replays  = Math.max(0, Math.min(5, req.body.replays ?? 0));

        // Base tier by duration + completion
        let baseAlpha   = 0;
        let baseProfile = 0;
        if (duration >= 60 || completionRate >= 0.90) {
          baseAlpha = 2.5; baseProfile = 2.0; // loved it
        } else if (duration >= 30 || completionRate >= 0.60) {
          baseAlpha = 1.5; baseProfile = 1.2; // highly engaged
        } else if (duration >= 10 || completionRate >= 0.30) {
          baseAlpha = 0.8; baseProfile = 0.6; // engaged
        } else {
          baseAlpha = 0.3; baseProfile = 0.2; // brief interest (3-10s, < 30% completion)
        }

        // Like multiplier: action confirms interest (TikTok research: like + watch = top signal)
        const likeMult   = liked ? 1.8 : 1.0;
        // Replay multiplier: each replay ×1.5, capped at ×3.0
        const replayMult = replays > 0 ? Math.min(1.5 * replays, 3.0) : 1.0;

        SIGNAL_ALPHA.attention  = baseAlpha   * likeMult * replayMult * momentumMult;
        PROFILE_DELTA.attention = baseProfile * likeMult * replayMult * momentumMult;

        // Track session engagement
        session.viewCount++;
        if (duration >= ENGAGED_THRESHOLD_S) session.engagedCount++;

        // Flag for incremental refresh if highly engaged (will rebuild profile sooner)
        strongAttention = SIGNAL_ALPHA.attention >= 1.5;

        console.log(`[signal/v6] Attention post ${postId}: dur=${duration.toFixed(1)}s completion=${completionRate.toFixed(2)} liked=${liked} replays=${replays} → α=${SIGNAL_ALPHA.attention.toFixed(2)} Δprofile=${PROFILE_DELTA.attention.toFixed(2)} momentum=${momentumMult.toFixed(2)}`);
      }

      const alphaDelta   = SIGNAL_ALPHA[signal]  ?? 0;
      const betaDelta    = SIGNAL_BETA[signal]   ?? 0;
      const profileDelta = PROFILE_DELTA[signal] ?? 0;

      const updateAll = db.transaction(() => {
        for (const tag of tags) {
          const tw = TAG_TYPE_WEIGHT[tag.type] ?? 1;
          // Update bandit arm α/β
          if (alphaDelta > 0 || betaDelta > 0) {
            const existing = stmtGetArm.get(userId, tag.value);
            const newAlpha = (existing?.alpha ?? BANDIT_PRIOR_ALPHA) + alphaDelta * tw;
            const newBeta  = (existing?.beta  ?? BANDIT_PRIOR_BETA)  + betaDelta * tw;
            stmtUpsertArm.run(userId, tag.value, newAlpha, newBeta);
          }
          // Update profile score
          if (profileDelta !== 0) {
            profile[tag.value] = Math.max(0, (profile[tag.value] ?? 0) + profileDelta * tw);
          }
        }
        stmtUpsertProfile.run(userId, username, JSON.stringify(profile));
        // Record co-occurrence for strong positive signals
        if (signal === "like" || signal === "bookmark" || signal === "super_like" ||
            (signal === "attention" && alphaDelta >= 1.0)) {
          recordCooccurrence(userId, tags);
        }
      });
      updateAll();

      // Trigger async incremental profile refresh for highly-engaged attention signals
      // so the next recommendation batch reflects this session's strong interests immediately
      if (strongAttention) {
        refreshProfile(userId, req.r34jwt, true, username).catch(() => {});
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(`[signal] Error for user ${userId}:`, e.message);
    res.status(500).json({ error: "Signal processing failed" });
  }
});

// ── Admin auth middleware ────────────────────────────────────────────
function adminAuth(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Admin UI — serve dashboard HTML
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// Admin: server summary for all users
app.get('/admin/users', adminAuth, (req, res) => {
  const users = db.prepare(`SELECT user_id, username, tags_json, refreshed FROM user_profiles ORDER BY user_id`).all();
  const armCountStmt = db.prepare(`SELECT COUNT(*) as c FROM bandit_arms WHERE user_id = ?`);
  const result = users.map(u => {
    const tags = JSON.parse(u.tags_json || '{}');
    const topTags = Object.entries(tags)
      .sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([tag, score]) => ({ tag, score: parseFloat(Number(score).toFixed(3)) }));
    const seenCount = stmtSeenCount.get(u.user_id)?.c ?? 0;
    const armCount  = armCountStmt.get(u.user_id)?.c ?? 0;
    return { userId: u.user_id, username: u.username ?? null, topTags, seenCount, armCount, lastRefreshed: u.refreshed, totalTags: Object.keys(tags).length };
  });
  res.json(result);
});

// Admin: full profile for one user
app.get('/admin/user/:userId', adminAuth, (req, res) => {
  const userId  = parseInt(req.params.userId, 10);
  const profile = stmtGetProfile.get(userId);
  if (!profile) return res.status(404).json({ error: 'User not found' });
  const tags    = JSON.parse(profile.tags_json || '{}');
  const topTags = Object.entries(tags)
    .sort((a, b) => b[1] - a[1]).slice(0, 50)
    .map(([tag, score]) => ({ tag, score: parseFloat(Number(score).toFixed(3)) }));
  const seenCount = stmtSeenCount.get(userId)?.c ?? 0;
  const armCount  = db.prepare(`SELECT COUNT(*) as c FROM bandit_arms WHERE user_id = ?`).get(userId)?.c ?? 0;
  res.json({ userId, username: profile.username ?? null, topTags, seenCount, armCount, lastRefreshed: profile.refreshed, totalTags: Object.keys(tags).length });
});

// Admin: remove all data for a user
app.delete('/admin/user/:userId', adminAuth, (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  db.transaction(() => {
    db.prepare(`DELETE FROM user_profiles   WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM seen_posts      WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM signals         WHERE user_id = ?`).run(userId);
    stmtDeleteArms.run(userId);
    stmtDeleteCooccurrence.run(userId);
    stmtClearCursors.run(userId);
  })();
  console.log(`[admin] Removed all data for user ${userId}`);
  res.json({ ok: true });
});

// Admin: clear only seen posts (keeps profile + bandit arms)
app.post('/admin/user/:userId/clear-seen', adminAuth, (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  db.prepare(`DELETE FROM seen_posts WHERE user_id = ?`).run(userId);
  console.log(`[admin] Cleared seen posts for user ${userId}`);
  res.json({ ok: true });
});

// Admin: force full profile rebuild on next recommendation request
app.post('/admin/user/:userId/expire', adminAuth, (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  db.prepare(`UPDATE user_profiles SET refreshed = datetime('now', '-48 hours') WHERE user_id = ?`).run(userId);
  stmtClearCursors.run(userId);
  console.log(`[admin] Force-expired profile for user ${userId}`);
  res.json({ ok: true });
});

// Admin: bandit arms for a user (tag exploitation scores)
app.get('/admin/user/:userId/arms', adminAuth, (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const arms = stmtGetArms.all(userId)
    .map(r => ({
      tag: r.tag, alpha: r.alpha, beta: r.beta,
      estRate: parseFloat((r.alpha / (r.alpha + r.beta)).toFixed(4))
    }))
    .sort((a, b) => b.estRate - a.estRate);
  res.json(arms);
});

// Admin: recent signals for a user
app.get('/admin/user/:userId/signals', adminAuth, (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const rows = db.prepare(
    `SELECT post_id, signal, created_at FROM signals WHERE user_id = ? ORDER BY id DESC LIMIT 30`
  ).all(userId);
  res.json(rows);
});

// Admin: decay all bandit arms toward prior (run weekly to allow taste evolution)
// α shrinks by 8%, β by 4%, both floored at their prior values
app.post('/admin/users/decay-arms', adminAuth, (req, res) => {
  const allArms = db.prepare(`SELECT user_id, tag, alpha, beta FROM bandit_arms`).all();
  const decay = db.transaction(() => {
    for (const row of allArms) {
      const newAlpha = Math.max(BANDIT_PRIOR_ALPHA, row.alpha * 0.92);
      const newBeta  = Math.max(BANDIT_PRIOR_BETA,  row.beta  * 0.96);
      stmtUpsertArm.run(row.user_id, row.tag, newAlpha, newBeta);
    }
  });
  decay();
  console.log(`[admin] Decayed ${allArms.length} bandit arms toward prior`);
  res.json({ ok: true, armsDecayed: allArms.length });
});

// Admin: expire ALL profiles at once
app.post('/admin/users/expire-all', adminAuth, (req, res) => {
  db.exec(`UPDATE user_profiles SET refreshed = datetime('now', '-48 hours')`);
  db.exec(`DELETE FROM profile_cursors`);
  const count = db.prepare(`SELECT COUNT(*) as c FROM user_profiles`).get().c;
  console.log(`[admin] Expired all ${count} user profiles`);
  res.json({ ok: true, count });
});

// Admin: clear ALL seen posts globally
app.post('/admin/users/clear-all-seen', adminAuth, (req, res) => {
  const count = db.prepare(`SELECT COUNT(*) as c FROM seen_posts`).get().c;
  db.exec(`DELETE FROM seen_posts`);
  console.log(`[admin] Cleared all ${count} seen post records globally`);
  res.json({ ok: true, count });
});

// Force refresh profile from liked/bookmarked history
app.post("/api/profile/refresh", jwtAuth, async (req, res) => {
  const userId = req.r34user.id;
  try {
    const tagScore = await refreshProfile(userId, req.r34jwt, false, req.r34user.username ?? req.r34user.name ?? null);
    const topTags = Object.entries(tagScore)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([v]) => v);
    res.json({ ok: true, topTags });
  } catch (e) {
    console.error(`[refresh] Error for user ${userId}:`, e.message);
    res.status(500).json({ error: "Profile refresh failed" });
  }
});

// Reset seen posts (let user start fresh)
app.post("/api/profile/reset", jwtAuth, (req, res) => {
  const userId = req.r34user.id;
  try {
    db.prepare("DELETE FROM seen_posts WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_profiles WHERE user_id = ?").run(userId);
    stmtDeleteArms.run(userId);
    stmtDeleteCooccurrence.run(userId);
    stmtClearCursors.run(userId);
    console.log(`[reset] User ${userId} profile + bandit arms + co-occurrence + cursors cleared`);
    res.json({ ok: true });
  } catch (e) {
    console.error(`[reset] Error for user ${userId}:`, e.message);
    res.status(500).json({ error: "Reset failed" });
  }
});

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[init] Recommendation server v5 listening on port ${PORT}`);
  console.log(`[init] Admin UI: http://localhost:${PORT}/admin${ADMIN_TOKEN ? ' (token protected)' : ' (no auth)'}`);
  console.log(`[init] Incremental TTL: ${INCREMENTAL_TTL_MS / 60000}min | Full rebuild: ${FULL_REBUILD_TTL_MS / 3600000}h | Max seen: ${MAX_SEEN} | Decay \u03bb: ${DECAY_LAMBDA}`);
  console.log(`[init] Diversity caps: artist=${DIVERSITY_ARTIST_CAP}, character=${DIVERSITY_CHAR_CAP}`);
  console.log(`[init] Bandit prior: Beta(${BANDIT_PRIOR_ALPHA}, ${BANDIT_PRIOR_BETA})`);
});
