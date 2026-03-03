import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import api, {
    getMediaUrl,
    Post,
    PostActionState,
    SearchFilters,
    Tag,
    TAG_TYPE
} from "../../api/rule34vault";
import { FilterBar } from "../../components/FilterBar";
import { TagChip } from "../../components/TagChip";
import { ZoomableImage } from "../../components/ZoomableImage";
import { Colors, FontSize, getTagColor, Radius, Spacing } from "../../constants/theme";
import { useAuth } from "../../contexts/AuthContext";
import { usePostList } from "../../contexts/PostListContext";
import { useSettings } from "../../contexts/SettingsContext";
import { downloadMedia } from "../../utils/download";
import { sendRecSignal, sendViewDuration } from "../../utils/recommendations";

const PREFETCH_COUNT = 5;

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { postIds: contextPostIds } = usePostList();
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const startId = Number(id);

  const postIds = useMemo(() => {
    if (contextPostIds.length > 0) {
      if (!contextPostIds.includes(startId)) return [startId];
      return contextPostIds;
    }
    return [startId];
  }, [startId, contextPostIds]);

  const startIndex = postIds.indexOf(startId);
  const pagerRef = useRef<FlatList>(null);

  // Track which page is currently visible
  const [activePostId, setActivePostId] = useState(startId);
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setActivePostId(viewableItems[0].item);
    }
  }).current;

  // Shared mute state: default unmuted, persists across page swipes
  const [isMuted, setIsMuted] = useState(false);
  const toggleMute = useCallback(() => setIsMuted((m) => !m), []);

  // Prefetch next N posts' media when active post changes
  const { qualityOption } = useSettings();
  useEffect(() => {
    const currentIdx = postIds.indexOf(activePostId);
    if (currentIdx < 0) return;
    const upcoming = postIds.slice(currentIdx + 1, currentIdx + 1 + PREFETCH_COUNT);
    upcoming.forEach((pid) => {
      api.getPost(pid).then((post) => {
        if (Platform.OS !== "web") {
          // Always prefetch thumbnail
          Image.prefetch(getMediaUrl(post, "thumb")).catch(() => {});
          // Only prefetch full image if quality setting requires it and it's an image
          if (qualityOption.detailVariant === "full" && post.type === 0) {
            Image.prefetch(getMediaUrl(post, "full")).catch(() => {});
          }
        }
      }).catch(() => {});
    });
  }, [activePostId, postIds, qualityOption]);

  // Usable media height: full screen minus top+bottom safe area
  const mediaH = SCREEN_H - insets.top - insets.bottom;

  const renderPage = useCallback(
    ({ item }: { item: number }) => (
      <View style={{ width: SCREEN_W }}>
        <PostPage
          postId={item}
          screenW={SCREEN_W}
          screenH={SCREEN_H}
          mediaH={mediaH}
          topInset={insets.top}
          isActive={item === activePostId}
          isMuted={isMuted}
          onToggleMute={toggleMute}
          postIds={postIds}
        />
      </View>
    ),
    [SCREEN_W, SCREEN_H, mediaH, insets.top, activePostId, isMuted, toggleMute, postIds]
  );

  return (
    <View style={styles.root}>
      <FlatList
        ref={pagerRef}
        data={postIds}
        renderItem={renderPage}
        keyExtractor={(item) => String(item)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={startIndex > 0 ? startIndex : 0}
        getItemLayout={(_, index) => ({
          length: SCREEN_W,
          offset: SCREEN_W * index,
          index,
        })}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        removeClippedSubviews={Platform.OS !== "web"}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />
      {/* Back button overlay */}
      <Pressable style={[styles.backBtn, { top: insets.top + 8 }]} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color="#fff" />
      </Pressable>
    </View>
  );
}

