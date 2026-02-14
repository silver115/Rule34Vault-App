import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Linking,
  Platform,
  StatusBar,
} from "react-native";
import { Image } from "expo-image";
import { Video, ResizeMode } from "expo-av";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import api, {
  Post,
  PostActionState,
  Tag,
  getMediaUrl,
  TAG_TYPE,
} from "../../api/rule34vault";
import { TagChip } from "../../components/TagChip";
import { useAuth } from "../../contexts/AuthContext";
import { usePostList } from "../../contexts/PostListContext";
import { Colors, Radius, Spacing, FontSize, getTagColor } from "../../constants/theme";

const PREFETCH_COUNT = 5;

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { posts: contextPosts } = usePostList();
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const startId = Number(id);

  const postIds = useMemo(() => {
    if (contextPosts.length > 0) {
      const ids = contextPosts.map((p) => p.id);
      if (!ids.includes(startId)) return [startId];
      return ids;
    }
    return [startId];
  }, [startId, contextPosts]);

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
  useEffect(() => {
    const currentIdx = postIds.indexOf(activePostId);
    if (currentIdx < 0) return;
    const upcoming = postIds.slice(currentIdx + 1, currentIdx + 1 + PREFETCH_COUNT);
    upcoming.forEach((pid) => {
      // Prefetch post data into cache
      api.getPost(pid).then((post) => {
        // Prefetch thumb + full image
        const thumbUrl = getMediaUrl(post, "thumb");
        const fullUrl = getMediaUrl(post, "full");
        if (Platform.OS !== "web") {
          Image.prefetch(thumbUrl).catch(() => {});
          if (post.type === 0) {
            Image.prefetch(fullUrl).catch(() => {});
          }
        }
      }).catch(() => {});
    });
  }, [activePostId, postIds]);

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
        />
      </View>
    ),
    [SCREEN_W, SCREEN_H, mediaH, insets.top, activePostId, isMuted, toggleMute]
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
        windowSize={5}
        maxToRenderPerBatch={3}
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
}: {
  postId: number;
  screenW: number;
  screenH: number;
  mediaH: number;
  topInset: number;
  isActive: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
}) {
  const { isLoggedIn } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [actionState, setActionState] = useState<PostActionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const videoRef = useRef<any>(null);
  const webVideoRef = useRef<HTMLVideoElement | null>(null);

  // Control play/pause and mute based on active state
  useEffect(() => {
    if (Platform.OS === "web" && webVideoRef.current) {
      const v = webVideoRef.current;
      v.muted = isMuted;
      if (isActive) {
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    }
    if (Platform.OS !== "web" && videoRef.current) {
      if (isActive) {
        videoRef.current.playAsync?.().catch?.(() => {});
      } else {
        videoRef.current.pauseAsync?.().catch?.(() => {});
      }
    }
  }, [isActive, isMuted]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const data = await api.getPost(postId);
        if (!cancelled) setPost(data);
        if (isLoggedIn) {
          try {
            const state = await api.getPostActionState(postId);
            if (!cancelled) setActionState(state);
          } catch {}
        }
      } catch {}
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [postId]);

  async function toggleLike() {
    if (!actionState || !isLoggedIn) return;
    try {
      if (actionState.isLiked) {
        await api.unlikePost(postId);
        setActionState((s) => s && { ...s, isLiked: false });
      } else {
        await api.likePost(postId);
        setActionState((s) => s && { ...s, isLiked: true });
      }
    } catch {}
  }

  async function toggleBookmark() {
    if (!actionState || !isLoggedIn) return;
    try {
      if (actionState.isBookmarked) {
        await api.unbookmarkPost(postId);
        setActionState((s) => s && { ...s, isBookmarked: false });
      } else {
        await api.bookmarkPost(postId);
        setActionState((s) => s && { ...s, isBookmarked: true });
      }
    } catch {}
  }

  if (isLoading || !post) {
    return (
      <View style={[styles.center, { height: screenH }]}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  // For videos: use safe-area-aware height so controls stay tappable
  // For images: use full screen height for max viewing area
  const isVideo = post.type === 1;
  const displayH = isVideo ? mediaH : screenH;

  const mediaUrl = getMediaUrl(post, "full");
  const thumbUrl = getMediaUrl(post, "thumb");

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
      style={{ width: screenW }}
      showsVerticalScrollIndicator={false}
      bounces={false}
      nestedScrollEnabled
    >
      {/* Full-screen media */}
      <View style={{ width: screenW, height: screenH, backgroundColor: "#000", paddingTop: isVideo ? topInset : 0 }}>
        {isVideo ? (
          Platform.OS === "web" ? (
            <video
              ref={(el: HTMLVideoElement | null) => { webVideoRef.current = el; }}
              src={mediaUrl}
              poster={thumbUrl}
              controls
              autoPlay={isActive}
              loop
              muted={isMuted}
              playsInline
              style={{
                width: screenW,
                height: displayH,
                objectFit: "contain",
                backgroundColor: "#000",
              }}
            />
          ) : (
            <Video
              ref={videoRef}
              source={{ uri: mediaUrl }}
              posterSource={{ uri: thumbUrl }}
              usePoster
              style={{ width: screenW, height: displayH }}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={isActive}
              isLooping
              useNativeControls
              isMuted={isMuted}
            />
          )
        ) : Platform.OS === "web" ? (
          <img
            src={mediaUrl}
            style={{
              width: screenW,
              height: screenH,
              objectFit: "contain",
              backgroundColor: "#000",
              display: "block",
            }}
          />
        ) : (
          <Image
            source={{ uri: mediaUrl }}
            style={{ width: screenW, height: screenH }}
            contentFit="contain"
            transition={200}
            placeholder={thumbUrl}
            cachePolicy="memory-disk"
          />
        )}

        {/* Scroll hint at bottom — positioned above video controls */}
        <View style={[styles.scrollHint, isVideo && { bottom: 60 }]}>
          <Ionicons name="chevron-up" size={20} color="rgba(255,255,255,0.6)" />
          <Text style={styles.scrollHintText}>Swipe up for details</Text>
        </View>
      </View>

      {/* Details below the fold */}
      <View style={styles.detailsContainer}>
        {/* Action bar */}
        <View style={styles.actionBar}>
          <ActionButton
            icon={actionState?.isLiked ? "heart" : "heart-outline"}
            color={actionState?.isLiked ? Colors.likeFilled : Colors.textSecondary}
            label={post.likes != null ? String(post.likes) : "Like"}
            onPress={toggleLike}
          />
          <ActionButton
            icon={actionState?.isBookmarked ? "bookmark" : "bookmark-outline"}
            color={actionState?.isBookmarked ? Colors.bookmarkFilled : Colors.textSecondary}
            label="Save"
            onPress={toggleBookmark}
          />
          <ActionButton
            icon="download-outline"
            color={Colors.textSecondary}
            label="Download"
            onPress={() => Linking.openURL(mediaUrl)}
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

        <View style={{ height: 80 }} />
      </View>
    </ScrollView>
  );
}

function ActionButton({
  icon,
  color,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.actionBtn} onPress={onPress}>
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
});
