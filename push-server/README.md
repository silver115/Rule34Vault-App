# Rule34Vault Push Notification Server

Sends push notifications to app users when new posts appear in their subscribed feed.

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
