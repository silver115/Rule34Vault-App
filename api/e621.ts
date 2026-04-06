import { Platform } from "react-native";
import type {
    AuthResponse,
    PaginatedResponse,
    Playlist,
    Post,
    PostActionState,
    PostComment,
    SearchFilters,
    Tag,
    UserProfile,
} from "./rule34vault";

const E621_BASE = "https://e621.net";
const USER_AGENT = "Rule34VaultApp/1.0 (by Puro115 on e621)";

// ── Token-bucket rate limiter (e621 TOS: max 2 req/s) ──
// Allows 2 requests per 1000ms window instead of serial 500ms gaps.
// This roughly doubles burst throughput while staying TOS-compliant.
const BUCKET_MAX = 2;
const BUCKET_REFILL_MS = 1000;
let bucketTokens = BUCKET_MAX;
let bucketLastRefill = Date.now();
async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - bucketLastRefill;
  if (elapsed >= BUCKET_REFILL_MS) {
    bucketTokens = BUCKET_MAX;
    bucketLastRefill = now;
  }
  if (bucketTokens > 0) {
    bucketTokens--;
    return;
  }
  // No tokens left — wait until bucket refills
  const waitMs = BUCKET_REFILL_MS - (Date.now() - bucketLastRefill);
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  bucketTokens = BUCKET_MAX - 1;
  bucketLastRefill = Date.now();
}

// ── e621 raw types ──
interface E621Post {
  id: number;
  created_at: string;
  updated_at: string;
  file: {
    width: number;
    height: number;
    ext: string;
    size: number;
    md5: string;
    url: string | null;
  };
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
  relationships: {
    parent_id: number | null;
    has_children: boolean;
    children: number[];
  };
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
  blacklisted_tags?: string;
  profile_about?: string;
  artist_version_count?: number;
}

interface E621Pool {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  creator_id: number;
  creator_name: string;
  description: string;
  is_active: boolean;
  category: string; // "series" or "collection"
  post_ids: number[];
  post_count: number;
}

interface E621Comment {
  id: number;
  created_at: string;
  updated_at: string;
  post_id: number;
  creator_id: number;
  creator_name: string;
  body: string;
  score: number;
  is_hidden: boolean;
  warning_type: string | null;
}

function adaptPool(pool: E621Pool): Playlist {
  return {
    id: pool.id,
    created: pool.created_at,
    updated: pool.updated_at,
    userId: pool.creator_id,
    user: {
      id: pool.creator_id,
      created: "",
      displayName: pool.creator_name,
      userName: pool.creator_name,
      emailVerified: true,
      role: 0,
    },
    title: pool.name.replace(/_/g, " "),
    description: pool.description,
    views: 0,
    likes: 0,
    comments: 0,
    followers: 0,
    isPrivate: false,
    items: pool.post_count,
    useCustomImage: false,
  };
}