function PostPage({
  postId,
  screenW,
  screenH,
  mediaH,
  topInset,
  isActive,
  isMuted,
  onToggleMute,
  postIds,
}: {
  postId: number;
  screenW: number;
  screenH: number;
  mediaH: number;
  topInset: number;
  isActive: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  postIds: number[];
}) {
  const { isLoggedIn, token } = useAuth();
  const { qualityOption } = useSettings();
  const { actionStates: ctxActionStates, updateActionState: ctxUpdateActionState } = usePostList();
  const router = useRouter();
  const [post, setPost] = useState<Post | null>(null);
  // Seed from context cache if already known (e.g. came from grid/TikTok view)
  const [actionState, setActionState] = useState<PostActionState>(
    ctxActionStates[postId] ?? { isLiked: false, isBookmarked: false, isSuperLiked: false }
  );
  const [isLoading, setIsLoading] = useState(true);
  const [mediaError, setMediaError] = useState(false);
  const [similarPosts, setSimilarPosts] = useState<Post[]>([]);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [actionStateLoading, setActionStateLoading] = useState(false);
  const [comicOpen, setComicOpen] = useState(false);
  const videoRef = useRef<any>(null);
  const webVideoRef = useRef<HTMLVideoElement | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [mediaRetryCount, setMediaRetryCount] = useState(0);
  const [mediaLoadingState, setMediaLoadingState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const MAX_RETRIES = 2;
  const MEDIA_TIMEOUT = 15000; // 15 seconds

  // View duration tracking for rec server
  const viewStartRef = useRef<number>(0);
  const sentDurationRef = useRef(false);

  // Optimized media URL generation
  const mediaUrl = useMemo(() => {
    if (!post) return "";
    return getMediaUrl(post, "full", true);  // Use CDN URL
  }, [post]);

  // Media loading timeout and retry logic
  useEffect(() => {
    if (!post || mediaLoadingState === 'loaded' || mediaLoadingState === 'failed') return;

    const timeout = setTimeout(() => {
      if (mediaLoadingState === 'loading') {
        handleMediaFailure();
      }
    }, MEDIA_TIMEOUT);

    return () => clearTimeout(timeout);
  }, [post, mediaLoadingState, mediaRetryCount]);

  const handleMediaFailure = useCallback(() => {
    if (mediaRetryCount < MAX_RETRIES) {
      const delay = 1000 * Math.pow(2, mediaRetryCount);
      setTimeout(() => {
        setMediaRetryCount(prev => prev + 1);
        setMediaLoadingState('loading');
        setMediaError(false);
      }, delay);
    } else {
      setMediaLoadingState('failed');
    }
  }, [mediaRetryCount]);

  const handleMediaSuccess = useCallback(() => {
    setMediaLoadingState('loaded');
    setMediaRetryCount(0);
  }, []);

  // Apply filters to similar posts
  const filteredSimilarPosts = useMemo(() => {
    let filtered = [...similarPosts];
    
    // Filter by type
    if (filters.type != null) {
      filtered = filtered.filter(p => p.type === filters.type);
    }
    
    // Filter by hot range (postedFromDays)
    if (filters.postedFromDays != null && filters.postedFromDays > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - filters.postedFromDays);
      filtered = filtered.filter(p => {
        const postDate = new Date(p.created);
        return postDate >= cutoffDate;
      });
    }
    // Note: 999 (All Time) and -1 (Default) don't need time filtering
    
    return filtered;
  }, [similarPosts, filters]);

  const thumbUrl = useMemo(() => {
    if (!post) return "";
    return getMediaUrl(post, "thumb", true);
  }, [post]);

  // Video poster URL with 3-second timestamp (for web)
  const videoPosterUrl = useMemo(() => {
    if (!post || post.type !== 1) return "";
    const baseUrl = getMediaUrl(post, "full", true);
    // Add #t=3 to seek to 3 seconds for poster
    return `${baseUrl}#t=3`;
  }, [post]);

  // Preload next/previous videos for instant playback (web only — uses DOM link injection)
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!isActive || !post || post.type !== 1) return;
    
    const currentIndex = postIds.indexOf(post.id);
    const nextIds = [
      postIds[currentIndex - 1],
      postIds[currentIndex + 1],
    ].filter(Boolean).slice(0, 2);

    const links: HTMLLinkElement[] = [];
    nextIds.forEach(id => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = getMediaUrl({ id, type: 1 } as any, 'thumb', true);
      document.head.appendChild(link);
      links.push(link);
    });
    return () => { links.forEach(l => l.parentNode?.removeChild(l)); };
  }, [isActive, post, postIds]);

  useEffect(() => {
    if (isActive) {
      viewStartRef.current = Date.now();
      sentDurationRef.current = false;
    } else if (viewStartRef.current > 0 && !sentDurationRef.current && token && post) {
      const durationSec = (Date.now() - viewStartRef.current) / 1000;
      sentDurationRef.current = true;
      sendViewDuration(token, postId, durationSec, post.tags);
    }
  }, [isActive]);

  // Reset thumb loading when post changes
  useEffect(() => {
    setThumbLoaded(false);
    setMediaError(false);
    setVideoPlaying(false);
    setActionStateLoading(false);
  }, [postId]);

  // Send view duration on unmount
  useEffect(() => {
    return () => {
      if (viewStartRef.current > 0 && !sentDurationRef.current && token && post) {
        const durationSec = (Date.now() - viewStartRef.current) / 1000;
        sendViewDuration(token, postId, durationSec, post.tags);
      }
    };
  }, [post?.id, token]);

  // Reset error state when post changes
  useEffect(() => {
    setMediaError(false);
    setVideoPlaying(false);
  }, [postId]);

  // Control play/pause and mute based on active state
  useEffect(() => {
    try {
      if (Platform.OS === "web" && webVideoRef.current) {
        const v = webVideoRef.current;
        v.muted = isMuted;
        if (isActive && videoPlaying) {
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      }
      if (Platform.OS !== "web" && videoRef.current) {
        if (isActive && videoPlaying) {
          videoRef.current.playAsync?.().catch?.(() => {});
        } else {
          videoRef.current.pauseAsync?.().catch?.(() => {});
        }
      }
    } catch (e) {
      console.warn("[PostPage] Video control error:", e);
    }
  }, [isActive, isMuted, videoPlaying]);

  // Auto-play videos based on quality setting
  useEffect(() => {
    if (isActive && qualityOption.videoAutoplay) {
      setVideoPlaying(true);
    } else if (!isActive) {
      setVideoPlaying(false);
    }
  }, [isActive, qualityOption.videoAutoplay]);

  // Web: capture mouse wheel to scroll the nested ScrollView
  useEffect(() => {
    if (Platform.OS !== "web") return;
    
    const handler = (e: Event) => {
      const wheelEvent = e as WheelEvent;
      wheelEvent.preventDefault();
      wheelEvent.stopPropagation();
      
        // Try to find a scrollable element
      let scrolled = false;
      
      // Method 1: Try any element with scrollable content
      const elements = document.querySelectorAll('*');
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLElement;
        if (element.scrollHeight > element.clientHeight) {
          const oldScrollTop = element.scrollTop;
          element.scrollTop += wheelEvent.deltaY;
          
          if (element.scrollTop !== oldScrollTop) {
            scrolled = true;
            break;
          }
        }
      }
      
      // Method 2: Fallback to window scroll
      if (!scrolled) {
        window.scrollBy(0, wheelEvent.deltaY);
      }
    };
    
    // Add event listeners for web only
    window.addEventListener("wheel", handler, { passive: false, capture: true });
    document.addEventListener("wheel", handler, { passive: false, capture: true });
    
    return () => {
      window.removeEventListener("wheel", handler, { capture: true } as any);
      document.removeEventListener("wheel", handler, { capture: true } as any);
    };
  }, []);

  useEffect(() => {
    return () => {
      try {
        if (Platform.OS !== "web" && videoRef.current) {
          videoRef.current.unloadAsync?.().catch?.(() => {});
        }
        if (Platform.OS === "web" && webVideoRef.current) {
          webVideoRef.current.pause();
          webVideoRef.current.removeAttribute("src");
          webVideoRef.current.load();
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const data = await api.getPost(postId);
        if (!cancelled) setPost(data);
        if (isLoggedIn) {
          try {
            setActionStateLoading(true);
            const state = await api.getPostActionState(postId);
            if (!cancelled) {
              setActionState(state);
              ctxUpdateActionState(postId, state);
            }
          } catch {
            // Retry once after a short delay
            setTimeout(() => {
              if (!cancelled && isLoggedIn) {
                api.getPostActionState(postId)
                  .then((retryState) => { if (!cancelled) { setActionState(retryState); ctxUpdateActionState(postId, retryState); } })
                  .catch(() => {});
              }
            }, 1000);
          }
        }
        setActionStateLoading(false);
      } catch {}
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [postId, isLoggedIn]);

  // Fetch similar posts once post data is available
  useEffect(() => {
    if (!post) return;
    let cancelled = false;
    api.searchSimilarPosts(post, 5).then((similar) => {
      if (!cancelled) setSimilarPosts(similar);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [post?.id]);

  // Helper: update both local state and shared context
  const applyActionState = useCallback((next: PostActionState) => {
    setActionState(next);
    ctxUpdateActionState(postId, next);
  }, [postId, ctxUpdateActionState]);

  async function toggleLike() {
    if (!isLoggedIn) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (actionState.isLiked) {
        await api.unlikePost(postId);
        applyActionState({ ...actionState, isLiked: false, isSuperLiked: false });
      } else {
        await api.likePost(postId);
        applyActionState({ ...actionState, isLiked: true });
        if (token && post?.tags) sendRecSignal(token, postId, "like", post.tags);
      }
    } catch {}
  }

  async function handleSuperLike() {
    if (!isLoggedIn || actionState.isSuperLiked) return;
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await api.superLikePost(postId);
      applyActionState({ ...actionState, isLiked: true, isSuperLiked: true });
      if (token && post?.tags) sendRecSignal(token, postId, "super_like", post.tags);
    } catch {}
  }

  async function toggleBookmark() {
    if (!isLoggedIn) return;
    try {
      if (actionState.isBookmarked) {
        await api.unbookmarkPost(postId);
        applyActionState({ ...actionState, isBookmarked: false });
      } else {
        await api.bookmarkPost(postId);
        applyActionState({ ...actionState, isBookmarked: true });
        if (token && post?.tags) sendRecSignal(token, postId, "bookmark", post.tags);
      }
    } catch {}
  }

  // Refresh action state manually
  async function refreshActionState() {
    if (!isLoggedIn) return;
    try {
      setActionStateLoading(true);
      const state = await api.getPostActionState(postId);
      setActionState(state);
    } catch {} finally {
      setActionStateLoading(false);
    }
  }

  if (isLoading || !post) {
    return (
      <View style={[styles.center, { height: screenH }]}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  // For videos: use safe-area-aware height so controls stay tappable and video fits perfectly
  // For images: use full screen height for max viewing area
  const isVideo = post.type === 1;
  const isTallImage = !isVideo && post.width > 0 && (post.height / post.width) > 2.0;
  const naturalComicHeight = isTallImage ? Math.round(screenW * (post.height / post.width)) : screenH;
  // Dynamic video height that accounts for safe areas and ensures no cutoff
  const videoHeight = isVideo 
    ? screenH - (Platform.OS === 'ios' ? topInset * 2 : 0) - 20 // Account for top and bottom safe areas
    : screenH;
  const displayH = isVideo ? videoHeight : screenH;

  const fullUrl = getMediaUrl(post, "full");

  const tagsByType: Record<string, Tag[]> = {};
  (post.tags ?? []).forEach((t) => {
    const cat = TAG_TYPE[t.type] || "other";
    if (!tagsByType[cat]) tagsByType[cat] = [];
    tagsByType[cat].push(t);
  });
  const tagOrder = ["artist", "copyright", "character", "general", "meta", "other"];
  const sources = post.data?.sources ?? [];

  return (
    <ScrollView
      ref={scrollRef}
      style={{ width: screenW }}
      showsVerticalScrollIndicator={false}
      bounces={false}
      nestedScrollEnabled
      scrollEventThrottle={16}
    >
      {/* Full-screen media */}
      <View style={{ width: screenW, height: screenH, backgroundColor: "#000", paddingTop: isVideo ? topInset : 0 }}>
        {mediaError ? (
          <View style={[styles.center, { height: displayH }]}>
            <Ionicons name="alert-circle-outline" size={48} color="#666" />
            <Text style={{ color: "#888", marginTop: 8, fontSize: 14 }}>
              {mediaLoadingState === 'failed' 
                ? `Failed to load media after ${MAX_RETRIES} attempts` 
                : `Loading media... (Attempt ${mediaRetryCount + 1}/${MAX_RETRIES + 1})`
              }
            </Text>
            {mediaLoadingState === 'failed' ? (
              <Pressable
                style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.1)" }}
                onPress={() => {
                  if (postIds.length > 1) {
                    const currentIndex = postIds.indexOf(post!.id);
                    if (currentIndex < postIds.length - 1) {
                      router.push(`/post/${postIds[currentIndex + 1]}`);
                    } else if (currentIndex > 0) {
                      router.push(`/post/${postIds[currentIndex - 1]}`);
                    } else {
                      router.back();
                    }
                  } else {
                    router.back();
                  }
                }}
              >
                <Text style={{ color: "#fff", fontSize: 14 }}>
                  {postIds.length > 1 ? "Skip to Next Post" : "Go Back"}
                </Text>
              </Pressable>
            ) : (
              <View style={{ marginTop: 12 }}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            )}
          </View>
        ) : isVideo ? (
          <>
            {videoPlaying ? (
              Platform.OS === "web" ? (
                <video
                  ref={(el: HTMLVideoElement | null) => { webVideoRef.current = el; }}
                  src={mediaUrl}
                  poster={videoPosterUrl}
                  style={{ width: screenW, height: displayH, objectFit: "contain", backgroundColor: "#000" }}
                  controls
                  muted={isMuted}
                  loop
                  autoPlay={isActive}
                  onError={() => {
                    setMediaError(true);
                    handleMediaFailure();
                  }}
                  onCanPlay={handleMediaSuccess}
                />
              ) : (
                <Video
                  ref={videoRef}
                  source={{ uri: mediaUrl }}
                  style={{ width: screenW, height: displayH }}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={isActive}
                  isLooping
                  useNativeControls
                  isMuted={isMuted}
                  onError={() => {
                    setMediaError(true);
                    handleMediaFailure();
                  }}
                />
              )
            ) : (
              <Pressable
                style={{ width: screenW, height: displayH, justifyContent: "center", alignItems: "center", backgroundColor: "#000" }}
                onPress={() => setVideoPlaying(true)}
              >
                {Platform.OS === "web" ? (
                  <>
                    {!thumbLoaded && (
                      <View style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1 }}>
                        <ActivityIndicator size="large" color="#fff" />
                      </View>
                    )}
                    <img
                      src={thumbUrl}
                      style={{ width: screenW, height: displayH, objectFit: "contain", display: "block" }}
                      onError={(e) => {
                        setThumbLoaded(true);
                        const img = e.target as HTMLImageElement;
                        img.src = videoPosterUrl;
                      }}
                      onLoad={() => setThumbLoaded(true)}
                    />
                    <View style={styles.playOverlay}>
                      <Ionicons name="play-circle" size={64} color="rgba(255,255,255,0.85)" />
                    </View>
                  </>
                ) : (
                  <>
                    {!thumbLoaded && (
                      <View style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1 }}>
                        <ActivityIndicator size="large" color="#fff" />
                      </View>
                    )}
                    <Image
                      source={{ uri: thumbUrl }}
                      style={{ width: screenW, height: displayH }}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                      onError={() => setThumbLoaded(true)}
                      onLoad={() => setThumbLoaded(true)}
                    />
                    <View style={styles.playOverlay}>
                      <Ionicons name="play-circle" size={64} color="rgba(255,255,255,0.85)" />
                    </View>
                  </>
                )}
              </Pressable>
            )}
          </>
        ) : isTallImage ? (
          <>
            <ZoomableImage
              uri={mediaUrl}
              width={screenW}
              height={screenH}
              onError={() => { setMediaError(true); handleMediaFailure(); }}
              onLoad={handleMediaSuccess}
            />
            <Pressable style={styles.comicExpandBtn} onPress={() => setComicOpen(true)}>
              <Ionicons name="expand-outline" size={20} color="#fff" />
              <Text style={styles.comicExpandText}>Read</Text>
            </Pressable>
          </>
        ) : (
          <ZoomableImage
            uri={mediaUrl}
            width={screenW}
            height={screenH}
            onError={() => { setMediaError(true); handleMediaFailure(); }}
            onLoad={handleMediaSuccess}
          />
        )}

        {/* Scroll hint at bottom — positioned above video controls */}
        {!mediaError && (
          <View style={[styles.scrollHint, isVideo && { bottom: 60 }]}>
            <Ionicons name="chevron-up" size={20} color="rgba(255,255,255,0.6)" />
            <Text style={styles.scrollHintText}>
              {Platform.OS === "web" ? "Scroll down for details" : "Swipe up for details"}
            </Text>
          </View>
        )}
      </View>

      {/* Details below the fold */}
      <View style={styles.detailsContainer}>
        {/* Action bar */}
        <View style={styles.actionBar}>
          <ActionButton
            icon={actionState.isSuperLiked ? "heart-circle" : actionState.isLiked ? "heart" : "heart-outline"}
            color={actionState.isSuperLiked ? "#FFD700" : actionState.isLiked ? Colors.likeFilled : Colors.textSecondary}
            label={post.likes != null ? String(post.likes) : "Like"}
            onPress={toggleLike}
            onLongPress={handleSuperLike}
          />
          <ActionButton
            icon={actionState.isBookmarked ? "bookmark" : "bookmark-outline"}
            color={actionState.isBookmarked ? Colors.bookmarkFilled : Colors.textSecondary}
            label="Save"
            onPress={toggleBookmark}
          />
          <ActionButton
            icon={actionStateLoading ? "sync-outline" : "refresh-outline"}
            color={Colors.textSecondary}
            label={actionStateLoading ? "Loading" : "Refresh"}
            onPress={refreshActionState}
          />
          <ActionButton
            icon="download-outline"
            color={Colors.textSecondary}
            label="Download"
            onPress={async () => {
              const ext = isVideo ? "mp4" : "jpg";
              await downloadMedia(fullUrl, `${post.id}.${ext}`);
            }}
          />
          <ActionButton
            icon="share-outline"
            color={Colors.textSecondary}
            label="Share"
            onPress={() => Linking.openURL(`https://rule34vault.com/post/${postId}`)}
          />
        </View>

        {/* Info */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>ID</Text>
            <Text style={styles.infoValue}>#{post.id}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Type</Text>
            <Text style={styles.infoValue}>{isVideo ? "Video" : "Image"}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Size</Text>
            <Text style={styles.infoValue}>{post.width} × {post.height}</Text>
          </View>
          {post.duration != null && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Duration</Text>
              <Text style={styles.infoValue}>{post.duration}s</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Posted</Text>
            <Text style={styles.infoValue}>
              {new Date(post.posted).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {/* Sources */}
        {sources.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sources</Text>
            {sources.map((src, i) => (
              <Pressable key={i} onPress={() => Linking.openURL(src)}>
                <Text style={styles.sourceLink} numberOfLines={1}>{src}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Tags */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tags</Text>
          {tagOrder.map((cat) => {
            const catTags = tagsByType[cat];
            if (!catTags || catTags.length === 0) return null;
            return (
              <View key={cat} style={styles.tagGroup}>
                <Text style={[styles.tagGroupLabel, { color: getTagColor(catTags[0].type) }]}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </Text>
                <View style={styles.tagList}>
                  {catTags.map((tag) => (
                    <TagChip key={tag.id} tag={tag} compact />
                  ))}
                </View>
              </View>
            );
          })}
        </View>

        {/* Suggested Posts */}
        {similarPosts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Suggested Posts</Text>
            <FilterBar
              filters={filters}
              onFiltersChange={setFilters}
              hideTagInput={true}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.similarRow}
            >
              {filteredSimilarPosts.map((sp) => (
                <Pressable
                  key={sp.id}
                  style={styles.similarCard}
                  onPress={() => router.push({ pathname: "/post/[id]", params: { id: String(sp.id) } })}
                >
                  <Image
                    source={{ uri: getMediaUrl(sp, "thumb") }}
                    style={styles.similarThumb}
                    contentFit="cover"
                    transition={200}
                  />
                  {sp.type === 1 && (
                    <View style={styles.similarVideoBadge}>
                      <Ionicons name="play-circle" size={16} color="#fff" />
                    </View>
                  )}
                  <Text style={styles.similarLikes} numberOfLines={1}>
                    <Ionicons name="heart" size={10} color={Colors.like} /> {sp.likes ?? 0}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              style={styles.viewMoreBtn}
              onPress={() => router.push({ pathname: "/similar-posts", params: { postId: String(post.id) } })}
            >
              <Text style={styles.viewMoreText}>View More</Text>
              <Ionicons name="arrow-forward" size={16} color={Colors.accent} />
            </Pressable>
          </View>
        )}

        <View style={{ height: 80 }} />
      </View>

      {/* ── Comic Reader Modal ───────────────────────────────── */}
      {isTallImage && (
        <Modal
          visible={comicOpen}
          transparent={false}
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => setComicOpen(false)}
        >
          <View style={styles.comicModal}>
            <View style={styles.comicHeader}>
              <Text style={styles.comicHeaderTitle}>Post #{post.id}</Text>
              <Pressable onPress={() => setComicOpen(false)} hitSlop={12} style={styles.comicCloseBtn}>
                <Ionicons name="close" size={24} color="#fff" />
              </Pressable>
            </View>
            {Platform.OS === "web" ? (
              <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as any}>
                <img src={mediaUrl} style={{ width: "100%", display: "block" }} />
              </div>
            ) : (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ alignItems: "center" }}
                showsVerticalScrollIndicator={true}
                bounces={false}
                scrollEventThrottle={16}
              >
                <Image
                  source={{ uri: mediaUrl }}
                  style={{ width: screenW, height: naturalComicHeight }}
                  contentFit="fill"
                  cachePolicy="memory-disk"
                />
              </ScrollView>
            )}
          </View>
        </Modal>
      )}
    </ScrollView>
  );
}

function ActionButton({
  icon,
  color,
  label,
  onPress,
  onLongPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable style={styles.actionBtn} onPress={onPress} onLongPress={onLongPress} delayLongPress={400}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  backBtn: {
    position: "absolute",
    top: 36,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  scrollHint: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  scrollHintText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 2,
  },
  playOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  detailsContainer: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    marginTop: -Radius.lg,
    paddingTop: Spacing.md,
  },
  actionBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  actionBtn: {
    alignItems: "center",
    gap: 4,
    minWidth: 60,
  },
  actionLabel: {
    fontSize: FontSize.xs,
    fontWeight: "500",
  },
  infoSection: {
    margin: Spacing.md,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  infoLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
  },
  infoValue: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  section: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  sourceLink: {
    color: Colors.accentLight,
    fontSize: FontSize.sm,
    marginBottom: Spacing.xs,
    textDecorationLine: "underline",
  },
  tagGroup: {
    marginBottom: Spacing.md,
  },
  tagGroupLabel: {
    fontSize: FontSize.sm,
    fontWeight: "700",
    marginBottom: Spacing.xs,
  },
  tagList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  similarRow: {
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  similarCard: {
    width: 120,
    borderRadius: Radius.md,
    overflow: "hidden",
    backgroundColor: Colors.bgCard,
  },
  similarThumb: {
    width: 120,
    height: 160,
    borderRadius: Radius.md,
  },
  similarVideoBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 10,
    padding: 2,
  },
  similarLikes: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  similarLikesText: {
    color: "#fff",
    fontSize: FontSize.xs,
    fontWeight: "700",
  },
  qualitySelector: {
    position: "absolute",
    top: 60,
    right: 12,
    flexDirection: "row",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 6,
    padding: 4,
    zIndex: 10,
  },
  qualityBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  qualityBtnActive: {
    backgroundColor: Colors.accent,
  },
  qualityBtnText: {
    color: "#fff",
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
  qualityBtnTextActive: {
    color: "#000",
  },
  comicExpandBtn: {
    position: "absolute",
    bottom: 80,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  comicExpandText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  comicModal: {
    flex: 1,
    backgroundColor: "#000",
  },
  comicHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  comicHeaderTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  comicCloseBtn: {
    padding: 4,
  },
  viewMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
  },
  viewMoreText: {
    fontSize: FontSize.sm,
    fontWeight: "600",
    color: Colors.accent,
  },
  mouseWheelIndicator: {
    position: "absolute",
    top: -30,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(76, 175, 80, 0.9)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  mouseWheelText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
});
