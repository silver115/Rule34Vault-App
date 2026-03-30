import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    FlatList,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import api, { Post } from "../api/rule34vault";
import { Colors, FontSize, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../contexts/AuthContext";
import { useSettings } from "../contexts/SettingsContext";
import { downloadMedia } from "../utils/download";
import { getSiteMediaUrl } from "../utils/media";
import { sendRecSignal } from "../utils/recommendations";
import { isBrokenPost, markBroken, onBrokenPostsChange } from "./PostCard";

// ── FeedView Container ───────────────────────────────────────

interface FeedViewProps {
  posts: Post[];
  isLoading: boolean;
  isLoadingMore: boolean;
  onRefresh: () => void;
  onEndReached: () => void;
  onExit: () => void;
}

export function FeedView({
  posts,
  isLoading,
  isLoadingMore,
  onRefresh,
  onEndReached,
  onExit,
}: FeedViewProps) {
  const { height: screenH, width: screenW } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  // Filter broken posts — same mechanism as PostGrid
  const [, setBrokenTick] = useState(0);
  useEffect(() => {
    return onBrokenPostsChange(() => setBrokenTick((t) => t + 1));
  }, []);

  const filteredPosts = React.useMemo(
    () => posts.filter((p) => !isBrokenPost(p.id)),
    [posts, setBrokenTick],
  );

  // ── Viewability tracking ──
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index ?? 0);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  // ── Snap state ──
  const isSnapping = useRef(false);
  const scrollOffsetY = useRef(0);
  const scrollVelocityY = useRef(0);
  const lastScrollTime = useRef(Date.now());
  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;

  // ── Web: wheel-based snap scrolling (TikTok-like) ──
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = (flatListRef.current as any)?.getScrollableNode?.();
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isSnapping.current) return;

      wheelAccum.current += e.deltaY;
      if (wheelTimer.current) clearTimeout(wheelTimer.current);

      wheelTimer.current = setTimeout(() => {
        const delta = wheelAccum.current;
        wheelAccum.current = 0;
        if (Math.abs(delta) < 30) return;

        const dir = delta > 0 ? 1 : -1;
        const nextIdx = Math.max(
          0,
          Math.min(filteredPosts.length - 1, activeIndexRef.current + dir),
        );

        if (nextIdx !== activeIndexRef.current) {
          isSnapping.current = true;
          flatListRef.current?.scrollToIndex({
            index: nextIdx,
            animated: true,
          });
          setActiveIndex(nextIdx);
          setTimeout(() => {
            isSnapping.current = false;
          }, 400);
        }
      }, 50);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [filteredPosts.length]);

  const toggleMute = useCallback(() => setIsMuted((m) => !m), []);

  // ── Native scroll handlers ──
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const now = Date.now();
      const newOffset = e.nativeEvent.contentOffset.y;
      const dt = Math.max(now - lastScrollTime.current, 1);
      scrollVelocityY.current = (newOffset - scrollOffsetY.current) / dt;
      scrollOffsetY.current = newOffset;
      lastScrollTime.current = now;
    },
    [],
  );

  const snapToIndex = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(filteredPosts.length - 1, idx));
      isSnapping.current = true;
      flatListRef.current?.scrollToIndex({ index: clamped, animated: true });
      setActiveIndex(clamped);
      activeIndexRef.current = clamped;
      setTimeout(() => {
        isSnapping.current = false;
      }, 500);
    },
    [filteredPosts.length],
  );

  const handleScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (isSnapping.current) return;
      const offset = e.nativeEvent.contentOffset.y;
      const velocity = scrollVelocityY.current; // px/ms
      const currentIdx = activeIndexRef.current;
      const baseOffset = currentIdx * screenH;
      const displacement = offset - baseOffset;

      // Snap forward: flick (velocity > 0.3px/ms) OR dragged > 25% of screen
      if (velocity > 0.3 || displacement > screenH * 0.25) {
        snapToIndex(currentIdx + 1);
      } else if (velocity < -0.3 || displacement < -screenH * 0.25) {
        snapToIndex(currentIdx - 1);
      } else {
        // snap back to current
        snapToIndex(currentIdx);
      }
    },
    [screenH, snapToIndex],
  );

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Correct any drift after momentum finishes
      if (isSnapping.current) return;
      const offset = e.nativeEvent.contentOffset.y;
      const nearest = Math.round(offset / screenH);
      const clamped = Math.max(0, Math.min(filteredPosts.length - 1, nearest));
      if (clamped !== activeIndexRef.current) {
        setActiveIndex(clamped);
        activeIndexRef.current = clamped;
      }
    },
    [screenH, filteredPosts.length],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <FeedItem
        post={item}
        isActive={index === activeIndex}
        isNearby={Math.abs(index - activeIndex) <= 2}
        screenW={screenW}
        screenH={screenH}
        topInset={insets.top}
        bottomInset={insets.bottom}
        isMuted={isMuted}
        onToggleMute={toggleMute}
        onExit={onExit}
      />
    ),
    [
      activeIndex,
      screenW,
      screenH,
      insets.top,
      insets.bottom,
      isMuted,
      toggleMute,
      onExit,
    ],
  );

  const keyExtractor = useCallback((item: Post) => String(item.id), []);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: screenH,
      offset: screenH * index,
      index,
    }),
    [screenH],
  );

  if (isLoading && filteredPosts.length === 0) {
    return (
      <View style={styles.fullscreen}>
        <StatusBar hidden />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fullscreen}>
      <StatusBar hidden />
      <FlatList
        ref={flatListRef}
        data={filteredPosts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsVerticalScrollIndicator={false}
        snapToInterval={screenH}
        snapToAlignment="start"
        decelerationRate={0.9}
        overScrollMode="never"
        bounces={false}
        scrollEventThrottle={16}
        onScroll={Platform.OS !== "web" ? handleScroll : undefined}
        onScrollEndDrag={
          Platform.OS !== "web" ? handleScrollEndDrag : undefined
        }
        onMomentumScrollEnd={
          Platform.OS !== "web" ? handleMomentumScrollEnd : undefined
        }
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={getItemLayout}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.8}
        removeClippedSubviews={Platform.OS !== "web"}
        windowSize={3}
        maxToRenderPerBatch={3}
        initialNumToRender={2}
        updateCellsBatchingPeriod={50}
        ListEmptyComponent={
          <View style={[styles.center, { height: screenH }]}>
            <Text style={styles.emptyText}>No posts found</Text>
          </View>
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View style={[styles.center, { height: 60 }]}>
              <ActivityIndicator size="small" color={Colors.accent} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

// ── Individual Feed Item ─────────────────────────────────────

interface FeedItemProps {
  post: Post;
  isActive: boolean;
  isNearby: boolean;
  screenW: number;
  screenH: number;
  topInset: number;
  bottomInset: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onExit: () => void;
}

const FeedItem = memo(function FeedItem({
  post,
  isActive,
  isNearby,
  screenW,
  screenH,
  topInset,
  bottomInset,
  isMuted,
  onToggleMute,
  onExit,
}: FeedItemProps) {
  const router = useRouter();
  const { isLoggedIn, token } = useAuth();
  const { qualityOption } = useSettings();

  const isVideo = post.type === 1;
  const fullUrl = getSiteMediaUrl(post, "full");
  const thumbUrl = getSiteMediaUrl(post, "thumb");
  const hasComments = (post.comments ?? 0) > 0;

  // Action states
  const [liked, setLiked] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);

  // Double-tap animation
  const heartScale = useRef(new Animated.Value(0)).current;
  const [showHeart, setShowHeart] = useState(false);

  // Video ref
  const videoRef = useRef<any>(null);
  const webVideoRef = useRef<HTMLVideoElement | null>(null);

  // Mark post as broken on media error (same as PostGrid 404 handling)
  const handleMediaError = useCallback(() => {
    if (!mediaFailed) {
      setMediaFailed(true);
      markBroken(post.id);
    }
  }, [post.id, mediaFailed]);

  // Fetch action state when active
  useEffect(() => {
    if (!isActive || !isLoggedIn) return;
    let cancelled = false;
    api
      .getPostActionState(post.id)
      .then((state) => {
        if (!cancelled) {
          setLiked(state.isLiked);
          setBookmarked(state.isBookmarked);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isActive, post.id, isLoggedIn]);

  // Auto-play/pause video based on visibility + mute control
  useEffect(() => {
    if (!isVideo) return;
    if (Platform.OS === "web") {
      const vid = webVideoRef.current;
      if (!vid) return;
      vid.muted = isMuted;
      if (isActive && qualityOption.videoAutoplay) {
        vid.play().catch(() => {});
      } else {
        vid.pause();
        vid.currentTime = 0;
      }
    } else {
      if (videoRef.current) {
        videoRef.current.setIsMutedAsync(isMuted).catch(() => {});
        if (isActive && qualityOption.videoAutoplay) {
          videoRef.current.playAsync().catch(() => {});
        } else {
          videoRef.current.stopAsync().catch(() => {});
        }
      }
    }
  }, [isActive, isVideo, qualityOption.videoAutoplay, isMuted]);

  // Double-tap to like
  const lastTap = useRef(0);
  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      handleDoubleTapLike();
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  }, [liked, isLoggedIn]);

  function handleDoubleTapLike() {
    if (!isLoggedIn) return;
    setShowHeart(true);
    heartScale.setValue(0);
    Animated.sequence([
      Animated.spring(heartScale, {
        toValue: 1,
        friction: 3,
        tension: 150,
        useNativeDriver: true,
      }),
      Animated.timing(heartScale, {
        toValue: 0,
        duration: 400,
        delay: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setShowHeart(false));

    if (!liked) {
      setLiked(true);
      api.likePost(post.id).catch(() => setLiked(false));
      if (token && post.tags) sendRecSignal(token, post.id, "like", post.tags);
    }
  }

  const handleLike = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      if (liked) {
        await api.unlikePost(post.id);
        setLiked(false);
      } else {
        await api.likePost(post.id);
        setLiked(true);
        if (token && post.tags)
          sendRecSignal(token, post.id, "like", post.tags);
      }
    } catch {}
  }, [liked, isLoggedIn, post.id, token]);

  const handleBookmark = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      if (bookmarked) {
        await api.unbookmarkPost(post.id);
        setBookmarked(false);
      } else {
        await api.bookmarkPost(post.id);
        setBookmarked(true);
        if (token && post.tags)
          sendRecSignal(token, post.id, "bookmark", post.tags);
      }
    } catch {}
  }, [bookmarked, isLoggedIn, post.id, token]);

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const ext = isVideo ? "mp4" : "jpg";
      const fileName = `${post.id}.${ext}`;
      await downloadMedia(fullUrl, fileName);
    } catch (e: any) {
      if (Platform.OS !== "web") {
        Alert.alert("Download failed", e?.message || "An error occurred.");
      }
    } finally {
      setDownloading(false);
    }
  }, [fullUrl, post.id, isVideo, downloading]);

  const handleOpenDetail = useCallback(() => {
    router.push({ pathname: "/post/[id]", params: { id: String(post.id) } });
  }, [post.id]);

  const handleOpenComments = useCallback(() => {
    router.push({ pathname: "/post/[id]", params: { id: String(post.id) } });
  }, [post.id]);

  const safeTop = Math.max(topInset, 12);
  const safeBottom = Math.max(bottomInset, 16);

  // Only render full media for nearby items (within 2 positions) to save RAM
  const shouldRenderMedia = isNearby;

  return (
    <View style={[styles.feedItem, { width: screenW, height: screenH }]}>
      {/* Media — fills entire screen */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleTap}>
        {shouldRenderMedia ? (
          isVideo ? (
            Platform.OS === "web" ? (
              <video
                ref={(el) => {
                  webVideoRef.current = el;
                }}
                src={fullUrl}
                poster={thumbUrl}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  backgroundColor: "#000",
                }}
                loop
                muted={isMuted}
                playsInline
                preload="auto"
                onError={() => handleMediaError()}
              />
            ) : (
              <Video
                ref={videoRef}
                source={{ uri: fullUrl }}
                posterSource={{ uri: thumbUrl }}
                usePoster
                style={StyleSheet.absoluteFill}
                resizeMode={ResizeMode.CONTAIN}
                isLooping
                isMuted={isMuted}
                shouldPlay={isActive && qualityOption.videoAutoplay}
                onError={() => handleMediaError()}
              />
            )
          ) : (
            <Image
              source={{
                uri: getSiteMediaUrl(post, qualityOption.detailVariant),
              }}
              placeholder={{ uri: thumbUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              transition={150}
              cachePolicy="memory-disk"
              recyclingKey={`feed-${post.id}`}
              onError={() => handleMediaError()}
            />
          )
        ) : (
          // Placeholder for far-away items — just show thumbnail
          <Image
            source={{ uri: thumbUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        )}
      </Pressable>

      {/* Faded exit button — top right */}
      <Pressable
        style={[styles.exitBtn, { top: safeTop }]}
        onPress={onExit}
        hitSlop={12}
      >
        <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
      </Pressable>

      {/* Mute toggle for videos — top left */}
      {isVideo && isActive && (
        <Pressable
          style={[styles.muteBtn, { top: safeTop }]}
          onPress={onToggleMute}
          hitSlop={12}
        >
          <Ionicons
            name={isMuted ? "volume-mute" : "volume-high"}
            size={18}
            color="rgba(255,255,255,0.6)"
          />
        </Pressable>
      )}

      {/* Double-tap heart animation */}
      {showHeart && (
        <Animated.View
          style={[
            styles.doubleTapHeart,
            {
              transform: [{ scale: heartScale }],
              opacity: heartScale,
            },
          ]}
          pointerEvents="none"
        >
          <Ionicons name="heart" size={100} color={Colors.likeFilled} />
        </Animated.View>
      )}

      {/* Bottom info overlay */}
      <View
        style={[styles.bottomOverlay, { paddingBottom: safeBottom + 8 }]}
        pointerEvents="box-none"
      >
        <Text style={styles.postId} numberOfLines={1}>
          #{post.id}
        </Text>
        <View style={styles.statsRow}>
          {post.likes != null && (
            <View style={styles.statChip}>
              <Ionicons name="heart" size={11} color={Colors.like} />
              <Text style={styles.statText}>{post.likes}</Text>
            </View>
          )}
          {post.views != null && (
            <View style={styles.statChip}>
              <Ionicons name="eye" size={11} color="#aaa" />
              <Text style={styles.statText}>{post.views}</Text>
            </View>
          )}
          {isVideo && (
            <View style={styles.statChip}>
              <Ionicons name="videocam" size={11} color={Colors.accent} />
              <Text style={styles.statText}>Video</Text>
            </View>
          )}
        </View>
      </View>

      {/* Right-side action buttons */}
      <View style={[styles.actionsColumn, { bottom: safeBottom + 20 }]}>
        {isLoggedIn && (
          <>
            <Pressable style={styles.actionBtn} onPress={handleLike}>
              <View style={styles.actionCircle}>
                <Ionicons
                  name={liked ? "heart" : "heart-outline"}
                  size={24}
                  color={liked ? Colors.likeFilled : "#fff"}
                />
              </View>
              <Text style={styles.actionCount}>{post.likes ?? 0}</Text>
            </Pressable>

            <Pressable style={styles.actionBtn} onPress={handleBookmark}>
              <View style={styles.actionCircle}>
                <Ionicons
                  name={bookmarked ? "bookmark" : "bookmark-outline"}
                  size={22}
                  color={bookmarked ? Colors.bookmarkFilled : "#fff"}
                />
              </View>
            </Pressable>
          </>
        )}

        {hasComments && (
          <Pressable style={styles.actionBtn} onPress={handleOpenComments}>
            <View style={styles.actionCircle}>
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={22}
                color="#fff"
              />
            </View>
            <Text style={styles.actionCount}>{post.comments}</Text>
          </Pressable>
        )}

        <Pressable style={styles.actionBtn} onPress={handleDownload}>
          <View style={styles.actionCircle}>
            {downloading ? (
              <ActivityIndicator size={20} color="#fff" />
            ) : (
              <Ionicons name="download-outline" size={22} color="#fff" />
            )}
          </View>
        </Pressable>

        <Pressable style={styles.actionBtn} onPress={handleOpenDetail}>
          <View style={styles.actionCircle}>
            <Ionicons name="expand-outline" size={20} color="#fff" />
          </View>
          <Text style={styles.actionLabel}>Info</Text>
        </Pressable>
      </View>
    </View>
  );
});

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fullscreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    zIndex: 100,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
  },
  feedItem: {
    backgroundColor: "#000",
    overflow: "hidden",
  },
  exitBtn: {
    position: "absolute",
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 30,
  },
  muteBtn: {
    position: "absolute",
    left: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 30,
  },
  doubleTapHeart: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -50,
    marginLeft: -50,
    zIndex: 20,
  },
  bottomOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 70,
    paddingHorizontal: Spacing.lg,
    paddingTop: 40,
  },
  postId: {
    color: "#fff",
    fontSize: FontSize.lg,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  statsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: 6,
  },
  statChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  statText: {
    color: "#ddd",
    fontSize: FontSize.xs,
    fontWeight: "500",
  },
  actionsColumn: {
    position: "absolute",
    right: 10,
    alignItems: "center",
    gap: 18,
  },
  actionBtn: {
    alignItems: "center",
    gap: 3,
  },
  actionCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  actionCount: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  actionLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "500",
  },
});
