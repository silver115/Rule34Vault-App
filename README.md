# Rule34Vault App

A modern Android app for browsing Rule34Vault, built with React Native + Expo. Inspired by Danbooru/e621 browsing apps.
To improve your "For You" feed, this app collects anonymous usage data for personalized suggestions.



## Features

- **Browse Feed** — Infinite-scroll grid of latest posts with thumbnails
- **Post Detail** — Full image/video viewer with metadata, tags (color-coded by type), sources, dimensions
- **Like / Bookmark** — Like and bookmark posts (requires login)
- **Tag Search** — Search tags with trending tags on the homepage
- **Playlists** — Browse public playlists, view playlist posts
- **Profile** — View your stats, sign in/out
- **Dark Theme** — Full dark UI designed for OLED screens

## Tech Stack

- **React Native + Expo** (TypeScript)
- **Expo Router** (file-based navigation)
- **expo-image** (fast image loading with caching)
- **expo-secure-store** (secure credential storage)

## Getting Started

### Prerequisites used

- Node.js 18+
- npm or yarn
- Expo CLI (`npx expo`)
- Android Studio (for emulator) or Expo Go app on your phone


## Project Structure

```
rule34vault-app/
├── api/
│   └── rule34vault.ts        # API client (all endpoints)
├── app/
│   ├── (tabs)/
│   │   ├── _layout.tsx        # Tab navigator (Browse, Search, Playlists, Profile)
│   │   ├── index.tsx          # Browse feed (infinite scroll grid)
│   │   ├── search.tsx         # Tag search
│   │   ├── playlists.tsx      # Public playlist browser
│   │   └── profile.tsx        # Profile & settings
│   ├── post/[id].tsx          # Post detail (image, tags, actions)
│   ├── playlist/[id].tsx      # Playlist detail (posts grid)
│   ├── login.tsx              # Login modal
│   └── _layout.tsx            # Root layout (auth, dark theme)
├── components/
│   ├── PostCard.tsx            # Single post thumbnail card
│   ├── PostGrid.tsx            # Grid layout with pagination
│   ├── PlaylistCard.tsx        # Playlist list item
│   ├── TagChip.tsx             # Color-coded tag pill
│   └── LoadingScreen.tsx       # Loading indicator
├── constants/
│   └── theme.ts                # Dark theme colors, spacing, typography
└── contexts/
    └── AuthContext.tsx          # Auth state (JWT stored in SecureStore)
```

## API Endpoints Used

| Feature | Method | Endpoint |
|---------|--------|----------|
| Login | POST | `/api/v2/auth/signin` |
| Post metadata | GET | `/api/v2/post/{id}` |
| Post feed | POST | `/api/v2/post/search/root` |
| Playlist posts | POST | `/api/v2/post/search/playlist/{id}` |
| Playlist info | GET | `/api/v2/playlist/{id}` |
| Search playlists | POST | `/api/v2/playlist/search` |
| Tags (trending) | GET | `/api/v2/tag` |
| Tags (search) | GET | `/api/v2/tag/search?search=...` |
| Like/unlike | POST | `/api/v2/post-action/like/{id}` |
| Bookmark | POST | `/api/v2/post-action/bookmark/{id}` |
| Action state | GET | `/api/v2/post-action/state/{id}` |
