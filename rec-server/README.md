# Rule34Vault Recommendation Server

TikTok-style recommendation engine that runs on your TrueNAS Scale Dockge server.

## How it works (V6)

1. **Interest profile** — built from your liked + bookmarked post history. Tags are weighted by type (artist > character > copyright > general), action (super-like×3, bookmark×2, like×1), and recency decay. Profile is cached in SQLite and auto-refreshes every 5 min (incremental) / 24 h (full rebuild). Strong engagement triggers an immediate incremental refresh.

2. **4 candidate pools** with **dynamic ratios** based on how much you've used the app:
   - **New user (< 50 seen)** — Core 50% / Discovery 25% / Explore 15% / Co-occurrence 10%
   - **Growing (50–500)** — Core 35% / Discovery 30% / Explore 20% / Co-occurrence 15%
   - **Veteran (500–2000)** — Core 30% / Discovery 30% / Explore 25% / Co-occurrence 15%
   - **Saturated (2000+)** — Core 25% / Discovery 30% / Explore 30% / Co-occurrence 15%

3. **Seen-post deduplication** — every post shown is recorded. You will never see the same post twice within the suppression window (default 30 days).

4. **V6 real-time signals** — tiered watch-depth scoring based on TikTok/YouTube Shorts research:
   - **Immediate scroll (< 3s)** → no signal at all (not enough data to form an opinion)
   - **Brief watch (3–10s, < 30% completion)** → mild positive
   - **Engaged (10–30s or 30–60% completion)** → moderate positive
   - **Highly engaged (30–60s or 60–90%)** → strong positive
   - **Loved (60s+ or 90%+ completion)** → very strong positive
   - **Liked while watching** → ×1.8 multiplier on all tiers
   - **Video replay** → ×1.5 per replay (capped ×3) — TikTok's #1 engagement signal
   - **Session momentum** — active deep-watch session boosts signals ×1.15; browse session dampens ×0.6

5. **Thompson Sampling bandits** — per-tag α/β arms for exploration/exploitation balance. Arms decay toward prior weekly (via `/admin/users/decay-arms`) to allow taste evolution over time.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | None | Server health check |
| POST | `/api/recommendations` | Bearer JWT | Get personalised posts |
| POST | `/api/signal` | Bearer JWT | Send engagement signal |
| POST | `/api/profile/refresh` | Bearer JWT | Force rebuild profile |
| POST | `/api/profile/reset` | Bearer JWT | Clear seen posts + profile |

### POST /api/recommendations
```json
Request:  { "take": 30 }
Response: { "posts": [...], "topTags": ["tag1", "tag2", ...] }
```

### POST /api/signal
```json
Request: { "postId": 12345, "signal": "like", "tags": [...] }
Signals: "like" | "bookmark" | "complete" | "skip"
```

## Dockge Deployment

1. In Dockge, create a new stack called `r34vault-rec`
2. Copy `docker-compose.example.yml` to `docker-compose.yml`
3. Add rec-server config to your main `.env` file (see Environment Variables below)
4. Set the volume path to point to where you store app data on TrueNAS
5. Deploy

## Environment Variables

All config is stored in the **root `.env`** file (unified with push server). The docker-compose references these via `env_file: ../.env`.

| Variable | Default | Description |
|----------|---------|-------------|
| `REC_CLOUDFLARE_TUNNEL_TOKEN` | — | Cloudflare tunnel token for rec server |
| `REC_SERVER_PORT` | `4830` | Server port |
| `R34_API_BASE` | `https://rule34vault.com` | Rule34Vault API base URL |
| `INCREMENTAL_TTL` | `60000` | Incremental profile rebuild interval in ms (60s) |
| `FULL_REBUILD_TTL` | `86400000` | Full profile rebuild interval in ms (24h) |
| `PROFILE_TTL` | `3600000` | Profile cache TTL in ms (1 hour) |
| `MAX_SEEN` | `5000` | Max seen posts stored per user |
| `LIKED_HISTORY` | `100` | Liked posts to fetch for profile |
| `BOOKMARKED_HISTORY` | `50` | Bookmarked posts to fetch for profile |
| `DECAY_LAMBDA` | `0.03` | Exponential decay rate for recency |
| `DIVERSITY_ARTIST_CAP` | `3` | Max posts per artist per page |
| `DIVERSITY_CHAR_CAP` | `5` | Max posts per character per page |
| `BANDIT_PRIOR_ALPHA` | `1` | Thompson Sampling α prior |
| `BANDIT_PRIOR_BETA` | `10` | Thompson Sampling β prior |

## App Configuration

Set `REC_SERVER_URL` in the app's environment to your Cloudflare tunnel URL:
```
REC_SERVER_URL=https://rec.yourdomain.com
```

The app falls back to the client-side algorithm automatically if the server is unreachable.
