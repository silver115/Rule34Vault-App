import { Platform } from "react-native";

const PROXY_URL = "http://localhost:3001";
const DIRECT_URL = "https://rule34vault.com";
const CDN_URL = "https://r34xyz.b-cdn.net";

function getBaseUrl(): string {
  // Native apps (Android/iOS) hit the API directly — no CORS issues
  // Web uses localhost proxy to avoid CORS
  if (Platform.OS === "web") {
    return PROXY_URL;
  }
  return DIRECT_URL;
}

function getApiUrl(): string {
  return `${getBaseUrl()}/api/v2`;
}

export const POST_TYPE: Record<number, string> = { 0: "image", 1: "video" };
export const TAG_TYPE: Record<number, string> = {
  1: "general",
  2: "copyright",
  4: "character",
  8: "artist",
  32: "meta",
};

export interface Post {
  id: number;
  created: string;
  posted: string;
  likes?: number;
  comments?: number;
  views?: number;
  type: number; // 0=image, 1=video
  status: number;
  uploaderId: number;
  width: number;
  height: number;
  duration?: number;
  files: Record<string, number[]>;
  tags?: Tag[];
  data?: {
    sources?: string[];
    meta?: { xId?: number; eId?: number; dId?: number };
  };
}

export interface Tag {
  id: number;
  value: string;
  count: number;
  type: number;
  popularity?: number;
}

export interface Playlist {
  id: number;
  created: string;
  updated: string;
  userId: number;
  user?: UserProfile;
  title: string;
  description: string;
  views: number;
  likes: number;
  comments: number;
  followers: number;
  isPrivate: boolean;
  items: number;
  lastPostId?: number;
  lastPost?: Post;
  useCustomImage: boolean;
}

export interface UserProfilePrivacy {
  showBookmarks?: boolean;
  showSuperLikes?: boolean;
}

export interface UserProfile {
  id: number;
  created: string;
  displayName: string;
  userName: string;
  emailVerified: boolean;
  avatarModifyDate?: string;
  role: number;
  data?: {
    userId: number;
    updated?: string;
    likes: number;
    bookmarks: number;
    superLikes: number;
    postComments?: number;
    playlistComments?: number;
    urls?: string | null;
    playlists: number;
    publicPlaylists?: number;
    profileImageDate?: string;
    followers: number;
    following: number;
    followingPlaylists: number;
    postsUploaded?: number;
    subscriptionLastSeen?: string;
    description?: string;
    privacy?: UserProfilePrivacy;
  };
}

export interface PostComment {
  id: number;
  created: string;
  postId: number;
  post: Post | null;
  userId: number;
  user: {
    id: number;
    displayName: string;
    userName: string;
    avatarModifyDate?: string | null;
    role: number;
    created: string;
  } | null;
  content: string;
  likes: number;
  dislikes: number;
  childrenCount: number;
  parentId: number | null;
  parent: PostComment | null;
}

export interface PostActionState {
  isLiked: boolean;
  isBookmarked: boolean;
  isSuperLiked: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  cursor: string | null;
  pagination: number;
}

export interface AuthResponse {
  user: UserProfile;
  jwt: string;
}

export function getMediaUrl(
  post: Pick<Post, "id" | "type">,
  variant: "full" | "thumb" = "full",
  useCdn = true
): string {
  const base = useCdn ? CDN_URL : getBaseUrl();
  const bucket = Math.floor(post.id / 1000);
  const prefix = `${base}/posts/${bucket}/${post.id}/${post.id}`;
  if (variant === "thumb") return `${prefix}.thumbnail.jpg`;
  return post.type === 1 ? `${prefix}.mp4` : `${prefix}.jpg`;
}

export function getMediaUrlDirect(
  post: Pick<Post, "id" | "type">,
  variant: "full" | "thumb" = "full"
): string {
  const base = "https://rule34vault.com";
  const bucket = Math.floor(post.id / 1000);
  const prefix = `${base}/posts/${bucket}/${post.id}/${post.id}`;
  if (variant === "thumb") return `${prefix}.thumbnail.jpg`;
  return post.type === 1 ? `${prefix}.mp4` : `${prefix}.jpg`;
}

export function getAvatarUrl(userId: number, modifyDate?: string, size = 128): string {
  const base = "https://rule34vault.com";
  const v = modifyDate ? `?v=${new Date(modifyDate).getTime()}` : "";
  return `${base}/users/${userId}/avatar-${size}.jpg${v}`;
}

