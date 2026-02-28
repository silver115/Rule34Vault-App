# Rule34Vault Recommendation Server

TikTok-style recommendation engine that runs on your TrueNAS Scale Dockge server.

## How it works

1. **Interest profile** — built from your liked + bookmarked post history. Tags are weighted by type (artist > character > copyright > general), action (bookmark > like), and recency (newer = higher weight). Profile is cached in SQLite and auto-refreshes every 1 hour.

2. **3 candidate pools** fetched in parallel per request:
   - **Core (50%)** — posts matching your top 2 interest tags
   - **Discovery (30%)** — posts matching tags ranked 3–6 (keeps content fresh)
   - **Trending (20%)** — popular posts regardless of tags (wildcard/serendipity)

3. **Seen-post deduplication** — every post shown is recorded in the database. You will never see the same post twice across any session until the pool resets (configurable, default 2000 posts).

4. **Real-time signals** — the app sends back engagement signals (like, skip, watch-complete) which update your profile weights instantly without waiting for the 1-hour refresh.

5. **Page rotation** — each page of recommendations uses a different tag window so each scroll gives genuinely new content.

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
