const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const admin = require("firebase-admin");

// ── Config ──────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "4829", 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL || "300000", 10); // 5 min default
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");

const R34_BASE = "https://rule34vault.com";

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

// ── Express API ─────────────────────────────────────────────────────
const app = express();
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
  res.json({ status: "ok", activeUsers: count.c });
});

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
        priority: "high",
        notification: {
          channelId: "feed",
          sound: "default",
          priority: "high",
        },
      },
      data: {
        screen: "feed",
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

  console.log(`[poll] Checking ${users.length} user(s)...`);

  // Process users sequentially to avoid hammering the API
  for (const user of users) {
    await checkFeedForUser(user);
    // Small delay between users
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// Start polling
setInterval(pollAllUsers, POLL_INTERVAL_MS);
// Initial poll after 10 seconds
setTimeout(pollAllUsers, 10000);

console.log("[init] Push server started, first poll in 10s");
