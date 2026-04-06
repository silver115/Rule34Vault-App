import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { memo, useCallback, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import api, { Post } from "../api/rule34vault";
import { Colors, FontSize, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../contexts/AuthContext";
import { usePlaylist } from "../contexts/PlaylistContext";
import { useSettings } from "../contexts/SettingsContext";
import { useSite } from "../contexts/SiteContext";
import { useAppTheme } from "../contexts/ThemeContext";
import { downloadMedia } from "../utils/download";
import { getSiteMediaUrl } from "../utils/media";
import { sendRecSignal } from "../utils/recommendations";

const NUM_COLUMNS = 2;
const GAP = Spacing.sm;
const FIXED_ASPECT = 3 / 4;

// Track posts with broken/404 media so they can be hidden from grids
const brokenPostIds = new Set<number>();
let brokenListeners: (() => void)[] = [];

export function isBrokenPost(id: number): boolean {
  return brokenPostIds.has(id);
}

export function onBrokenPostsChange(listener: () => void) {
  brokenListeners.push(listener);
  return () => {
    brokenListeners = brokenListeners.filter((l) => l !== listener);
  };
}

export function markBroken(id: number) {
  if (brokenPostIds.has(id)) return;
  brokenPostIds.add(id);
  brokenListeners.forEach((l) => l());
}

interface PostCardProps {
  post: Post;
  index: number;
  onNavigate?: (post: Post, index: number) => void;
  badgeText?: string;
  onBroken?: (id: number) => void;
  actionState?: {
    isLiked: boolean;
    isBookmarked: boolean;
    isSuperLiked: boolean;
  };
  onActionChange?: (postId: number) => void;
}

function Thumbnail({
  uri,
  fallbackUri,
  width,
  height,
  onFinalError,
  priority = "normal",
}: {
  uri: string;
  fallbackUri?: string;
  width: number;
  height: number;
  onFinalError?: () => void;
  priority?: "high" | "normal" | "low";
}) {
  const [currentUri, setCurrentUri] = React.useState(uri);
  const [errored, setErrored] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const triedFallback = React.useRef(false);

  React.useEffect(() => {
    setCurrentUri(uri);
    setErrored(false);
    setLoading(true);
    triedFallback.current = false;
  }, [uri]);

  const handleError = () => {
    if (!triedFallback.current && fallbackUri) {
      triedFallback.current = true;
      setCurrentUri(fallbackUri);
    } else {
      setErrored(true);
      setLoading(false);
      onFinalError?.();
    }
  };

  if (errored) {
    return (
      <View
        style={[
          styles.thumbnailContainer,
          {
            width,
            height,
            backgroundColor: Colors.bgTertiary,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <Ionicons name="image-outline" size={32} color={Colors.textMuted} />
      </View>
    );
  }
  if (Platform.OS === "web") {
    return (
      <View
        style={[
          styles.thumbnailContainer,
          { width, height, backgroundColor: Colors.bgTertiary },
        ]}
      >
        {loading && (
          <View style={[styles.loadingOverlay, { width, height }]}>
            <ActivityIndicator size="small" color={Colors.accent} />
          </View>
        )}
        <img
          src={currentUri}
          style={{
            width,
            height,
            objectFit: "cover",
            display: "block",
            opacity: loading ? 0 : 1,
            transition: "opacity 0.2s",
          }}
          loading="lazy"
          onLoad={() => setLoading(false)}
          onError={handleError}
        />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.thumbnailContainer,
        { width, height, backgroundColor: Colors.bgTertiary },
      ]}
    >
      {loading && (
        <View style={[styles.loadingOverlay, { width, height }]}>
          <ActivityIndicator size="small" color={Colors.accent} />
        </View>
      )}
      <Image
        source={{ uri: currentUri }}
        style={[
          styles.thumbnailImage,
          { width, height, opacity: loading ? 0 : 1 },
        ]}
        contentFit="cover"
        transition={0}
        cachePolicy="memory-disk"
        priority={priority}
        onLoad={() => setLoading(false)}
        onError={handleError}
      />
    </View>
  );
}

function PostCardInner({
  post,
  index,
  onNavigate,
  badgeText,
  onBroken,
  actionState,
  onActionChange,
}: PostCardProps) {
  const router = useRouter();
  const { isLoggedIn, token } = useAuth();
  const { isE621 } = useSite();
  const { colors } = useAppTheme();
  const { qualityOption } = useSettings();
  const {
    playlists,
    activePlaylist,
    setActivePlaylist,
    addPostToActive,
    removePostFromActive,
  } = usePlaylist();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.floor(
    (screenWidth - GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS,
  );
  const cardHeight = Math.floor(cardWidth / FIXED_ASPECT);
  // For e621: use "sample" (850px pre-scaled) for grid cards instead of tiny "thumb" (150px)
  // or wastefully large "full" (multi-MB originals). R34V falls through to normal gridVariant.
  const gridVariant =
    isE621 && qualityOption.gridVariant === "thumb"
      ? "sample"
      : qualityOption.gridVariant;
  const thumbUrl = getSiteMediaUrl(post, gridVariant as any);
  const thumbFallback = getSiteMediaUrl(post, "thumb");
  const fullUrl = getSiteMediaUrl(post, "full");
  const isVideo = post.type === 1;
  const [downloading, setDownloading] = useState(false);

  // Use actionState prop if provided, otherwise use local state
  const liked = actionState?.isLiked ?? false;
  const bookmarked = actionState?.isBookmarked ?? false;
  const superLiked = actionState?.isSuperLiked ?? false;
  const [addedToPlaylist, setAddedToPlaylist] = useState(false);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);

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

  const handleLike = useCallback(async () => {
    if (!isLoggedIn) return;
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (liked) {
        await api.unlikePost(post.id);
      } else {
        await api.likePost(post.id);
        if (Platform.OS !== "web")
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (token && post.tags)
          sendRecSignal(token, post.id, "like", post.tags);
      }
      onActionChange?.(post.id);
    } catch {}
  }, [liked, post.id, isLoggedIn, token, onActionChange]);

  const handleSuperLike = useCallback(async () => {
    if (!isLoggedIn || superLiked) return;
    if (Platform.OS !== "web")
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await api.superLikePost(post.id);
      if (token && post.tags)
        sendRecSignal(token, post.id, "super_like", post.tags);
      onActionChange?.(post.id);
    } catch {}
  }, [isLoggedIn, superLiked, post.id, post.tags, token, onActionChange]);

  const handleBookmark = useCallback(async () => {
    if (!isLoggedIn) return;
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (bookmarked) {
        await api.unbookmarkPost(post.id);
      } else {
        await api.bookmarkPost(post.id);
        if (Platform.OS !== "web")
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (token && post.tags)
          sendRecSignal(token, post.id, "bookmark", post.tags);
      }
      onActionChange?.(post.id);
    } catch {}
  }, [bookmarked, post.id, isLoggedIn, token, onActionChange]);

  const handlePlaylistToggle = useCallback(async () => {
    if (!isLoggedIn) return;
    if (!activePlaylist) {
      setShowPlaylistPicker(true);
      return;
    }
    if (addedToPlaylist) {
      const ok = await removePostFromActive(post.id);
      if (ok) setAddedToPlaylist(false);
    } else {
      const ok = await addPostToActive(post.id);
      if (ok) setAddedToPlaylist(true);
    }
  }, [
    post.id,
    isLoggedIn,
    activePlaylist,
    addPostToActive,
    removePostFromActive,
    addedToPlaylist,
  ]);

  const pickPlaylist = useCallback(
    async (pl: any) => {
      setActivePlaylist(pl);
      setShowPlaylistPicker(false);
      try {
        await api.addToPlaylist(pl.id, post.id);
        setAddedToPlaylist(true);
      } catch {}
    },
    [post.id, setActivePlaylist],
  );

  const handleCardPress = useCallback(() => {
    if (onNavigate) {
      onNavigate(post, index);
    } else {
      router.push({ pathname: "/post/[id]", params: { id: String(post.id) } });
    }
  }, [onNavigate, post, index, router]);

  return (
    <Pressable
      onPress={handleCardPress}
      style={({ pressed }) => [
        styles.card,
        {
          width: cardWidth,
          height: cardHeight,
          backgroundColor: colors.bgCard,
        },
        {
          transform: [{ scale: pressed ? 0.97 : 1 }],
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <Thumbnail
        uri={thumbUrl}
        fallbackUri={thumbFallback}
        width={cardWidth}
        height={cardHeight}
        priority={index < 6 ? "high" : "normal"}
        onFinalError={() => {
          markBroken(post.id);
          onBroken?.(post.id);
        }}
      />
      {badgeText ? (
        <View style={styles.tagBadge}>
          <Text style={styles.tagBadgeText} numberOfLines={1}>
            {badgeText}
          </Text>
        </View>
      ) : null}
      {isVideo && (
        <View style={styles.videoBadge}>
          <Ionicons name="play-circle" size={20} color="#fff" />
          {post.duration ? (
            <Text style={styles.duration}>
              {Math.floor(post.duration / 60)}:
              {String(Math.floor(post.duration % 60)).padStart(2, "0")}
            </Text>
          ) : null}
        </View>
      )}
      {post.likes != null && post.likes > 0 && (
        <View style={styles.likesBadge}>
          <Ionicons name="heart" size={10} color={Colors.like} />
          <Text style={styles.likesText}>{post.likes}</Text>
        </View>
      )}
      {/* Quick action buttons */}
      {isLoggedIn && (
        <View style={styles.quickActions}>
          <Pressable
            style={({ pressed }) => [
              styles.quickBtn,
              pressed && { opacity: 0.7, transform: [{ scale: 0.85 }] },
            ]}
            onPress={handleLike}
            onLongPress={handleSuperLike}
            delayLongPress={400}
            hitSlop={6}
          >
            <Ionicons
              name={
                superLiked ? "heart-circle" : liked ? "heart" : "heart-outline"
              }
              size={18}
              color={superLiked ? "#FFD700" : liked ? "#ff4466" : "#fff"}
            />
          </Pressable>
          {!isE621 && (
            <Pressable
              style={({ pressed }) => [
                styles.quickBtn,
                pressed && { opacity: 0.7, transform: [{ scale: 0.85 }] },
              ]}
              onPress={handleBookmark}
              hitSlop={6}
            >
              <Ionicons
                name={bookmarked ? "bookmark" : "bookmark-outline"}
                size={18}
                color={bookmarked ? "#ffaa00" : "#fff"}
              />
            </Pressable>
          )}
          {playlists.length > 0 && (
            <Pressable style={styles.quickBtn} onPress={handlePlaylistToggle}>
              <Ionicons
                name={
                  addedToPlaylist ? "checkmark-circle" : "add-circle-outline"
                }
                size={18}
                color={addedToPlaylist ? "#44dd66" : "#fff"}
              />
            </Pressable>
          )}
          <Pressable style={styles.quickBtn} onPress={handleDownload}>
            {downloading ? (
              <ActivityIndicator size={16} color="#fff" />
            ) : (
              <Ionicons name="download-outline" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      )}
      {/* Inline playlist picker */}
      {showPlaylistPicker && (
        <View style={styles.playlistPicker}>
          <Text style={styles.pickerTitle}>Add to playlist:</Text>
          {playlists.map((pl) => (
            <Pressable
              key={pl.id}
              style={styles.pickerItem}
              onPress={() => pickPlaylist(pl)}
            >
              <Ionicons name="list-outline" size={14} color="#fff" />
              <Text style={styles.pickerText} numberOfLines={1}>
                {pl.title}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={styles.pickerItem}
            onPress={() => setShowPlaylistPicker(false)}
          >
            <Ionicons name="close" size={14} color={Colors.textMuted} />
            <Text style={[styles.pickerText, { color: Colors.textMuted }]}>
              Cancel
            </Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

export const PostCard = memo(PostCardInner);

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.md,
    overflow: "hidden",
    backgroundColor: Colors.bgCard,
    margin: GAP / 2,
  },
  thumbnailContainer: {
    position: "relative",
    overflow: "hidden",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
    backgroundColor: Colors.bgTertiary,
  },
  thumbnailImage: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  videoBadge: {
    position: "absolute",
    top: Spacing.xs,
    right: Spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    gap: 3,
  },
  duration: {
    color: "#fff",
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
  tagBadge: {
    position: "absolute",
    top: Spacing.xs,
    left: Spacing.xs,
    backgroundColor: "rgba(30,30,40,0.75)",
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    maxWidth: "70%",
  },
  tagBadgeText: {
    color: "rgba(232,232,240,0.85)",
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
  likesBadge: {
    position: "absolute",
    bottom: Spacing.xs,
    left: Spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    gap: 3,
  },
  likesText: {
    color: Colors.like,
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
  quickActions: {
    position: "absolute",
    bottom: Spacing.xs,
    right: Spacing.xs,
    flexDirection: "column",
    gap: 4,
  },
  quickBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  playlistPicker: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    padding: Spacing.sm,
    gap: 4,
  },
  pickerTitle: {
    color: "#fff",
    fontSize: FontSize.xs,
    fontWeight: "700",
    marginBottom: 2,
    textAlign: "center",
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  pickerText: {
    color: "#fff",
    fontSize: FontSize.xs,
    flex: 1,
  },
});

export { GAP, NUM_COLUMNS };
