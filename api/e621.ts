import { Platform } from "react-native";
import type { Post, Tag, UserProfile, PaginatedResponse, AuthResponse, PostActionState, SearchFilters, Playlist, PostComment } from "./rule34vault";

const E621_BASE = "https://e621.net";
const USER_AGENT = "Rule34VaultApp/1.0 (by Puro115 on e621)";

// ── Rate limiter (e621 hard limit: 2 req/s, we target 1 req/s) ──
let lastRequestTime = 0;
async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 600) {
    await new Promise((r) => setTimeout(r, 600 - elapsed));
  }
  lastRequestTime = Date.now();
}

// ── e621 raw types ──
interface E621Post {
  id: number;
  created_at: string;
  updated_at: string;
  file: { width: number; height: number; ext: string; size: number; md5: string; url: string | null };
  preview: { width: number; height: number; url: string | null };
  sample: { has: boolean; width: number; height: number; url: string | null };
  score: { up: number; down: number; total: number };
  tags: {
    general: string[];
    artist: string[];
    copyright: string[];
    character: string[];
    species: string[];
    meta: string[];
    lore: string[];
    invalid: string[];
  };
  locked_tags: string[];
  description: string;
  comment_count: number;
  fav_count: number;
  rating: string; // s, q, e
  sources: string[];
  pools: number[];
  relationships: { parent_id: number | null; has_children: boolean; children: number[] };
  approver_id: number | null;
  uploader_id: number;
  is_favorited: boolean;
  duration: number | null;
}

interface E621User {
  id: number;
  created_at: string;
  name: string;
  level: number;
  base_upload_limit: number;
  post_upload_count: number;
  post_update_count: number;
  note_update_count: number;
  is_banned: boolean;
  can_approve_posts: boolean;
  can_upload_free: boolean;
  level_string: string;
  avatar_id: number | null;
  favorite_count: number;
}

// ── Tag type mapping: e621 category → app tag type ──
// e621: 0=general, 1=artist, 3=copyright, 4=character, 5=species, 7=meta, 8=lore
// App:  1=general, 2=copyright, 4=character, 8=artist, 32=meta
const E621_TAG_CATEGORY_TO_APP: Record<string, number> = {
  general: 1,
  artist: 8,
  copyright: 2,
  character: 4,
  species: 1,   // treat species as general for scoring purposes
  meta: 32,
  lore: 1,
  invalid: 1,
};

// ── Adapters ──
let tagIdCounter = 100000; // synthetic IDs for e621 tags

function adaptTags(e6tags: E621Post["tags"]): Tag[] {
  const result: Tag[] = [];
  for (const [category, names] of Object.entries(e6tags)) {
    const appType = E621_TAG_CATEGORY_TO_APP[category] ?? 1;
    for (const name of names) {
      result.push({
        id: tagIdCounter++,
        value: name,
        count: 0,
        type: appType,
      });
    }
  }
  return result;
}

function adaptPost(e6: E621Post): Post {
  const isVideo = ["webm", "mp4"].includes(e6.file.ext);
  return {
    id: e6.id,
    created: e6.created_at,
    posted: e6.created_at,
    likes: e6.fav_count,
    comments: e6.comment_count,
    views: e6.score.total,
    type: isVideo ? 1 : 0,
    status: 0,
    uploaderId: e6.uploader_id,
    width: e6.file.width,
    height: e6.file.height,
    duration: e6.duration ?? undefined,
    files: {},
    tags: adaptTags(e6.tags),
    data: {
      sources: e6.sources,
    },
  };
}

// ── Media URL helpers (exported for use by components) ──
export function getE621MediaUrl(post: Post, variant: "full" | "thumb" = "full"): string {
  // e621 posts store URLs in a special way — we embed them in the post's data
  const urls = (post as any)._e621Urls as { full: string | null; thumb: string | null; sample: string | null } | undefined;
  if (urls) {
    if (variant === "thumb") return urls.thumb || urls.sample || urls.full || "";
    return urls.full || urls.sample || "";
  }
  return "";
}

