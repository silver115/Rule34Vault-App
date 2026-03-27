# Rule34Vault Recommendation Server

TikTok-style recommendation engine that runs on your TrueNAS Scale Dockge server.

## How it works (V8)

1. **Interest profile** — built from your liked + bookmarked post history. Tags are weighted by type (artist×5 > character×4 > copyright×3 > general×1), action (super-like×3.5, bookmark×2.5, like×1.2), and recency decay. **Stop-tag blocklist** (~100 generic/anatomy/meta tags like `female`, `ass`, `penis`, `1girls`, `16:9`, `video`) are excluded from ALL scoring and arm creation. Profile is cached in SQLite and auto-refreshes every 5 min (incremental) / 24 h (full rebuild).

2. **7 candidate pools** with **dynamic ratios** based on usage:
   - **Pool 0-1**: Top 2 sampled arms (core interests) — mixed newest/most-liked sort
   - **Pool 2-3**: Next 2 arms (secondary interests)
   - **Pool 4**: Co-occurrence pairs (tag combos that appear together in liked posts)
   - **Pool 5**: Discovery (tags 5-12, adjacent interests)
   - **Pool 6**: Serendipity (high-quality content with NO tag filter — breaks the bubble)
   - Ratios shift from exploit→explore as user sees more content

3. **Seen-post deduplication** — every post shown is recorded. You will never see the same post twice within the suppression window (default 30 days).

4. **V8 real-time signals** — tiered watch-depth scoring based on TikTok/YouTube Shorts research:
   - **Quick scroll (0.5–3s)** → **skip signal** (β +0.8, profile -0.4) — negative feedback!
   - **Brief watch (3–10s, < 30% completion)** → mild positive
   - **Engaged (10–30s or 30–60% completion)** → moderate positive
   - **Highly engaged (30–60s or 60–90%)** → strong positive
   - **Loved (60s+ or 90%+ completion)** → very strong positive
   - **Liked while watching** → ×2.5 multiplier on all tiers (was ×1.8)
   - **Video replay** → ×2.0 per replay (capped ×4.0) — TikTok's #1 engagement signal
   - **Session momentum** — active deep-watch session boosts signals ×1.15; browse session dampens ×0.6

5. **Thompson Sampling bandits** — per-tag α/β arms for exploration/exploitation balance. Stop tags are excluded so arms only track discriminative tags (characters, artists, franchises). Arms decay toward prior weekly (via `/admin/users/decay-arms`).

6. **IDF weighting** — uses log₂ with no floor, so common tags get aggressively downweighted. Stop tags get near-zero (0.05) IDF weight as a safety net.

## Endpoints

| Method | Path                   | Auth       | Description                |
| ------ | ---------------------- | ---------- | -------------------------- |
| GET    | `/api/health`          | None       | Server health check        |
| POST   | `/api/recommendations` | Bearer JWT | Get personalised posts     |
| POST   | `/api/signal`          | Bearer JWT | Send engagement signal     |
| POST   | `/api/profile/refresh` | Bearer JWT | Force rebuild profile      |
| POST   | `/api/profile/reset`   | Bearer JWT | Clear seen posts + profile |

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

| Variable                      | Default                   | Description                                      |
| ----------------------------- | ------------------------- | ------------------------------------------------ |
| `REC_CLOUDFLARE_TUNNEL_TOKEN` | —                         | Cloudflare tunnel token for rec server           |
| `REC_SERVER_PORT`             | `4830`                    | Server port                                      |
| `R34_API_BASE`                | `https://rule34vault.com` | Rule34Vault API base URL                         |
| `INCREMENTAL_TTL`             | `60000`                   | Incremental profile rebuild interval in ms (60s) |
| `FULL_REBUILD_TTL`            | `86400000`                | Full profile rebuild interval in ms (24h)        |
| `PROFILE_TTL`                 | `3600000`                 | Profile cache TTL in ms (1 hour)                 |
| `MAX_SEEN`                    | `5000`                    | Max seen posts stored per user                   |
| `LIKED_HISTORY`               | `100`                     | Liked posts to fetch for profile                 |
| `BOOKMARKED_HISTORY`          | `50`                      | Bookmarked posts to fetch for profile            |
| `DECAY_LAMBDA`                | `0.03`                    | Exponential decay rate for recency               |
| `DIVERSITY_ARTIST_CAP`        | `3`                       | Max posts per artist per page                    |
| `DIVERSITY_CHAR_CAP`          | `5`                       | Max posts per character per page                 |
| `BANDIT_PRIOR_ALPHA`          | `1`                       | Thompson Sampling α prior                        |
| `BANDIT_PRIOR_BETA`           | `10`                      | Thompson Sampling β prior                        |

## App Configuration

Set `REC_SERVER_URL` in the app's environment to your Cloudflare tunnel URL:

```
REC_SERVER_URL=https://rec.yourdomain.com
```

The app falls back to the client-side algorithm automatically if the server is unreachable.
