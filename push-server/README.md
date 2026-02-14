# Rule34Vault Push Notification Server

Sends push notifications to app users when new posts appear in their subscribed feed.

## Setup on TrueNAS Scale

### 1. Generate secrets

Run these on any machine to generate your secrets:

```bash
# Generate a 64-char hex encryption key
openssl rand -hex 32

# Generate an API secret
openssl rand -base64 32
```

### 2. Edit docker-compose.yml

Replace the placeholder values:

- `ENCRYPTION_KEY` → your 64-char hex key from step 1
- `API_SECRET` → your random API secret from step 1
- `TUNNEL_TOKEN` → your Cloudflare tunnel token

### 3. Deploy on TrueNAS Scale

Copy the `push-server` folder to your TrueNAS, then:

```bash
cd push-server
docker-compose up -d
```

Or use the TrueNAS Apps UI to create a custom Docker app.

### 4. Verify

```bash
# Check health
curl https://push.lucario.click/api/health

# Should return:
# {"status":"ok","activeUsers":0}
```

## How it works

1. Users enable push notifications in the app
2. App sends their Expo push token + auth cookie to this server
3. Server polls rule34vault.com every 5 minutes for each registered user
4. When new posts are detected, sends a push notification via Expo Push Service
5. Auth cookies are encrypted at rest with AES-256-GCM

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4829` | Server port |
| `POLL_INTERVAL` | `300000` | Poll interval in ms (5 min) |
| `ENCRYPTION_KEY` | random | 64-char hex key for encrypting auth cookies |
| `API_SECRET` | `change-me...` | Shared secret for API authentication |
