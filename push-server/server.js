// Load env from parent .env for local dev (Docker passes env vars directly)
try { require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") }); } catch {}
const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const admin = require("firebase-admin");

// ── Config ──────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "4829", 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL || "300000", 10); // 5 min default
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");

const R34_BASE = process.env.R34_API_BASE || "https://rule34vault.com";

// ══════════════════════════════════════════════════════════════════════
// MASTER TOGGLE — set to true to enable spam filtering & scanning
// ══════════════════════════════════════════════════════════════════════
const SPAM_ENABLED = false;

// ── Firebase Admin SDK ──────────────────────────────────────────────
const serviceAccount = require("./firebase-credentials.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
console.log("[init] Firebase Admin SDK initialized for project:", serviceAccount.project_id);

// ── Encryption helpers (AES-256-GCM) ────────────────────────────────
const ENC_ALGO = "aes-256-gcm";
const KEY_BUF = Buffer.from(ENCRYPTION_KEY.padEnd(64, "0").slice(0, 64), "hex");

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENC_ALGO, KEY_BUF, iv);
  let enc = cipher.update(text, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return iv.toString("hex") + ":" + tag + ":" + enc;
}

function decrypt(data) {
  const [ivHex, tagHex, enc] = data.split(":");
  const decipher = crypto.createDecipheriv(ENC_ALGO, KEY_BUF, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let dec = decipher.update(enc, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

// ── Database setup ──────────────────────────────────────────────────
const dbPath = path.join(__dirname, "data", "push.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    push_token TEXT NOT NULL,
    auth_cookie_enc TEXT NOT NULL,
    last_count INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

const stmtUpsert = db.prepare(`
  INSERT INTO users (user_id, push_token, auth_cookie_enc, last_count, enabled, updated_at)
  VALUES (?, ?, ?, 0, 1, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    push_token = excluded.push_token,
    auth_cookie_enc = excluded.auth_cookie_enc,
    enabled = 1,
    updated_at = datetime('now')
`);

const stmtDisable = db.prepare(`
  UPDATE users SET enabled = 0, updated_at = datetime('now') WHERE user_id = ?
`);

const stmtGetEnabled = db.prepare(`SELECT * FROM users WHERE enabled = 1`);

const stmtUpdateCount = db.prepare(`
  UPDATE users SET last_count = ?, updated_at = datetime('now') WHERE user_id = ?
`);

// ── Spam blocklist tables ───────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS spam_blocklist (
    comment_id INTEGER PRIMARY KEY,
    reason TEXT DEFAULT 'auto',
    content_norm TEXT,
    content_preview TEXT,
    user_id INTEGER,
    detected_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS spam_reports (
    comment_id INTEGER NOT NULL,
    reporter_user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (comment_id, reporter_user_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS spam_scan_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    cursor TEXT,
    total_scanned INTEGER DEFAULT 0,
    total_spam INTEGER DEFAULT 0,
    scanning INTEGER DEFAULT 0,
    last_scan TEXT
  )
`);

// ── Distributed scan work queue ───────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS spam_work_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_token TEXT UNIQUE NOT NULL,
    cursor_value TEXT,
    claimed_by INTEGER NOT NULL,
    claimed_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT DEFAULT 'claimed',
    comments_received INTEGER DEFAULT 0,
    spam_found INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS spam_distributed_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    cursor TEXT,
    total_assigned INTEGER DEFAULT 0,
    total_completed INTEGER DEFAULT 0,
    total_scanned INTEGER DEFAULT 0,
    total_spam INTEGER DEFAULT 0
  )
`);
db.prepare(`INSERT OR IGNORE INTO spam_distributed_state (id) VALUES (1)`).run();

// Ensure scan state row exists
db.prepare(`INSERT OR IGNORE INTO spam_scan_state (id) VALUES (1)`).run();

// Expire stale claims older than 5 minutes
const CLAIM_TTL_MS = 5 * 60 * 1000;
function expireStaleClaims() {
  const cutoff = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  db.prepare(`UPDATE spam_work_units SET status = 'expired' WHERE status = 'claimed' AND claimed_at < ?`).run(cutoff);
}

const stmtAddSpam = db.prepare(`INSERT OR IGNORE INTO spam_blocklist (comment_id, reason, content_norm, content_preview, user_id) VALUES (?, ?, ?, ?, ?)`);
const stmtGetBlocklist = db.prepare(`SELECT comment_id FROM spam_blocklist`);
const stmtGetBlocklistSince = db.prepare(`SELECT comment_id FROM spam_blocklist WHERE detected_at > ?`);
const stmtBlocklistCount = db.prepare(`SELECT COUNT(*) as c FROM spam_blocklist`);
const stmtAddReport = db.prepare(`INSERT OR IGNORE INTO spam_reports (comment_id, reporter_user_id) VALUES (?, ?)`);
const stmtReportCount = db.prepare(`SELECT COUNT(*) as c FROM spam_reports WHERE comment_id = ?`);
const stmtGetScanState = db.prepare(`SELECT * FROM spam_scan_state WHERE id = 1`);
const stmtUpdateScanState = db.prepare(`UPDATE spam_scan_state SET cursor = ?, total_scanned = ?, total_spam = ?, scanning = ?, last_scan = datetime('now') WHERE id = 1`);

// ── Express API ─────────────────────────────────────────────────────
const app = express();

// CORS middleware for web app
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, If-None-Match");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());

// Auth middleware — validates user's rule34vault JWT by calling their API
// Returns the verified user object on req.r34user
async function jwtAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const jwt = authHeader.slice(7);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(`${R34_BASE}/api/v2/account/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      console.warn(`[auth] JWT verification failed: HTTP ${resp.status}`);
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    const user = await resp.json();
    if (!user || !user.id) {
      return res.status(401).json({ error: "Could not identify user" });
    }
    req.r34user = user;
    req.r34jwt = jwt;
    next();
  } catch (e) {
    console.error("[auth] JWT verification error:", e.message);
    return res.status(500).json({ error: "Auth verification failed" });
  }
}

// Register / update push token
app.post("/api/register", jwtAuth, (req, res) => {
  const userId = req.r34user.id;
  const jwt = req.r34jwt;
  const { pushToken } = req.body;
  if (!pushToken) {
    return res.status(400).json({ error: "Missing pushToken" });
  }
  try {
    const encCookie = encrypt(jwt);
    stmtUpsert.run(userId, pushToken, encCookie);
    console.log(`[register] User ${userId} registered`);
    res.json({ ok: true });
  } catch (e) {
    console.error("[register] Error:", e.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// Unregister (disable notifications)
app.post("/api/unregister", jwtAuth, (req, res) => {
  const userId = req.r34user.id;
  try {
    stmtDisable.run(userId);
    console.log(`[unregister] User ${userId} disabled`);
    res.json({ ok: true });
  } catch (e) {
    console.error("[unregister] Error:", e.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE enabled = 1").get();
  const spamCount = stmtBlocklistCount.get();
  const scanState = stmtGetScanState.get();
  res.json({
    status: "ok",
    activeUsers: count.c,
    spamBlocklist: spamCount.c,
    scanning: !!scanState.scanning,
    totalScanned: scanState.total_scanned,
  });
});

// ── Spam blocklist endpoints (only active when SPAM_ENABLED = true) ──
if (SPAM_ENABLED) {

// Get blocklist metadata (for cache validation)
let blocklistEtag = null;
let blocklistEtagTime = 0;
function getBlocklistEtag() {
  const now = Date.now();
  // Refresh ETag every 60 seconds
  if (!blocklistEtag || now - blocklistEtagTime > 60000) {
    const count = stmtBlocklistCount.get().c;
    const lastEntry = db.prepare(`SELECT MAX(detected_at) as latest FROM spam_blocklist`).get();
    blocklistEtag = `"${count}-${lastEntry.latest || 'empty'}"`;
    blocklistEtagTime = now;
  }
  return blocklistEtag;
}

// Get the full blocklist (JSON format with ETag caching)
app.get("/api/spam/list", (req, res) => {
  const since = req.query.since; // optional: only get new entries since timestamp
  
  // ETag caching for full fetches (not delta)
  if (!since) {
    const etag = getBlocklistEtag();
    res.set("ETag", etag);
    res.set("Cache-Control", "private, max-age=60");
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end(); // Not Modified
    }
  }
  
  let rows;
  if (since) {
    rows = stmtGetBlocklistSince.all(since);
  } else {
    rows = stmtGetBlocklist.all();
  }
  res.json({ ids: rows.map((r) => r.comment_id), count: rows.length });
});

// Binary format blocklist (much smaller, ~4 bytes per ID vs ~8 in JSON)
// Returns: 4-byte count (uint32 BE) + N x 4-byte IDs (uint32 BE)
app.get("/api/spam/list.bin", (req, res) => {
  const etag = getBlocklistEtag();
  res.set("ETag", etag);
  res.set("Cache-Control", "private, max-age=60");
  res.set("Content-Type", "application/octet-stream");
  
  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }
  
  const rows = stmtGetBlocklist.all();
  const buf = Buffer.alloc(4 + rows.length * 4);
  buf.writeUInt32BE(rows.length, 0);
  for (let i = 0; i < rows.length; i++) {
    buf.writeUInt32BE(rows[i].comment_id, 4 + i * 4);
  }
  res.send(buf);
});

// Report a comment as spam (requires auth, 2+ reports = auto-blocklist)
app.post("/api/spam/report", jwtAuth, (req, res) => {
  const userId = req.r34user.id;
  const { commentIds } = req.body;
  if (!Array.isArray(commentIds) || commentIds.length === 0) {
    return res.status(400).json({ error: "Missing commentIds array" });
  }
  // Limit to 100 per request
  const ids = commentIds.slice(0, 100);
  let added = 0;
  for (const cid of ids) {
    if (typeof cid !== "number") continue;
    stmtAddReport.run(cid, userId);
    const count = stmtReportCount.get(cid);
    if (count.c >= 2) {
      stmtAddSpam.run(cid, "user_reported");
      added++;
    }
  }
  console.log(`[spam] User ${userId} reported ${ids.length} comments, ${added} added to blocklist`);
  res.json({ ok: true, reported: ids.length, blocked: added });
});

// Get spam groups — grouped by normalized message, with counts
app.get("/api/spam/groups", (req, res) => {
  // Group by normalized content when available, otherwise group by individual comment
  const rows = db.prepare(`
    SELECT 
      COALESCE(content_norm, 'comment_' || comment_id) as content_norm,
      COALESCE(content_preview, LEFT('No preview available', 50)) as content_preview,
      COUNT(*) as count,
      MIN(detected_at) as first_seen,
      MAX(detected_at) as last_seen
    FROM spam_blocklist
    GROUP BY COALESCE(content_norm, 'comment_' || comment_id)
    ORDER BY count DESC
    LIMIT 200
  `).all();
  const total = stmtBlocklistCount.get();
  res.json({ groups: rows, totalBlocked: total.c });
});

// Get individual spam comments for a specific group
app.get("/api/spam/group/:norm", (req, res) => {
  const norm = decodeURIComponent(req.params.norm);
  let rows;
  if (norm.startsWith("comment_")) {
    // Individual comment (no content_norm)
    const commentId = parseInt(norm.replace("comment_", ""));
    rows = db.prepare(`
      SELECT comment_id, content_preview, user_id, detected_at
      FROM spam_blocklist
      WHERE comment_id = ?
      ORDER BY detected_at DESC
      LIMIT 100
    `).all(commentId);
  } else {
    // Normalized group
    rows = db.prepare(`
      SELECT comment_id, content_preview, user_id, detected_at
      FROM spam_blocklist
      WHERE content_norm = ?
      ORDER BY detected_at DESC
      LIMIT 100
    `).all(norm);
  }
  res.json({ comments: rows, count: rows.length });
});

// Scan status
app.get("/api/spam/status", (req, res) => {
  const state = stmtGetScanState.get();
  const count = stmtBlocklistCount.get();
  res.json({
    scanning: !!state.scanning,
    totalScanned: state.total_scanned,
    totalSpam: count.c,
    lastScan: state.last_scan,
  });
});

// ── Distributed scanning endpoints ───────────────────────────────────

// Claim a work unit — client gets a cursor to fetch comments from
app.post("/api/spam/claim-work", jwtAuth, (req, res) => {
  const userId = req.r34user.id;

  // Expire stale claims first
  expireStaleClaims();

  // Rate limit: max 1 active claim per user
  const activeClaim = db.prepare(
    `SELECT id FROM spam_work_units WHERE claimed_by = ? AND status = 'claimed'`
  ).get(userId);
  if (activeClaim) {
    return res.status(429).json({ error: "You already have an active work unit. Submit or wait for it to expire." });
  }

  // Get the distributed scan cursor (separate from auto-scan)
  const distState = db.prepare(`SELECT * FROM spam_distributed_state WHERE id = 1`).get();
  const cursor = distState.cursor || null; // null = start from beginning

  // Generate a secure claim token
  const claimToken = crypto.randomBytes(24).toString("hex");

  // Create the work unit
  db.prepare(`
    INSERT INTO spam_work_units (claim_token, cursor_value, claimed_by)
    VALUES (?, ?, ?)
  `).run(claimToken, cursor, userId);

  // Update total assigned
  db.prepare(`UPDATE spam_distributed_state SET total_assigned = total_assigned + 1 WHERE id = 1`).run();

  console.log(`[dist-scan] User ${userId} claimed work unit, cursor=${cursor || 'beginning'}`);
  res.json({
    claimToken,
    cursor,
    batchSize: 50,
    fetchUrl: `${R34_BASE}/api/v2/comments/recent?limit=50${cursor ? '&cursor=' + cursor : ''}`,
  });
});

// Submit scanned comments — server validates and runs its own detection
app.post("/api/spam/submit-work", jwtAuth, (req, res) => {
  const userId = req.r34user.id;
  const { claimToken, comments, nextCursor } = req.body;

  // Validate claim token
  if (!claimToken || typeof claimToken !== "string") {
    return res.status(400).json({ error: "Missing claimToken" });
  }

  const workUnit = db.prepare(
    `SELECT * FROM spam_work_units WHERE claim_token = ? AND claimed_by = ? AND status = 'claimed'`
  ).get(claimToken, userId);

  if (!workUnit) {
    return res.status(403).json({ error: "Invalid, expired, or already-submitted claim token" });
  }

  // Validate comments array
  if (!Array.isArray(comments) || comments.length === 0) {
    return res.status(400).json({ error: "comments must be a non-empty array" });
  }
  if (comments.length > 100) {
    return res.status(400).json({ error: "Too many comments in one submission (max 100)" });
  }

  // Validate each comment has required fields and types
  for (const c of comments) {
    if (!c || typeof c.id !== "number" || typeof c.content !== "string" || typeof c.userId !== "number") {
      return res.status(400).json({ error: "Each comment must have numeric id, string content, numeric userId" });
    }
    if (c.content.length > 5000) {
      return res.status(400).json({ error: "Comment content too long (max 5000 chars)" });
    }
  }

  // ── Server runs its OWN spam detection on the raw data ──
  // Client cannot fake results — we detect spam ourselves
  const spamEntries = detectSpamInBatch(comments);
  let added = 0;
  for (const entry of spamEntries) {
    try {
      stmtAddSpam.run(entry.id, "distributed_scan", entry.norm, entry.preview, entry.userId);
      added++;
    } catch { /* INSERT OR IGNORE — already exists */ }
  }

  // Advance the distributed cursor only if this is the expected next step
  // (prevents a stale/replayed submission from rewinding the cursor)
  if (nextCursor && typeof nextCursor === "string") {
    const currentState = db.prepare(`SELECT cursor FROM spam_distributed_state WHERE id = 1`).get();
    if (currentState.cursor === workUnit.cursor_value || currentState.cursor === null) {
      db.prepare(`UPDATE spam_distributed_state SET cursor = ?, total_completed = total_completed + 1, total_scanned = total_scanned + ?, total_spam = total_spam + ? WHERE id = 1`).run(nextCursor, comments.length, added);
    } else {
      // Cursor already advanced past this work unit (overlap protection)
      db.prepare(`UPDATE spam_distributed_state SET total_completed = total_completed + 1, total_scanned = total_scanned + ?, total_spam = total_spam + ? WHERE id = 1`).run(comments.length, added);
    }
  }

  // Mark work unit as completed
  db.prepare(`
    UPDATE spam_work_units
    SET status = 'completed', completed_at = datetime('now'), comments_received = ?, spam_found = ?
    WHERE id = ?
  `).run(comments.length, added, workUnit.id);

  console.log(`[dist-scan] User ${userId} submitted ${comments.length} comments, ${added} new spam detected`);
  res.json({ ok: true, commentsProcessed: comments.length, spamDetected: spamEntries.length, newSpamAdded: added });
});

// Distributed scan status
app.get("/api/spam/distributed-status", (req, res) => {
  const state = db.prepare(`SELECT * FROM spam_distributed_state WHERE id = 1`).get();
  const activeClaims = db.prepare(`SELECT COUNT(*) as c FROM spam_work_units WHERE status = 'claimed'`).get();
  const blocklist = stmtBlocklistCount.get();
  res.json({
    cursor: state.cursor,
    totalAssigned: state.total_assigned,
    totalCompleted: state.total_completed,
    totalScanned: state.total_scanned,
    totalSpam: state.total_spam,
    activeWorkers: activeClaims.c,
    totalBlocked: blocklist.c,
  });
});

// Trigger a scan (start/stop)
app.post("/api/spam/scan", jwtAuth, (req, res) => {
  const { action } = req.body; // "start" or "stop"
  if (action === "start") {
    const state = stmtGetScanState.get();
    if (state.scanning) {
      return res.json({ ok: false, message: "Already scanning" });
    }
    startSpamScan();
    res.json({ ok: true, message: "Scan started" });
  } else if (action === "stop") {
    stopSpamScan();
    res.json({ ok: true, message: "Scan stopped" });
  } else {
    res.status(400).json({ error: 'action must be "start" or "stop"' });
  }
});

} // end if (SPAM_ENABLED)

// Device reports new posts (device-side polling)
app.post("/api/new-posts", jwtAuth, (req, res) => {
  const userId = req.r34user.id;
  const { count } = req.body;
  if (count === undefined) {
    return res.status(400).json({ error: "Missing count" });
  }
  try {
    const user = db.prepare("SELECT * FROM users WHERE user_id = ? AND enabled = 1").get(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found or disabled" });
    }
    
    // Only send push if count increased
    if (count > user.last_count && user.last_count >= 0) {
      const diff = count - user.last_count;
      if (diff > 0) {
        console.log("[device-poll] User " + userId + ": " + diff + " new posts (" + user.last_count + " -> " + count + ")");
        sendPush(
          user.push_token,
          "New Feed Posts",
          "You have " + count + " new post" + (count > 1 ? "s" : "") + " from your subscribed tags"
        );
      }
    }
    
    // Update count
    stmtUpdateCount.run(count, userId);
    res.json({ ok: true });
  } catch (e) {
    console.error("[device-poll] Error:", e.message);
    res.status(500).json({ error: "Internal error" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Push server running on port ${PORT}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
});

// ── Server-side spam detection ───────────────────────────────────────
const SPAM_SIMILARITY_THRESHOLD = 0.75;
const SPAM_MIN_LENGTH = 2;
const SPAM_URL_THRESHOLD = 2;
const SPAM_REPEATED_CHAR_THRESHOLD = 0.6;
const SCAN_BATCH_SIZE = 50;
const SCAN_DELAY_MS = 3000; // 3 seconds between API calls

function spamNormalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function spamBigrams(str) {
  const s = str.toLowerCase().trim();
  const bg = new Set();
  for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
  return bg;
}

function spamDice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ba = spamBigrams(a);
  const bb = spamBigrams(b);
  let inter = 0;
  for (const x of ba) if (bb.has(x)) inter++;
  return (2 * inter) / (ba.size + bb.size);
}

function spamHasExcessiveUrls(text) {
  const m = text.match(/https?:\/\/[^\s]+/gi);
  return (m ? m.length : 0) >= SPAM_URL_THRESHOLD;
}

function spamHasRepeatedChars(text) {
  if (text.length < 10) return false;
  const cleaned = text.replace(/\s/g, "");
  if (cleaned.length < 5) return false;
  const counts = {};
  for (const ch of cleaned.toLowerCase()) counts[ch] = (counts[ch] || 0) + 1;
  const max = Math.max(...Object.values(counts));
  return max / cleaned.length > SPAM_REPEATED_CHAR_THRESHOLD;
}

function spamIsGibberish(text) {
  const words = text.toLowerCase().split(/\s+/);
  if (words.length < 4) return false;
  const unique = new Set(words);
  return unique.size / words.length < 0.3;
}

function spamScore(text) {
  let s = 0;
  if (spamHasExcessiveUrls(text)) s += 0.4;
  if (spamHasRepeatedChars(text)) s += 0.3;
  if (spamIsGibberish(text)) s += 0.3;
  return Math.min(s, 1);
}

// Detect spam in a batch of comments, using accumulated content groups
const scanContentGroups = new Map(); // normalized text -> { userIds: Set, commentIds: [] }

function detectSpamInBatch(comments) {
  const spamEntries = []; // { id, norm, preview, userId }

  for (const c of comments) {
    const norm = spamNormalize(c.content);
    const preview = c.content.slice(0, 200);

    // Individual pattern check
    if (spamScore(c.content) >= 0.5) {
      spamEntries.push({ id: c.id, norm, preview, userId: c.userId });
      continue;
    }

    if (norm.length < SPAM_MIN_LENGTH) continue;

    // Check against existing content groups
    let matched = false;
    for (const [key, group] of scanContentGroups) {
      if (spamDice(norm, key) >= SPAM_SIMILARITY_THRESHOLD) {
        group.comments.push({ id: c.id, norm, preview, userId: c.userId });
        group.userIds.add(c.userId);
        matched = true;
        // If group has 3+ unique users or 3+ total, all are spam
        if (group.userIds.size >= 3 || group.comments.length >= 3) {
          for (const entry of group.comments) spamEntries.push(entry);
        }
        break;
      }
    }
    if (!matched) {
      scanContentGroups.set(norm, {
        comments: [{ id: c.id, norm, preview, userId: c.userId }],
        userIds: new Set([c.userId]),
      });
    }
  }

  // Deduplicate
  const seen = new Set();
  return spamEntries.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

// ── Background spam scanner ─────────────────────────────────────────
let scanAbort = false;

function stopSpamScan() {
  scanAbort = true;
  const state = stmtGetScanState.get();
  stmtUpdateScanState.run(state.cursor, state.total_scanned, state.total_spam, 0);
  console.log("[spam-scan] Stopped");
}

async function startSpamScan() {
  scanAbort = false;
  const state = stmtGetScanState.get();
  let cursor = state.cursor || null;
  let totalScanned = state.total_scanned || 0;
  let totalSpam = state.total_spam || 0;

  stmtUpdateScanState.run(cursor, totalScanned, totalSpam, 1);
  console.log(`[spam-scan] Starting from cursor=${cursor || "beginning"}, scanned=${totalScanned}, spam=${totalSpam}`);

  while (!scanAbort) {
    try {
      // Fetch a batch of comments from the site
      const body = { take: SCAN_BATCH_SIZE };
      if (cursor) body.cursor = cursor;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(`${R34_BASE}/api/v2/comment/post`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        console.warn(`[spam-scan] HTTP ${resp.status}, retrying in 10s...`);
        await new Promise((r) => setTimeout(r, 10000));
        continue;
      }

      const data = await resp.json();
      if (!data.items || data.items.length === 0) {
        console.log("[spam-scan] No more comments, scan complete");
        break;
      }

      // Run spam detection on this batch
      const spamEntries = detectSpamInBatch(data.items);
      for (const entry of spamEntries) {
        stmtAddSpam.run(entry.id, "auto_scan", entry.norm, entry.preview, entry.userId);
      }

      totalScanned += data.items.length;
      totalSpam += spamEntries.length;
      cursor = data.cursor || null;

      // Save progress
      stmtUpdateScanState.run(cursor, totalScanned, totalSpam, 1);

      if (spamEntries.length > 0) {
        console.log(`[spam-scan] Batch: ${data.items.length} comments, ${spamEntries.length} spam. Total: ${totalScanned} scanned, ${totalSpam} spam`);
      } else if (totalScanned % 500 === 0) {
        console.log(`[spam-scan] Progress: ${totalScanned} scanned, ${totalSpam} spam`);
      }

      // No more pages
      if (!data.cursor) {
        console.log("[spam-scan] Reached end of comments");
        break;
      }

      // Rate limit — wait between requests
      await new Promise((r) => setTimeout(r, SCAN_DELAY_MS));
    } catch (e) {
      if (scanAbort) break;
      console.error("[spam-scan] Error:", e.message);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  // Mark scan as finished
  stmtUpdateScanState.run(cursor, totalScanned, totalSpam, 0);
  scanContentGroups.clear();
  const blockCount = stmtBlocklistCount.get();
  console.log(`[spam-scan] Finished. Scanned ${totalScanned} comments, ${blockCount.c} total in blocklist`);
}

// ── Polling loop ────────────────────────────────────────────────────
async function checkFeedForUser(user) {
  try {
    const token = decrypt(user.auth_cookie_enc);

    const url = `${R34_BASE}/api/v2/user-feed/count`;
    // Check feed count using user's JWT token (POST /api/v2/user-feed/count)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await resp.text();

    if (!resp.ok) {
      console.warn(`[poll] User ${user.user_id}: HTTP ${resp.status} — ${text.slice(0, 120)}`);
      return;
    }

    // Check if response is actually JSON (not HTML)
    if (text.startsWith("<!") || text.startsWith("<html")) {
      console.warn(`[poll] User ${user.user_id}: Got HTML instead of JSON (status ${resp.status}). First 120 chars: ${text.slice(0, 120)}`);
      return;
    }

    let newCount;
    try {
      newCount = JSON.parse(text);
    } catch {
      console.warn(`[poll] User ${user.user_id}: Invalid JSON: ${text.slice(0, 120)}`);
      return;
    }

    if (typeof newCount !== "number") {
      console.warn(`[poll] User ${user.user_id}: unexpected response type (${typeof newCount}):`, newCount);
      return;
    }

    // New posts detected
    if (newCount > user.last_count && user.last_count >= 0) {
      const diff = newCount - user.last_count;
      if (diff > 0) {
        console.log(`[poll] User ${user.user_id}: ${diff} new posts (${user.last_count} → ${newCount})`);
        await sendPush(
          user.push_token,
          "New Feed Posts",
          `You have ${newCount} new post${newCount > 1 ? "s" : ""} from your subscribed tags`
        );
      }
    }

    stmtUpdateCount.run(newCount, user.user_id);
  } catch (e) {
    console.error(`[poll] User ${user.user_id} error:`, e.message);
  }
}

async function sendPush(fcmToken, title, body) {
  try {
    console.log("[push] Sending FCM to " + fcmToken.slice(0, 20) + "...");
    const message = {
      token: fcmToken,
      notification: {
        title: title,
        body: body,
      },
      android: {
        collapseKey: "feed_updates",
        priority: "high",
        notification: {
          channelId: "feed",
          sound: "default",
          priority: "high",
          tag: "feed_updates",
        },
      },
      data: {
        screen: "feed",
        notificationId: "feed_updates",
      },
    };
    const response = await admin.messaging().send(message);
    console.log("[push] FCM sent successfully:", response);
  } catch (e) {
    console.error("[push] FCM error:", e.message);
    if (e.code === "messaging/registration-token-not-registered") {
      console.warn("[push] Token expired/invalid, consider disabling user");
    }
  }
}

async function pollAllUsers() {
  const users = stmtGetEnabled.all();
  if (users.length === 0) return;

  console.log(`[poll] Checking ${users.length} user(s) concurrently...`);

  // Poll all users in parallel — each request uses its own JWT so there is no
  // shared rate-limit concern, and concurrency cuts total cycle time from
  // (N × ~2 s) down to ~2 s regardless of user count.
  await Promise.allSettled(users.map((user) => checkFeedForUser(user)));
}

// Start polling
setInterval(pollAllUsers, POLL_INTERVAL_MS);
// Initial poll after 10 seconds
setTimeout(pollAllUsers, 10000);

// ── Auto-start spam scan if no recent scan ──────────────────────────
if (SPAM_ENABLED) {
  const AUTO_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  setTimeout(() => {
    const state = stmtGetScanState.get();
    const lastScan = state.last_scan ? new Date(state.last_scan).getTime() : 0;
    const elapsed = Date.now() - lastScan;

    if (!state.scanning && elapsed > AUTO_SCAN_INTERVAL_MS) {
      console.log("[spam-scan] No recent scan detected, auto-starting...");
      startSpamScan();
    } else if (state.scanning) {
      console.log("[spam-scan] Resuming interrupted scan...");
      startSpamScan();
    } else {
      const hoursAgo = Math.round(elapsed / 3600000);
      console.log(`[spam-scan] Last scan was ${hoursAgo}h ago, next auto-scan in ${Math.round((AUTO_SCAN_INTERVAL_MS - elapsed) / 3600000)}h`);
    }
  }, 30000); // Wait 30s after boot
  console.log("[init] Push server started, first poll in 10s, spam scan check in 30s");
} else {
  console.log("[init] Push server started, first poll in 10s (spam filter DISABLED)");
}

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log("[shutdown] SIGTERM received, closing gracefully...");
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log("[shutdown] SIGINT received, closing gracefully...");
  process.exit(0);
});