export function getBannerUrl(userId: number, profileImageDate?: string): string | null {
  if (!profileImageDate) return null;
  const base = "https://rule34vault.com";
  return `${base}/users/${userId}/bg-600.jpg?v=${new Date(profileImageDate).getTime()}`;
}

class Rule34VaultAPI {
  private token: string | null = null;
  private user: UserProfile | null = null;

  setAuth(token: string, user: UserProfile) {
    this.token = token;
    this.user = user;
  }

  clearAuth() {
    this.token = null;
    this.user = null;
  }

  getUser(): UserProfile | null {
    return this.user;
  }

  getToken(): string | null {
    return this.token;
  }

  isLoggedIn(): boolean {
    return this.token !== null;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  private async get<T>(path: string): Promise<T> {
    const resp = await fetch(`${getApiUrl()}${path}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!resp.ok) throw new Error(`GET ${path} failed: ${resp.status}`);
    return resp.json();
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const opts: RequestInit = {
      method: "POST",
      headers: this.headers(),
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const resp = await fetch(`${getApiUrl()}${path}`, opts);
    if (!resp.ok) throw new Error(`POST ${path} failed: ${resp.status}`);
    const text = await resp.text();
    if (!text) return undefined as T;
    return JSON.parse(text);
  }

  // ── Auth ──────────────────────────────────────────────
  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await this.post<AuthResponse>("/auth/signin", {
      email,
      password,
    });
    this.token = data.jwt;
    this.user = data.user;
    return data;
  }

  logout() {
    this.clearAuth();
  }

  async getMe(): Promise<UserProfile> {
    return this.get<UserProfile>("/auth/me");
  }

  async getUserProfile(username: string): Promise<UserProfile> {
    return this.get<UserProfile>(`/account/user/${username}`);
  }

  // ── User Relations ──────────────────────────────────────
  async followPlaylist(playlistId: number): Promise<void> {
    await this.post("/user-relation/playlist-follow/add", playlistId);
  }

  async unfollowPlaylist(playlistId: number): Promise<void> {
    await this.post("/user-relation/playlist-follow/remove", playlistId);
  }

  async isFollowingPlaylist(playlistId: number): Promise<boolean> {
    return this.post<boolean>("/user-relation/playlist-follow/exists", playlistId);
  }

  async getFollowedPlaylists(
    userId: number,
    take = 50,
    cursor?: string | null
  ): Promise<PaginatedResponse<Playlist>> {
    const body: Record<string, unknown> = { take };
    if (cursor) body.cursor = cursor;
    return this.post<PaginatedResponse<Playlist>>(`/playlist/search/subscribed/${userId}`, body);
  }

  // ── Posts ─────────────────────────────────────────────
  async getPost(postId: number): Promise<Post> {
    const cached = postCache.get(postId);
    if (cached) return cached;
    const post = await this.get<Post>(`/post/${postId}`);
    postCache.set(postId, post);
    return post;
  }

  async getPostsBatch(postIds: number[]): Promise<Post[]> {
    const results: Post[] = [];
    const toFetch: number[] = [];
    for (const id of postIds) {
      const cached = postCache.get(id);
      if (cached) results.push(cached);
      else toFetch.push(id);
    }
    if (toFetch.length > 0) {
      const chunks = chunkArray(toFetch, PARALLEL_LIMIT);
      for (const chunk of chunks) {
        const fetched = await Promise.all(
          chunk.map((id) =>
            this.get<Post>(`/post/${id}`)
              .then((p) => { postCache.set(id, p); return p; })
              .catch(() => null)
          )
        );
        results.push(...fetched.filter((p): p is Post => p !== null));
      }
    }
    return results;
  }

  async searchPosts(
    take = 30,
    cursor?: string | null,
    filters?: SearchFilters
  ): Promise<PaginatedResponse<Post>> {
    const body: Record<string, unknown> = { take };
    if (cursor) body.cursor = cursor;
    if (filters?.type != null) body.type = filters.type;
    if (filters?.includeTags?.length) body.includeTags = filters.includeTags;
    if (filters?.sortBy != null) body.sortBy = filters.sortBy;
    if (filters?.postedFromDays) body.postedFromDays = filters.postedFromDays;
    return this.post<PaginatedResponse<Post>>("/post/search/root", body);
  }

  async searchHotPosts(
    userId: number,
    take = 30,
    cursor?: string | null
  ): Promise<PaginatedResponse<Post>> {
    const body: Record<string, unknown> = { take };
    if (cursor) body.cursor = cursor;
    return this.post<PaginatedResponse<Post>>(`/post/search/hot/${userId}`, body);
  }

  async searchPostsByTag(
    tagName: string,
    take = 30,
    cursor?: string | null,
    filters?: SearchFilters
  ): Promise<PaginatedResponse<Post>> {
    const tags = [tagName, ...(filters?.includeTags ?? [])];
    const body: Record<string, unknown> = { take, includeTags: tags };
    if (cursor) body.cursor = cursor;
    if (filters?.type != null) body.type = filters.type;
    return this.post<PaginatedResponse<Post>>("/post/search/root", body);
  }

  async prefetchPages(
    count: number,
    filters?: SearchFilters
  ): Promise<PaginatedResponse<Post>[]> {
    const pages: PaginatedResponse<Post>[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < count; i++) {
      const page = await this.searchPosts(30, cursor, filters);
      pages.push(page);
      page.items.forEach((p) => postCache.set(p.id, p));
      cursor = page.cursor;
      if (!cursor) break;
    }
    return pages;
  }

  async searchPostsByPlaylist(
    playlistId: number,
    take = 30,
    cursor?: string | null
  ): Promise<PaginatedResponse<Post>> {
    const body: Record<string, unknown> = { take };
    if (cursor) body.cursor = cursor;
    return this.post<PaginatedResponse<Post>>(
      `/post/search/playlist/${playlistId}`,
      body
    );
  }

  async searchLikedPosts(
    userId: number,
    take = 30,
    cursor?: string | null
  ): Promise<PaginatedResponse<Post>> {
    const body: Record<string, unknown> = { take };
    if (cursor) body.cursor = cursor;
    return this.post<PaginatedResponse<Post>>(`/post/search/liked/${userId}`, body);
  }

  async searchBookmarkedPosts(
    userId: number,
    take = 30,
    cursor?: string | null
  ): Promise<PaginatedResponse<Post>> {
    const body: Record<string, unknown> = { take };
    if (cursor) body.cursor = cursor;
    return this.post<PaginatedResponse<Post>>(`/post/search/bookmarked/${userId}`, body);
  }

  async searchSuperLikedPosts(
    userId: number,
    take = 30,
    cursor?: string | null
  ): Promise<PaginatedResponse<Post>> {
    const body: Record<string, unknown> = { take };
    if (cursor) body.cursor = cursor;
    return this.post<PaginatedResponse<Post>>(`/post/search/super-liked/${userId}`, body);
  }

  // ── Post Actions ──────────────────────────────────────
  async getPostActionState(postId: number): Promise<PostActionState> {
    return this.post<PostActionState>("/post/action/state", { postId });
  }

  async getPostActionStates(postIds: number[]): Promise<Record<number, PostActionState>> {
    return this.post<Record<number, PostActionState>>("/post/action/states", { postIds });
  }

  async likePost(postId: number): Promise<void> {
    await this.post("/post/action/like", { postId });
  }

  async unlikePost(postId: number): Promise<void> {
    await this.post("/post/action/unlike", { postId });
  }

  async bookmarkPost(postId: number): Promise<void> {
    await this.post("/post/action/bookmark", { postId });
  }

  async unbookmarkPost(postId: number): Promise<void> {
    await this.post("/post/action/unbookmark", { postId });
  }

  async superLikePost(postId: number): Promise<void> {
    await this.post("/post/action/super-like", { postId });
  }

  // ── Playlists ─────────────────────────────────────────
  async getPlaylist(playlistId: number): Promise<Playlist> {
    return this.get<Playlist>(`/playlist/${playlistId}`);
  }

  async searchPlaylists(
    take = 20,
    cursor?: string | null
  ): Promise<PaginatedResponse<Playlist>> {
    const body: Record<string, unknown> = { take };
    if (cursor) body.cursor = cursor;
    return this.post<PaginatedResponse<Playlist>>("/playlist/search", body);
  }

  async getMyPlaylists(take = 50): Promise<PaginatedResponse<Playlist>> {
    if (!this.user) throw new Error("Not logged in");
    return this.post<PaginatedResponse<Playlist>>(
      `/playlist/search/user/${this.user.id}`,
      { take }
    );
  }

  async getUserPlaylists(userId: number, take = 50): Promise<PaginatedResponse<Playlist>> {
    return this.post<PaginatedResponse<Playlist>>(
      `/playlist/search/user/${userId}`,
      { take }
    );
  }

  async addToPlaylist(playlistId: number, postId: number): Promise<void> {
    await this.post("/playlist/add-item", { playlistId, postId, rewrite: true });
  }

  async removeFromPlaylist(playlistId: number, postId: number): Promise<void> {
    await this.post("/playlist/remove-item", { playlistId, postId });
  }

  // ── Similar Posts ───────────────────────────────────────
  async searchSimilarPosts(
    post: Post,
    take = 5
  ): Promise<Post[]> {
    const tags = post.tags ?? [];
    // Prioritize artist > character > copyright > general tags
    const prioritized = [
      ...tags.filter((t) => t.type === 8),  // artist
      ...tags.filter((t) => t.type === 4),  // character
      ...tags.filter((t) => t.type === 2),  // copyright
      ...tags.filter((t) => t.type === 1),  // general
    ];
    // Use top 3 tags for similarity search
    const searchTags = prioritized.slice(0, 3).map((t) => t.value);
    if (searchTags.length === 0) return [];
    const data = await this.searchPosts(take + 5, null, { includeTags: searchTags });
    return data.items.filter((p) => p.id !== post.id).slice(0, take);
  }

  // ── Tags ──────────────────────────────────────────────
  async getTrendingTags(): Promise<Tag[]> {
    return this.get<Tag[]>("/tag");
  }

  async searchTags(query?: string): Promise<Tag[]> {
    if (query) {
      return this.get<Tag[]>(`/tag/search/${encodeURIComponent(query)}`);
    }
    return this.get<Tag[]>("/tag/search");
  }

  // ── User Feed ─────────────────────────────────────────
  async getFeedCount(): Promise<number> {
    return this.post<number>("/user-feed/count", {});
  }

  async getFeedLastSeen(): Promise<string> {
    return this.post<string>("/user-feed/last-seen", {});
  }

  async markFeedWatched(): Promise<void> {
    await this.post("/user-feed/watch", {});
  }

  async searchFeedPosts(
    userId: number,
    take = 30,
    cursor?: string | null
  ): Promise<PaginatedResponse<Post>> {
    const body: Record<string, unknown> = { take };
    if (cursor) body.cursor = cursor;
    return this.post<PaginatedResponse<Post>>(`/post/search/tag-subscriptions/${userId}`, body);
  }

  // ── Tag Subscriptions ──────────────────────────────────
  async getActiveTagSubscriptions(): Promise<Tag[]> {
    return this.get<Tag[]>("/tag/subscription/get-active");
  }

  async getAllTagSubscriptions(): Promise<Tag[]> {
    return this.get<Tag[]>("/tag/subscription");
  }

  async subscribeToTag(tagId: number): Promise<void> {
    await this.post(`/tag/subscription/subscribe/${tagId}`, undefined);
  }

  async unsubscribeFromTag(tagId: number): Promise<void> {
    await this.post(`/tag/subscription/unsubscribe/${tagId}`, undefined);
  }

  // ── Tag Blacklist ─────────────────────────────────────
  async getTagBlacklist(): Promise<{ tags: Tag[]; isActive: boolean }> {
    return this.get("/user-tag-blacklist");
  }

  // ── Comments ──────────────────────────────────────────
  async getPostComments(
    postId: number,
    take = 50
  ): Promise<PaginatedResponse<PostComment>> {
    return this.post(`/comment/post/${postId}`, { take });
  }

  async getRecentComments(
    take = 20,
    cursor?: string | null
  ): Promise<PaginatedResponse<PostComment>> {
    const body: Record<string, unknown> = { take };
    if (cursor) body.cursor = cursor;
    return this.post<PaginatedResponse<PostComment>>("/comment/post", body);
  }

  // ── User ──────────────────────────────────────────────
  async getUserLimitations(): Promise<Record<string, unknown>> {
    return this.get("/user-limitations");
  }
}

// ── Search filters ─────────────────────────────────────
export interface SearchFilters {
  type?: number | null;       // 0=image, 1=video, null=all
  includeTags?: string[];     // tag name strings
  minScore?: number;          // client-side: min likes threshold
  sortBy?: number;            // 0=id, 1=likes, 2=views
  postedFromDays?: number;    // 1=daily, 7=weekly, 30=monthly
}

// ── Post cache ─────────────────────────────────────────
const CACHE_MAX = 500;
const PARALLEL_LIMIT = 10;

const postCache = new Map<number, Post>();

function evictCache() {
  if (postCache.size > CACHE_MAX) {
    const keys = [...postCache.keys()];
    for (let i = 0; i < keys.length - CACHE_MAX; i++) {
      postCache.delete(keys[i]);
    }
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function clearPostCache() {
  postCache.clear();
}

export function getCacheStats() {
  return { size: postCache.size, max: CACHE_MAX };
}

export const api = new Rule34VaultAPI();
export default api;
