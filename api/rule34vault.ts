import { Platform } from "react-native";

const PROXY_URL = "http://localhost:3001";
const DIRECT_URL = "https://rule34vault.com";
const CDN_URL = "https://r34xyz.b-cdn.net";

// Cached at module init — Platform.OS never changes at runtime
const BASE_URL = Platform.OS === "web" ? PROXY_URL : DIRECT_URL;
const API_URL = `${BASE_URL}/api/v2`;

function getBaseUrl(): string { return BASE_URL; }
function getApiUrl(): string { return API_URL; }

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
    cacheSet(postId, post);
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
              .then((p) => { cacheSet(id, p); return p; })
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
    
    // Handle time-based filtering
    if (filters?.postedFromDays != null && filters.postedFromDays > 0) {
      body.postedFromDays = filters.postedFromDays;
      // Sort by likes for time-based filters (Daily, Weekly, Monthly)
      body.sortBy = 1;
    } else if (filters?.postedFromDays === 999) {
      // All Time - sort by likes, no time filter
      body.sortBy = 1;
    }
    // Default (-1) - no sortBy parameter for normal layout like main page
    
    return this.post<PaginatedResponse<Post>>("/post/search/root", body);
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

  // ── For You Recommendations ────────────────────────────
  /**
   * TikTok-style recommendation engine:
   * 1. Builds an interest profile from liked + bookmarked posts
   *    (recency decay + action weight + tag-type weight)
   * 2. Generates 3 candidate pools in parallel:
   *    A. Core (50%)   – top 2 tags of user's interests
   *    B. Discovery (30%) – tags ranked 3–5 (adjacent interests)
   *    C. Trending (20%) – popular posts regardless of tags
   * 3. Scores each candidate post by tag match + quality + freshness
   * 4. Interleaves pools then applies a light Fisher-Yates shuffle
   *    so every scroll feels fresh while staying relevant
   * 5. Rotates tag combos per page (shift = page % 4) for variety
   */
  async searchForYouPosts(
    userId: number,
    take = 30,
    cursor?: string | null,
    excludeIds?: Set<number>
  ): Promise<{ items: Post[]; topTags: string[] }> {
    const fallback = async (): Promise<{ items: Post[]; topTags: string[] }> => {
      // Try multiple search strategies for more variety
      const strategies = [
        // Strategy 1: Recent posts
        () => this.searchPosts(take, cursor, { sortBy: 1 }),
        // Strategy 2: Popular posts
        () => this.searchPosts(take, cursor, { sortBy: 2 }),
        // Strategy 3: Random posts
        () => this.searchPosts(take, cursor, { sortBy: 3 }),
      ];

      for (const strategy of strategies) {
        try {
          const data = await strategy();
          // Filter out already seen posts
          const fresh = data.items.filter(p => !excludeIds?.has(p.id));
          if (fresh.length > 0) {
            fyShuffleWindow(fresh, 5);
            return { items: fresh.slice(0, take), topTags: [] };
          }
        } catch {
          continue;
        }
      }

      // Last resort: return any posts even if seen
      const lastResort = await this.searchPosts(take, cursor, { sortBy: 1 });
      fyShuffleWindow(lastResort.items, 5);
      return { items: lastResort.items.slice(0, take), topTags: [] };
    };

    try {
      // ── Phase 1: Fetch history ──
      const [likedRes, bookmarkedRes] = await Promise.all([
        this.searchLikedPosts(userId, 40).catch(() => ({ items: [] as Post[] })),
        this.searchBookmarkedPosts(userId, 20).catch(() => ({ items: [] as Post[] })),
      ]);

      const likedPosts   = likedRes?.items   ?? [];
      const bookmarkedPosts = bookmarkedRes?.items ?? [];
      // Bookmarks first so they weight highest in recency calc
      const rawPosts = [...bookmarkedPosts, ...likedPosts];

      if (rawPosts.length === 0) return fallback();

      // ── Phase 2: Hydrate tags ──
      const needsDetail = rawPosts.filter((p) => !p.tags || p.tags.length === 0);
      if (needsDetail.length > 0) {
        const detailed = await Promise.all(
          needsDetail.slice(0, 25).map((p) => this.getPost(p.id).catch(() => p))
        );
        const dm = new Map(detailed.map((p) => [p.id, p]));
        for (let i = 0; i < rawPosts.length; i++) {
          const d = dm.get(rawPosts[i].id);
          if (d) rawPosts[i] = d;
        }
      }

      // ── Phase 3: Build weighted interest profile ──
      // Weights: bookmark(1.5x) > like(1x), recency (linear 2→1 decay),
      // tag-type: artist(5) > character(4) > copyright(3) > general(1)
      const typeWeight: Record<number, number> = { 8: 5, 4: 4, 2: 3, 1: 1 };
      const tagScore = new Map<string, number>();
      const total = rawPosts.length;

      rawPosts.forEach((post, idx) => {
        const isBookmarked = bookmarkedPosts.some((p) => p.id === post.id);
        const actionW  = isBookmarked ? 1.5 : 1.0;
        const recencyW = 1 + (total - idx) / total; // 2.0 → 1.0 as idx increases
        for (const tag of post.tags ?? []) {
          const tw = typeWeight[tag.type] ?? 1;
          tagScore.set(tag.value, (tagScore.get(tag.value) ?? 0) + tw * actionW * recencyW);
        }
      });

      const rankedTags = [...tagScore.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([v]) => v);

      if (rankedTags.length === 0) return fallback();

      // ── Phase 4: Rotate combos by page ──
      const seenIds = excludeIds ?? new Set<number>(rawPosts.map((p) => p.id));
      const page  = Math.floor((seenIds.size) / Math.max(take, 1));
      const shift = (page % 4); // 0,1,2,3 → different tag windows each page

      const coreCombo      = rankedTags.slice(shift,     shift + 2).filter(Boolean);
      const discoveryCombo = rankedTags.slice(4 + shift, 4 + shift + 2).filter(Boolean);

      const fetchN = Math.ceil(take * 1.8);

      // ── Phase 5: 3 parallel candidate pools ──
      const [poolA, poolB, poolC] = await Promise.all([
        // A: Core — strongest interest tags
        coreCombo.length
          ? this.searchPosts(fetchN, cursor, { includeTags: coreCombo, sortBy: 1 })
              .then((r) => r.items).catch(() => [] as Post[])
          : Promise.resolve([] as Post[]),
        // B: Discovery — adjacent interest tags
        discoveryCombo.length
          ? this.searchPosts(fetchN, cursor, { includeTags: discoveryCombo, sortBy: 1 })
              .then((r) => r.items).catch(() => [] as Post[])
          : Promise.resolve([] as Post[]),
        // C: Trending wildcard — popular posts regardless of tags
        this.searchPosts(Math.ceil(take * 0.4), cursor, { sortBy: 1 })
          .then((r) => r.items).catch(() => [] as Post[]),
      ]);

      // ── Phase 6: Score posts by interest match + quality + freshness ──
      const scorePost = (post: Post): number => {
        let s = 0;
        for (const tag of post.tags ?? []) {
          s += tagScore.get(tag.value) ?? 0;
        }
        s += Math.log((post.likes ?? 0) + 1) * 1.5;
        const ageDays = (Date.now() - new Date(post.posted).getTime()) / 86_400_000;
        if (ageDays < 7)  s *= 1.15;
        if (ageDays < 30) s *= 1.05;
        return s;
      };

      // ── Phase 7: Merge with diversity caps ──
      // Pool ratios: A=40%, B=35%, C=25% (more diversity)
      const coreMax  = Math.ceil(take * 0.40);
      const discMax  = Math.ceil(take * 0.35);
      const trendMax = Math.ceil(take * 0.25);

      const globalSeen = new Set(seenIds);

      const pickFromPool = (pool: Post[], max: number, allowDuplicates = false): Post[] => {
        // If we're running out of fresh content, relax the seen filter
        const freshFilter = allowDuplicates ? (p: Post) => true : (p: Post) => !globalSeen.has(p.id);
        
        // Score, take top 3x candidates for more variety, shuffle them, then pick max
        const candidates = pool
          .filter(freshFilter)
          .map((p) => ({ post: p, score: scorePost(p) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, max * 3); // Increased from 2x to 3x for more variety
        fyShuffleAll(candidates);
        const picked: Post[] = [];
        for (const { post } of candidates) {
          if (picked.length < max) {
            picked.push(post);
            globalSeen.add(post.id);
          }
        }
        return picked;
      };

      // First try with strict filtering
      let coreItems  = pickFromPool(poolA, coreMax);
      let discItems  = pickFromPool(poolB, discMax);
      let trendItems = pickFromPool(poolC, trendMax);

      // If we don't have enough content, relax the filters
      const totalItems = coreItems.length + discItems.length + trendItems.length;
      if (totalItems < take * 0.7) {
        // Allow some duplicates from trending pool
        const additionalTrend = pickFromPool(poolC, trendMax, true);
        trendItems = [...trendItems, ...additionalTrend].slice(0, trendMax);
        
        // If still not enough, add more from discovery pool
        if (coreItems.length + discItems.length + trendItems.length < take * 0.8) {
          const additionalDisc = pickFromPool(poolB, discMax, true);
          discItems = [...discItems, ...additionalDisc].slice(0, discMax);
        }
      }

      // ── Phase 8: Interleave pools A/B/C then light-shuffle ──
      const interleaved = fyInterleave(coreItems, discItems, trendItems);
      fyShuffleWindow(interleaved, 4); // light window shuffle keeps local variety

      if (interleaved.length === 0) return fallback();

      return {
        items: interleaved.slice(0, take),
        topTags: rankedTags.slice(0, 5),
      };
    } catch {
      return fallback();
    }
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

function cacheSet(id: number, post: Post) {
  postCache.set(id, post);
  if (postCache.size > CACHE_MAX) {
    // Evict oldest entries (Map preserves insertion order)
    const excess = postCache.size - CACHE_MAX;
    const iter = postCache.keys();
    for (let i = 0; i < excess; i++) {
      const { value, done } = iter.next();
      if (done) break;
      postCache.delete(value);
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

// ── For You algorithm helpers ──────────────────────────

/** Full Fisher-Yates shuffle in place */
function fyShuffleAll<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

/**
 * Light window shuffle: each element is swapped with a random element
 * within `windowSize` positions ahead. Keeps local order mostly intact
 * while adding variety so the feed never feels perfectly sorted.
 */
function fyShuffleWindow<T>(arr: T[], windowSize: number): void {
  for (let i = 0; i < arr.length - 1; i++) {
    const max = Math.min(i + windowSize, arr.length - 1);
    const j   = i + Math.floor(Math.random() * (max - i + 1));
    if (i !== j) { const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; }
  }
}

/**
 * Interleave multiple arrays round-robin style.
 * [A0,A1], [B0,B1], [C0] → [A0,B0,C0,A1,B1]
 */
function fyInterleave<T>(...arrays: T[][]): T[] {
  const result: T[] = [];
  const maxLen = Math.max(0, ...arrays.map((a) => a.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of arrays) {
      if (i < arr.length) result.push(arr[i]);
    }
  }
  return result;
}

export function getCacheStats() {
  return { size: postCache.size, max: CACHE_MAX };
}

export const api = new Rule34VaultAPI();
export default api;