function adaptPostWithUrls(e6: E621Post): Post {
  const post = adaptPost(e6);
  // Attach e621 URLs as a hidden property
  (post as any)._e621Urls = {
    full: e6.file.url,
    thumb: e6.preview.url,
    sample: e6.sample.has ? e6.sample.url : e6.file.url,
  };
  return post;
}

function adaptUser(e6u: E621User): UserProfile {
  return {
    id: e6u.id,
    created: e6u.created_at,
    displayName: e6u.name,
    userName: e6u.name,
    emailVerified: true,
    role: e6u.level,
    data: {
      userId: e6u.id,
      likes: e6u.favorite_count,
      bookmarks: 0,
      superLikes: 0,
      playlists: 0,
      followers: 0,
      following: 0,
      followingPlaylists: 0,
      postsUploaded: e6u.post_upload_count,
    },
  };
}

// ── API Client ──
class E621API {
  private username: string | null = null;
  private apiKey: string | null = null;
  private user: UserProfile | null = null;

  setAuth(username: string, apiKey: string, user?: UserProfile) {
    this.username = username;
    this.apiKey = apiKey;
    if (user) this.user = user;
  }

  clearAuth() {
    this.username = null;
    this.apiKey = null;
    this.user = null;
  }

  getUser(): UserProfile | null { return this.user; }
  getToken(): string | null {
    if (!this.username || !this.apiKey) return null;
    return btoa(`${this.username}:${this.apiKey}`);
  }
  isLoggedIn(): boolean { return this.username !== null && this.apiKey !== null; }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    };
    if (this.username && this.apiKey) {
      h["Authorization"] = `Basic ${btoa(`${this.username}:${this.apiKey}`)}`;
    }
    return h;
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    await rateLimitWait();
    let url = `${E621_BASE}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }
    // On web, use _client param instead of User-Agent header (CORS limitation)
    if (Platform.OS === "web") {
      const sep = url.includes("?") ? "&" : "?";
      url += `${sep}_client=${encodeURIComponent(USER_AGENT)}`;
    }
    const resp = await fetch(url, { method: "GET", headers: this.headers() });
    if (!resp.ok) throw new Error(`GET ${path} failed: ${resp.status}`);
    return resp.json();
  }

  private async postReq<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    await rateLimitWait();
    let url = `${E621_BASE}${path}`;
    if (Platform.OS === "web") {
      const sep = url.includes("?") ? "&" : "?";
      url += `${sep}_client=${encodeURIComponent(USER_AGENT)}`;
    }
    const opts: RequestInit = {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/x-www-form-urlencoded" },
    };
    if (body) {
      opts.body = new URLSearchParams(
        Object.entries(body).reduce((acc, [k, v]) => ({ ...acc, [k]: String(v) }), {} as Record<string, string>)
      ).toString();
    }
    const resp = await fetch(url, opts);
    if (!resp.ok) throw new Error(`POST ${path} failed: ${resp.status}`);
    const text = await resp.text();
    if (!text) return undefined as T;
    return JSON.parse(text);
  }

  // ── Auth ──
  async login(username: string, apiKey: string): Promise<AuthResponse> {
    this.username = username;
    this.apiKey = apiKey;
    // Validate credentials by fetching user profile
    try {
      const e6user = await this.get<E621User>(`/users/${encodeURIComponent(username)}.json`);
      this.user = adaptUser(e6user);
      // Synthesize a JWT-like token for storage compatibility
      const token = btoa(`${username}:${apiKey}`);
      return { user: this.user, jwt: token };
    } catch (e) {
      this.clearAuth();
      throw new Error("Invalid username or API key");
    }
  }

  logout() { this.clearAuth(); }

  async getMe(): Promise<UserProfile> {
    if (!this.username) throw new Error("Not logged in");
    const e6user = await this.get<E621User>(`/users/${encodeURIComponent(this.username)}.json`);
    this.user = adaptUser(e6user);
    return this.user;
  }

  async getUserProfile(username: string): Promise<UserProfile> {
    const e6user = await this.get<E621User>(`/users/${encodeURIComponent(username)}.json`);
    return adaptUser(e6user);
  }

  // ── Posts ──
  async getPost(postId: number): Promise<Post> {
    const data = await this.get<{ post: E621Post }>(`/posts/${postId}.json`);
    return adaptPostWithUrls(data.post);
  }

  async getPostsBatch(postIds: number[]): Promise<Post[]> {
    // e621 doesn't have a batch endpoint; fetch individually (rate limited)
    const results: Post[] = [];
    for (const id of postIds) {
      try {
        results.push(await this.getPost(id));
      } catch { /* skip failed */ }
    }
    return results;
  }

  async searchPosts(
    take = 30,
    cursor?: string | null,
    filters?: SearchFilters
  ): Promise<PaginatedResponse<Post>> {
    const params: Record<string, string> = { limit: String(Math.min(take, 320)) };
    const tagParts: string[] = [];
    if (filters?.includeTags?.length) tagParts.push(...filters.includeTags);
    if (filters?.type === 0) tagParts.push("type:png,jpg,gif");
    if (filters?.type === 1) tagParts.push("type:webm,mp4");
    if (filters?.sortBy === 1) tagParts.push("order:favcount");
    else if (filters?.sortBy === 2) tagParts.push("order:score");
    if (filters?.postedFromDays && filters.postedFromDays > 0) {
      // Not exact but approximate
    }
    if (tagParts.length) params.tags = tagParts.join(" ");
    if (cursor) params.page = `b${cursor}`;

    const data = await this.get<{ posts: E621Post[] }>("/posts.json", params);
    const posts = (data.posts ?? []).map(adaptPostWithUrls);
    const lastId = posts.length > 0 ? String(posts[posts.length - 1].id) : null;
    return { items: posts, cursor: lastId, pagination: 0 };
  }

  async searchPostsByTag(
    tagName: string,
    take = 30,
    cursor?: string | null,
    filters?: SearchFilters
  ): Promise<PaginatedResponse<Post>> {
    const merged: SearchFilters = { ...filters, includeTags: [tagName, ...(filters?.includeTags ?? [])] };
    return this.searchPosts(take, cursor, merged);
  }

  // ── Favorites (replaces likes/bookmarks/super-likes) ──
  async searchLikedPosts(
    userId: number,
    take = 30,
    cursor?: string | null
  ): Promise<PaginatedResponse<Post>> {
    const params: Record<string, string> = { limit: String(Math.min(take, 320)) };
    if (userId) params.user_id = String(userId);
    if (cursor) params.page = `b${cursor}`;
    const data = await this.get<{ posts: E621Post[] }>("/favorites.json", params);
    const posts = (data.posts ?? []).map(adaptPostWithUrls);
    const lastId = posts.length > 0 ? String(posts[posts.length - 1].id) : null;
    return { items: posts, cursor: lastId, pagination: 0 };
  }

  // Bookmarks and super-likes map to favorites on e621
  async searchBookmarkedPosts(userId: number, take = 30, cursor?: string | null): Promise<PaginatedResponse<Post>> {
    return { items: [], cursor: null, pagination: 0 }; // e621 has no bookmarks
  }
  async searchSuperLikedPosts(userId: number, take = 30, cursor?: string | null): Promise<PaginatedResponse<Post>> {
    return { items: [], cursor: null, pagination: 0 }; // e621 has no super-likes
  }

  // ── Post Actions ──
  async getPostActionState(postId: number): Promise<PostActionState> {
    // Check if post is favorited by fetching it with auth
    try {
      const data = await this.get<{ post: E621Post }>(`/posts/${postId}.json`);
      return {
        isLiked: data.post.is_favorited ?? false,
        isBookmarked: false,
        isSuperLiked: false,
      };
    } catch {
      return { isLiked: false, isBookmarked: false, isSuperLiked: false };
    }
  }

  async getPostActionStates(postIds: number[]): Promise<Record<number, PostActionState>> {
    // No batch endpoint; return empty states (will be fetched per-post as needed)
    const result: Record<number, PostActionState> = {};
    for (const id of postIds) {
      result[id] = { isLiked: false, isBookmarked: false, isSuperLiked: false };
    }
    return result;
  }

  async likePost(postId: number): Promise<void> {
    await this.postReq(`/favorites.json`, { post_id: postId });
  }

  async unlikePost(postId: number): Promise<void> {
    await rateLimitWait();
    let url = `${E621_BASE}/favorites/${postId}.json`;
    if (Platform.OS === "web") {
      url += `?_client=${encodeURIComponent(USER_AGENT)}`;
    }
    const resp = await fetch(url, { method: "DELETE", headers: this.headers() });
    if (!resp.ok && resp.status !== 404) throw new Error(`DELETE favorite failed: ${resp.status}`);
  }

  // Bookmarks/super-likes are no-ops on e621
  async bookmarkPost(_postId: number): Promise<void> {}
  async unbookmarkPost(_postId: number): Promise<void> {}
  async superLikePost(_postId: number): Promise<void> {}

  // ── Vote ──
  async votePost(postId: number, score: 1 | -1): Promise<void> {
    await this.postReq(`/posts/${postId}/votes.json`, { score, no_unvote: false });
  }

  // ── Tags ──
  async getTrendingTags(): Promise<Tag[]> {
    const data = await this.get<Array<{ id: number; name: string; post_count: number; category: number }>>("/tags.json", {
      "search[order]": "count",
      limit: "40",
    });
    return (data ?? []).map((t) => ({
      id: t.id,
      value: t.name,
      count: t.post_count,
      type: this.mapE621TagCategory(t.category),
    }));
  }

  async searchTags(query?: string): Promise<Tag[]> {
    const params: Record<string, string> = { limit: "40" };
    if (query) params["search[name_matches]"] = `*${query}*`;
    const data = await this.get<Array<{ id: number; name: string; post_count: number; category: number }>>("/tags.json", params);
    return (data ?? []).map((t) => ({
      id: t.id,
      value: t.name,
      count: t.post_count,
      type: this.mapE621TagCategory(t.category),
    }));
  }

  private mapE621TagCategory(cat: number): number {
    // e621: 0=general, 1=artist, 3=copyright, 4=character, 5=species, 7=meta, 8=lore
    switch (cat) {
      case 1: return 8;  // artist
      case 3: return 2;  // copyright
      case 4: return 4;  // character
      case 7: return 32; // meta
      default: return 1; // general, species, lore, invalid
    }
  }

  // ── Playlists (not supported on e621 — return empty) ──
  async getPlaylist(_id: number): Promise<Playlist> { throw new Error("Playlists not available on e621"); }
  async searchPlaylists(_take?: number, _cursor?: string | null): Promise<PaginatedResponse<Playlist>> { return { items: [], cursor: null, pagination: 0 }; }
  async getMyPlaylists(_take?: number): Promise<PaginatedResponse<Playlist>> { return { items: [], cursor: null, pagination: 0 }; }
  async getUserPlaylists(_userId: number, _take?: number): Promise<PaginatedResponse<Playlist>> { return { items: [], cursor: null, pagination: 0 }; }
  async addToPlaylist(_playlistId: number, _postId: number): Promise<void> {}
  async removeFromPlaylist(_playlistId: number, _postId: number): Promise<void> {}
  async followPlaylist(_id: number): Promise<void> {}
  async unfollowPlaylist(_id: number): Promise<void> {}
  async isFollowingPlaylist(_id: number): Promise<boolean> { return false; }
  async getFollowedPlaylists(_userId: number, _take?: number, _cursor?: string | null): Promise<PaginatedResponse<Playlist>> { return { items: [], cursor: null, pagination: 0 }; }

  // ── Feed (not available on e621) ──
  async getFeedCount(): Promise<number> { return 0; }
  async getFeedLastSeen(): Promise<string> { return new Date().toISOString(); }
  async markFeedWatched(): Promise<void> {}
  async searchFeedPosts(_userId: number, _take?: number, _cursor?: string | null): Promise<PaginatedResponse<Post>> { return { items: [], cursor: null, pagination: 0 }; }

  // ── Tag subscriptions (not on e621) ──
  async getActiveTagSubscriptions(): Promise<Tag[]> { return []; }
  async getAllTagSubscriptions(): Promise<Tag[]> { return []; }
  async subscribeToTag(_tagId: number): Promise<void> {}
  async unsubscribeFromTag(_tagId: number): Promise<void> {}
  async getTagBlacklist(): Promise<{ tags: Tag[]; isActive: boolean }> { return { tags: [], isActive: false }; }

  // ── Comments (not supported yet) ──
  async getPostComments(_postId: number, _take?: number): Promise<PaginatedResponse<PostComment>> { return { items: [], cursor: null, pagination: 0 }; }
  async getRecentComments(_take?: number, _cursor?: string | null): Promise<PaginatedResponse<PostComment>> { return { items: [], cursor: null, pagination: 0 }; }

  // ── User ──
  async getUserLimitations(): Promise<Record<string, unknown>> { return {}; }

  // ── Hot posts (use popular endpoint) ──
  async searchHotPosts(
    _userId: number,
    take = 30,
    cursor?: string | null
  ): Promise<PaginatedResponse<Post>> {
    return this.searchPosts(take, cursor, { sortBy: 1 });
  }

  // ── For You (client-side algorithm from favorites) ──
  async searchForYouPosts(
    userId: number,
    take = 30,
    _cursor?: string | null,
    excludeIds?: Set<number>
  ): Promise<{ items: Post[]; topTags: string[] }> {
    try {
      // Fetch user's favorites
      const favs = await this.searchLikedPosts(userId, 80);
      if (favs.items.length === 0) {
        // Fallback: popular posts
        const popular = await this.searchPosts(take, null, { sortBy: 1 });
        return { items: popular.items, topTags: [] };
      }

      // Build interest profile from favorites
      const typeWeight: Record<number, number> = { 8: 5, 4: 4, 2: 3, 1: 1 };
      const tagScore = new Map<string, number>();
      const total = favs.items.length;

      favs.items.forEach((post, idx) => {
        const recencyW = 1 + (total - idx) / total;
        for (const tag of post.tags ?? []) {
          const tw = typeWeight[tag.type] ?? 1;
          tagScore.set(tag.value, (tagScore.get(tag.value) ?? 0) + tw * recencyW);
        }
      });

      const rankedTags = [...tagScore.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([v]) => v);

      if (rankedTags.length === 0) {
        const popular = await this.searchPosts(take, null, { sortBy: 1 });
        return { items: popular.items, topTags: [] };
      }

      // Search with top tags (e621 supports multi-tag search)
      const seenIds = excludeIds ?? new Set<number>(favs.items.map((p) => p.id));
      const coreTags = rankedTags.slice(0, 2);
      const discTags = rankedTags.slice(2, 5);

      const [poolA, poolB, poolC] = await Promise.all([
        coreTags.length ? this.searchPosts(take, null, { includeTags: coreTags, sortBy: 1 }).then(r => r.items).catch(() => [] as Post[]) : Promise.resolve([] as Post[]),
        discTags.length ? this.searchPosts(take, null, { includeTags: [discTags[0]], sortBy: 1 }).then(r => r.items).catch(() => [] as Post[]) : Promise.resolve([] as Post[]),
        this.searchPosts(Math.ceil(take * 0.4), null, { sortBy: 1 }).then(r => r.items).catch(() => [] as Post[]),
      ]);

      // Merge and deduplicate
      const allPosts = [...poolA, ...poolB, ...poolC]
        .filter(p => !seenIds.has(p.id))
        .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i);

      // Shuffle lightly
      for (let i = allPosts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allPosts[i], allPosts[j]] = [allPosts[j], allPosts[i]];
      }

      return {
        items: allPosts.slice(0, take),
        topTags: rankedTags.slice(0, 5),
      };
    } catch {
      const popular = await this.searchPosts(take, null, { sortBy: 1 });
      return { items: popular.items, topTags: [] };
    }
  }

  // ── Similar posts ──
  async searchSimilarPosts(post: Post, take = 5): Promise<Post[]> {
    const tags = post.tags ?? [];
    const prioritized = [
      ...tags.filter(t => t.type === 8),
      ...tags.filter(t => t.type === 4),
      ...tags.filter(t => t.type === 2),
      ...tags.filter(t => t.type === 1),
    ];
    const searchTags = prioritized.slice(0, 2).map(t => t.value);
    if (searchTags.length === 0) return [];
    const data = await this.searchPosts(take + 5, null, { includeTags: searchTags });
    return data.items.filter(p => p.id !== post.id).slice(0, take);
  }
}

export const e621Api = new E621API();
export default e621Api;