// ── Tag type mapping: e621 category → app tag type ──
// e621: 0=general, 1=artist, 3=copyright, 4=character, 5=species, 7=meta, 8=lore
// App:  1=general, 2=copyright, 4=character, 8=artist, 32=meta
const E621_TAG_CATEGORY_TO_APP: Record<string, number> = {
  general: 1,
  artist: 8,
  copyright: 2,
  character: 4,
  species: 1, // treat species as general for scoring purposes
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
export function getE621MediaUrl(
  post: Post,
  variant: "full" | "thumb" | "sample" = "full",
): string {
  // e621 posts store URLs in a special way — we embed them in the post's data
  const urls = (post as any)._e621Urls as
    | { full: string | null; thumb: string | null; sample: string | null }
    | undefined;
  if (urls) {
    if (variant === "thumb")
      return urls.thumb || urls.sample || urls.full || "";
    if (variant === "sample") return urls.sample || urls.full || "";
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
  // Carry is_favorited so we can skip per-post action-state API calls
  (post as any)._e621Favorited = e6.is_favorited ?? false;
  // Carry relationship data for parent/child navigation
  (post as any)._e621Relationships = {
    parentId: e6.relationships?.parent_id ?? null,
    hasChildren: e6.relationships?.has_children ?? false,
    children: e6.relationships?.children ?? [],
  };
  // Carry pools for pool navigation
  (post as any)._e621Pools = e6.pools ?? [];
  // Carry score breakdown for voting UI
  (post as any)._e621Score = {
    up: e6.score?.up ?? 0,
    down: e6.score?.down ?? 0,
    total: e6.score?.total ?? 0,
  };
  // Carry rating
  (post as any)._e621Rating = e6.rating ?? "e";
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
      description: e6u.level_string
        ? `${e6u.level_string} · ${e6u.post_upload_count} uploads`
        : undefined,
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

  getUser(): UserProfile | null {
    return this.user;
  }
  getToken(): string | null {
    if (!this.username || !this.apiKey) return null;
    return btoa(`${this.username}:${this.apiKey}`);
  }
  isLoggedIn(): boolean {
    return this.username !== null && this.apiKey !== null;
  }

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

  private async get<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
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

  private async postReq<T>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    await rateLimitWait();
    let url = `${E621_BASE}${path}`;
    if (Platform.OS === "web") {
      const sep = url.includes("?") ? "&" : "?";
      url += `${sep}_client=${encodeURIComponent(USER_AGENT)}`;
    }
    const opts: RequestInit = {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };
    if (body) {
      opts.body = new URLSearchParams(
        Object.entries(body).reduce(
          (acc, [k, v]) => ({ ...acc, [k]: String(v) }),
          {} as Record<string, string>,
        ),
      ).toString();
    }
    const resp = await fetch(url, opts);
    if (!resp.ok) throw new Error(`POST ${path} failed: ${resp.status}`);
    const text = await resp.text();
    if (!text) return undefined as T;
    return JSON.parse(text);
  }

  // ── Auth ──
  private async fetchAvatarUrl(
    avatarId: number | null,
  ): Promise<string | undefined> {
    if (!avatarId) return undefined;
    try {
      const data = await this.get<{ post: E621Post }>(
        `/posts/${avatarId}.json`,
      );
      const p = data?.post;
      return p?.preview?.url ?? p?.sample?.url ?? p?.file?.url ?? undefined;
    } catch {
      return undefined;
    }
  }

  async login(username: string, apiKey: string): Promise<AuthResponse> {
    this.username = username;
    this.apiKey = apiKey;
    // Validate credentials by fetching user profile
    try {
      const e6user = await this.get<E621User>(
        `/users/${encodeURIComponent(username)}.json`,
      );
      const profile = adaptUser(e6user);
      const avatarUrl = await this.fetchAvatarUrl(e6user.avatar_id);
      if (avatarUrl) profile.avatarModifyDate = avatarUrl;
      this.user = profile;
      // Synthesize a JWT-like token for storage compatibility
      const token = btoa(`${username}:${apiKey}`);
      return { user: this.user, jwt: token };
    } catch (e) {
      this.clearAuth();
      throw new Error("Invalid username or API key");
    }
  }

  logout() {
    this.clearAuth();
  }

  async getMe(): Promise<UserProfile> {
    if (!this.username) throw new Error("Not logged in");
    const e6user = await this.get<E621User>(
      `/users/${encodeURIComponent(this.username)}.json`,
    );
    const profile = adaptUser(e6user);
    const avatarUrl = await this.fetchAvatarUrl(e6user.avatar_id);
    if (avatarUrl) profile.avatarModifyDate = avatarUrl;
    this.user = profile;
    return this.user;
  }

  async getUserProfile(username: string): Promise<UserProfile> {
    const e6user = await this.get<E621User>(
      `/users/${encodeURIComponent(username)}.json`,
    );
    return adaptUser(e6user);
  }

  // ── Posts ──
  async getPost(postId: number): Promise<Post> {
    const data = await this.get<{ post: E621Post }>(`/posts/${postId}.json`);
    return adaptPostWithUrls(data.post);
  }

  async getPostsBatch(postIds: number[]): Promise<Post[]> {
    if (postIds.length === 0) return [];
    // Use search with id: tag to batch-fetch (max 100 per request on e621)
    const results: Post[] = [];
    const chunks: number[][] = [];
    for (let i = 0; i < postIds.length; i += 100) {
      chunks.push(postIds.slice(i, i + 100));
    }
    for (const chunk of chunks) {
      try {
        const idList = chunk.join(",");
        const data = await this.get<{ posts: E621Post[] }>("/posts.json", {
          tags: `id:${idList}`,
          limit: String(chunk.length),
        });
        results.push(...(data.posts ?? []).map(adaptPostWithUrls));
      } catch {
        /* skip failed chunk */
      }
    }
    return results;
  }

  async searchPosts(
    take = 30,
    cursor?: string | null,
    filters?: SearchFilters,
  ): Promise<PaginatedResponse<Post>> {
    const params: Record<string, string> = {
      limit: String(Math.min(take, 320)),
    };
    const tagParts: string[] = [];
    if (filters?.includeTags?.length) tagParts.push(...filters.includeTags);
    // e621 does not support comma-list type syntax — use negation/OR metatags instead
    if (filters?.type === 0) tagParts.push("-type:webm", "-type:mp4");
    if (filters?.type === 1) tagParts.push("~type:webm", "~type:mp4");
    if (filters?.sortBy === 1) tagParts.push("order:favcount");
    else if (filters?.sortBy === 2) tagParts.push("order:score");
    else if (filters?.sortBy === 3) tagParts.push("order:comment");
    if (filters?.postedFromDays && filters.postedFromDays > 0) {
      const d = new Date();
      d.setDate(d.getDate() - filters.postedFromDays);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      tagParts.push(`date:>${yyyy}-${mm}-${dd}`);
    }
    if (filters?.rating) tagParts.push(`rating:${filters.rating}`);
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
    filters?: SearchFilters,
  ): Promise<PaginatedResponse<Post>> {
    const merged: SearchFilters = {
      ...filters,
      includeTags: [tagName, ...(filters?.includeTags ?? [])],
    };
    return this.searchPosts(take, cursor, merged);
  }

  // ── Favorites (replaces likes/bookmarks/super-likes) ──
  async searchLikedPosts(
    userId: number,
    take = 30,
    cursor?: string | null,
  ): Promise<PaginatedResponse<Post>> {
    const params: Record<string, string> = {
      limit: String(Math.min(take, 320)),
    };
    if (userId) params.user_id = String(userId);
    if (cursor) params.page = `b${cursor}`;
    const data = await this.get<{ posts: E621Post[] }>(
      "/favorites.json",
      params,
    );
    const posts = (data.posts ?? []).map(adaptPostWithUrls);
    const lastId = posts.length > 0 ? String(posts[posts.length - 1].id) : null;
    return { items: posts, cursor: lastId, pagination: 0 };
  }

  // Bookmarks and super-likes map to favorites on e621
  async searchBookmarkedPosts(
    userId: number,
    take = 30,
    cursor?: string | null,
  ): Promise<PaginatedResponse<Post>> {
    return { items: [], cursor: null, pagination: 0 }; // e621 has no bookmarks
  }
  async searchSuperLikedPosts(
    userId: number,
    take = 30,
    cursor?: string | null,
  ): Promise<PaginatedResponse<Post>> {
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

  async getPostActionStates(
    postIds: number[],
  ): Promise<Record<number, PostActionState>> {
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
    const resp = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!resp.ok && resp.status !== 404)
      throw new Error(`DELETE favorite failed: ${resp.status}`);
  }

  // Bookmarks/super-likes are no-ops on e621
  async bookmarkPost(_postId: number): Promise<void> {}
  async unbookmarkPost(_postId: number): Promise<void> {}
  async superLikePost(_postId: number): Promise<void> {}

  // ── Vote ──
  async votePost(postId: number, score: 1 | -1): Promise<void> {
    await this.postReq(`/posts/${postId}/votes.json`, {
      score,
      no_unvote: false,
    });
  }

  // ── Tags ──
  async getTrendingTags(): Promise<Tag[]> {
    const data = await this.get<
      Array<{ id: number; name: string; post_count: number; category: number }>
    >("/tags.json", {
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
    if (!query || query.length < 2) {
      return this.getTrendingTags();
    }
    // Use e621's fast autocomplete endpoint — ranked by post count
    try {
      const data = await this.get<
        Array<{
          id: number;
          name: string;
          post_count: number;
          category: number;
          antecedent_name?: string;
        }>
      >("/tags/autocomplete.json", {
        "search[name_matches]": `${query}*`,
        limit: "20",
      });
      return (data ?? []).map((t) => ({
        id: t.id,
        value: t.name,
        count: t.post_count,
        type: this.mapE621TagCategory(t.category),
      }));
    } catch {
      // Fallback to regular tag search
      const params: Record<string, string> = { limit: "20" };
      params["search[name_matches]"] = `*${query}*`;
      const data = await this.get<
        Array<{
          id: number;
          name: string;
          post_count: number;
          category: number;
        }>
      >("/tags.json", params);
      return (data ?? []).map((t) => ({
        id: t.id,
        value: t.name,
        count: t.post_count,
        type: this.mapE621TagCategory(t.category),
      }));
    }
  }

  private mapE621TagCategory(cat: number): number {
    // e621: 0=general, 1=artist, 3=copyright, 4=character, 5=species, 7=meta, 8=lore
    switch (cat) {
      case 1:
        return 8; // artist
      case 3:
        return 2; // copyright
      case 4:
        return 4; // character
      case 7:
        return 32; // meta
      default:
        return 1; // general, species, lore, invalid
    }
  }

  // ── Pools (mapped to Playlist interface) ──
  private poolPostIdCache = new Map<number, number[]>();

  async getPlaylist(poolId: number): Promise<Playlist> {
    const data = await this.get<E621Pool>(`/pools/${poolId}.json`);
    this.poolPostIdCache.set(poolId, data.post_ids ?? []);
    const playlist = adaptPool(data);
    // Fetch the latest post for thumbnail
    const postIds = data.post_ids ?? [];
    if (postIds.length > 0) {
      try {
        const lastId = postIds[postIds.length - 1];
        const posts = await this.getPostsBatch([lastId]);
        if (posts.length > 0) playlist.lastPost = posts[0];
      } catch {
        /* thumbnail is optional */
      }
    }
    return playlist;
  }

  async searchPlaylists(
    take = 20,
    cursor?: string | null,
  ): Promise<PaginatedResponse<Playlist>> {
    const params: Record<string, string> = {
      limit: String(Math.min(take, 40)),
      "search[order]": "updated_at",
    };
    if (cursor) params.page = cursor;
    const data = await this.get<E621Pool[]>("/pools.json", params);
    const pools = (data ?? []).map(adaptPool);
    // Batch-fetch the latest post from each pool for thumbnails
    const thumbIds = (data ?? [])
      .map((p) => (p.post_ids?.length ? p.post_ids[p.post_ids.length - 1] : 0))
      .filter((id) => id > 0);
    if (thumbIds.length > 0) {
      try {
        const thumbPosts = await this.getPostsBatch(thumbIds);
        const postMap = new Map(thumbPosts.map((p) => [p.id, p]));
        for (let i = 0; i < pools.length; i++) {
          const pid = (data ?? [])[i]?.post_ids;
          if (pid?.length) {
            const lastPost = postMap.get(pid[pid.length - 1]);
            if (lastPost) pools[i].lastPost = lastPost;
          }
        }
      } catch {
        /* thumbnails are optional */
      }
    }
    const nextPage =
      pools.length >= take ? String(Number(cursor || "1") + 1) : null;
    return { items: pools, cursor: nextPage, pagination: 0 };
  }

  async searchPostsByPlaylist(
    poolId: number,
    take = 30,
    cursor?: string | null,
  ): Promise<PaginatedResponse<Post>> {
    // Get post_ids from cache or fetch pool
    let postIds = this.poolPostIdCache.get(poolId);
    if (!postIds) {
      const pool = await this.get<E621Pool>(`/pools/${poolId}.json`);
      postIds = pool.post_ids ?? [];
      this.poolPostIdCache.set(poolId, postIds);
    }
    // Use cursor as numeric offset
    const offset = cursor ? Number(cursor) : 0;
    const slice = postIds.slice(offset, offset + take);
    if (slice.length === 0) {
      return { items: [], cursor: null, pagination: 0 };
    }
    // Batch-fetch posts and sort in pool order
    const posts = await this.getPostsBatch(slice);
    const idOrder = new Map(slice.map((id, i) => [id, i]));
    posts.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
    const nextOffset = offset + take;
    return {
      items: posts,
      cursor: nextOffset < postIds.length ? String(nextOffset) : null,
      pagination: 0,
    };
  }

  async getMyPlaylists(_take?: number): Promise<PaginatedResponse<Playlist>> {
    return { items: [], cursor: null, pagination: 0 };
  }
  async getUserPlaylists(
    _userId: number,
    _take?: number,
  ): Promise<PaginatedResponse<Playlist>> {
    return { items: [], cursor: null, pagination: 0 };
  }
  async addToPlaylist(_playlistId: number, _postId: number): Promise<void> {}
  async removeFromPlaylist(
    _playlistId: number,
    _postId: number,
  ): Promise<void> {}
  async followPlaylist(_id: number): Promise<void> {}
  async unfollowPlaylist(_id: number): Promise<void> {}
  async isFollowingPlaylist(_id: number): Promise<boolean> {
    return false;
  }
  async getFollowedPlaylists(
    _userId: number,
    _take?: number,
    _cursor?: string | null,
  ): Promise<PaginatedResponse<Playlist>> {
    return { items: [], cursor: null, pagination: 0 };
  }

  // ── Feed (not available on e621) ──
  async getFeedCount(): Promise<number> {
    return 0;
  }
  async getFeedLastSeen(): Promise<string> {
    return new Date().toISOString();
  }
  async markFeedWatched(): Promise<void> {}
  async searchFeedPosts(
    _userId: number,
    _take?: number,
    _cursor?: string | null,
  ): Promise<PaginatedResponse<Post>> {
    return { items: [], cursor: null, pagination: 0 };
  }

  // ── Tag subscriptions (not on e621) ──
  async getActiveTagSubscriptions(): Promise<Tag[]> {
    return [];
  }
  async getAllTagSubscriptions(): Promise<Tag[]> {
    return [];
  }
  async subscribeToTag(_tagId: number): Promise<void> {}
  async unsubscribeFromTag(_tagId: number): Promise<void> {}
  async getTagBlacklist(): Promise<{ tags: Tag[]; isActive: boolean }> {
    if (!this.username) return { tags: [], isActive: false };
    try {
      const data = await this.get<E621User>(
        `/users/${encodeURIComponent(this.username)}.json`,
      );
      const rawTags = (data as any).blacklisted_tags ?? "";
      const tags: Tag[] = String(rawTags)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name, idx) => ({
          id: -(idx + 1),
          value: name,
          count: 0,
          type: 1 as const,
        }));
      return { tags, isActive: tags.length > 0 };
    } catch {
      return { tags: [], isActive: false };
    }
  }

  // ── Comments ──
  private adaptComment(c: E621Comment): PostComment {
    return {
      id: c.id,
      created: c.created_at,
      postId: c.post_id,
      post: null,
      userId: c.creator_id,
      user: {
        id: c.creator_id,
        displayName: c.creator_name,
        userName: c.creator_name,
        avatarModifyDate: null,
        role: 0,
        created: "",
      },
      content: c.body,
      likes: Math.max(c.score, 0),
      dislikes: Math.abs(Math.min(c.score, 0)),
      childrenCount: 0,
      parentId: null,
      parent: null,
    };
  }

  async getPostComments(
    postId: number,
    _take?: number,
  ): Promise<PaginatedResponse<PostComment>> {
    try {
      const data = await this.get<E621Comment[]>("/comments.json", {
        "search[post_id]": String(postId),
        "search[order]": "id_desc",
        limit: "50",
      });
      const comments = (data ?? [])
        .filter((c) => !c.is_hidden)
        .map((c) => this.adaptComment(c));
      return { items: comments, cursor: null, pagination: 0 };
    } catch {
      return { items: [], cursor: null, pagination: 0 };
    }
  }

  async getRecentComments(
    take = 20,
    cursor?: string | null,
  ): Promise<PaginatedResponse<PostComment>> {
    try {
      const params: Record<string, string> = {
        "search[order]": "id_desc",
        limit: String(Math.min(take, 50)),
      };
      if (cursor) params.page = `b${cursor}`;
      const data = await this.get<E621Comment[]>("/comments.json", params);
      const comments = (data ?? [])
        .filter((c) => !c.is_hidden)
        .map((c) => this.adaptComment(c));
      const lastId =
        comments.length > 0 ? String(comments[comments.length - 1].id) : null;
      return { items: comments, cursor: lastId, pagination: 0 };
    } catch {
      return { items: [], cursor: null, pagination: 0 };
    }
  }

  // ── User ──
  async getUserLimitations(): Promise<Record<string, unknown>> {
    return {};
  }

  // ── Hot posts (use popular endpoint) ──
  async searchHotPosts(
    _userId: number,
    take = 30,
    cursor?: string | null,
  ): Promise<PaginatedResponse<Post>> {
    return this.searchPosts(take, cursor, { sortBy: 1 });
  }

  // ── For You (client-side algorithm from favorites) ──
  async searchForYouPosts(
    userId: number,
    take = 30,
    _cursor?: string | null,
    excludeIds?: Set<number>,
  ): Promise<{ items: Post[]; topTags: string[] }> {
    try {
      // Fetch user's favorites
      const favs = await this.searchLikedPosts(userId, 80);
      if (favs.items.length === 0) {
        // Fallback: popular posts (with 100+ favs filter)
        const popular = await this.searchPosts(take * 2, null, { sortBy: 1 });
        const filtered = popular.items.filter((p) => (p.likes ?? 0) >= 100);
        return { items: filtered.slice(0, take), topTags: [] };
      }

      // Build interest profile from favorites
      const typeWeight: Record<number, number> = { 8: 5, 4: 4, 2: 3, 1: 1 };
      const tagScore = new Map<string, number>();
      const total = favs.items.length;

      favs.items.forEach((post, idx) => {
        const recencyW = 1 + (total - idx) / total;
        for (const tag of post.tags ?? []) {
          const tw = typeWeight[tag.type] ?? 1;
          tagScore.set(
            tag.value,
            (tagScore.get(tag.value) ?? 0) + tw * recencyW,
          );
        }
      });

      const rankedTags = [...tagScore.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([v]) => v);

      if (rankedTags.length === 0) {
        const popular = await this.searchPosts(take * 2, null, { sortBy: 1 });
        const filtered = popular.items.filter((p) => (p.likes ?? 0) >= 100);
        return { items: filtered.slice(0, take), topTags: [] };
      }

      // Search with top tags (e621 supports multi-tag search)
      const seenIds =
        excludeIds ?? new Set<number>(favs.items.map((p) => p.id));
      const coreTags = rankedTags.slice(0, 2);
      const discTags = rankedTags.slice(2, 5);

      const [poolA, poolB, poolC] = await Promise.all([
        coreTags.length
          ? this.searchPosts(take * 2, null, {
              includeTags: coreTags,
              sortBy: 1,
            })
              .then((r) => r.items)
              .catch(() => [] as Post[])
          : Promise.resolve([] as Post[]),
        discTags.length
          ? this.searchPosts(take * 2, null, {
              includeTags: [discTags[0]],
              sortBy: 1,
            })
              .then((r) => r.items)
              .catch(() => [] as Post[])
          : Promise.resolve([] as Post[]),
        this.searchPosts(Math.ceil(take * 0.8), null, { sortBy: 1 })
          .then((r) => r.items)
          .catch(() => [] as Post[]),
      ]);

      // Merge, deduplicate, and filter by quality (100+ favs)
      const MIN_FAVS = 100;
      const allPosts = [...poolA, ...poolB, ...poolC]
        .filter((p) => !seenIds.has(p.id))
        .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
        .filter((p) => (p.likes ?? 0) >= MIN_FAVS);

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
      const popular = await this.searchPosts(take * 2, null, { sortBy: 1 });
      const filtered = popular.items.filter((p) => (p.likes ?? 0) >= 100);
      return { items: filtered.slice(0, take), topTags: [] };
    }
  }

  // ── Similar posts ──
  async searchSimilarPosts(post: Post, take = 5): Promise<Post[]> {
    const tags = post.tags ?? [];
    const prioritized = [
      ...tags.filter((t) => t.type === 8),
      ...tags.filter((t) => t.type === 4),
      ...tags.filter((t) => t.type === 2),
      ...tags.filter((t) => t.type === 1),
    ];
    const searchTags = prioritized.slice(0, 2).map((t) => t.value);
    if (searchTags.length === 0) return [];
    const data = await this.searchPosts(take + 5, null, {
      includeTags: searchTags,
    });
    return data.items.filter((p) => p.id !== post.id).slice(0, take);
  }
}

export const e621Api = new E621API();
export default e621Api;
