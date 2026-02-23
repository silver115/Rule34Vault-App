import React, { memo, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Text,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
} from "react-native";
import { File as ExpoFile, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import api, { Post, getMediaUrl, getMediaUrlDirect } from "../api/rule34vault";
import { useAuth } from "../contexts/AuthContext";
import { usePlaylist } from "../contexts/PlaylistContext";
import { Colors, Radius, Spacing, FontSize } from "../constants/theme";
import { useAppTheme } from "../contexts/ThemeContext";
import { useSettings } from "../contexts/SettingsContext";

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
  return () => { brokenListeners = brokenListeners.filter((l) => l !== listener); };
}

function markBroken(id: number) {
  if (brokenPostIds.has(id)) return;
  brokenPostIds.add(id);
  brokenListeners.forEach((l) => l());
}

interface PostCardProps {
  post: Post;
  index: number;
  onPress?: () => void;
  badgeText?: string;
  onBroken?: (id: number) => void;
}

function Thumbnail({ uri, fallbackUri, width, height, onFinalError }: { uri: string; fallbackUri?: string; width: number; height: number; onFinalError?: () => void }) {
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
      <View style={{ width, height, backgroundColor: Colors.bgTertiary, justifyContent: "center", alignItems: "center" }}>
        <Ionicons name="image-outline" size={32} color={Colors.textMuted} />
      </View>
    );
  }
  if (Platform.OS === "web") {
    return (
      <View style={{ width, height, backgroundColor: Colors.bgTertiary }}>
        {loading && (
          <View style={{ position: "absolute", top: 0, left: 0, width, height, justifyContent: "center", alignItems: "center", zIndex: 1 }}>
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
          }}
          loading="lazy"
          onLoad={() => setLoading(false)}
          onError={handleError}
        />
      </View>
    );
  }
  return (
    <View style={{ width, height, backgroundColor: Colors.bgTertiary }}>
      {loading && (
        <View style={{ position: "absolute", top: 0, left: 0, width, height, justifyContent: "center", alignItems: "center", zIndex: 1 }}>
          <ActivityIndicator size="small" color={Colors.accent} />
        </View>
      )}
      <Image
        source={{ uri: currentUri }}
        style={{ width, height }}
        contentFit="cover"
        transition={200}
        cachePolicy="memory-disk"
        priority="high"
        onLoad={() => setLoading(false)}
        onError={handleError}
      />
    </View>
  );
}

function PostCardInner({ post, index, onPress, badgeText, onBroken }: PostCardProps) {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const { colors } = useAppTheme();
  const { qualityOption } = useSettings();
  const { playlists, activePlaylist, setActivePlaylist, addPostToActive, removePostFromActive } = usePlaylist();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.floor((screenWidth - GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS);
  const cardHeight = Math.floor(cardWidth / FIXED_ASPECT);
  const thumbUrl = getMediaUrl(post, qualityOption.gridVariant);
  const thumbFallback = getMediaUrlDirect(post, "thumb");
  const fullUrl = getMediaUrl(post, "full");
  const isVideo = post.type === 1;
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const ext = isVideo ? "mp4" : "jpg";
      const fileName = `${post.id}.${ext}`;

      if (Platform.OS === "web") {
        const resp = await fetch(fullUrl);
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Storage permission is required to save files.");
          setDownloading(false);
          return;
        }
        // Download to cache using expo-file-system v19 API
        const tempFile = new ExpoFile(Paths.cache, fileName);
        const response = await fetch(fullUrl);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        tempFile.write(new Uint8Array(buffer));
        // Save to media library under Rule34Vault album
        const asset = await MediaLibrary.createAssetAsync(tempFile.uri);
        let album = await MediaLibrary.getAlbumAsync("Rule34Vault");
        if (album) {
          await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
        } else {
          await MediaLibrary.createAlbumAsync("Rule34Vault", asset, false);
        }
        // Clean up temp file
        try { tempFile.delete(); } catch {}
        Alert.alert("Downloaded", `Saved to Rule34Vault/${fileName}`);
      }
    } catch (e: any) {
      if (Platform.OS === "web") {
        console.error("Download failed:", e);
      } else {
        Alert.alert("Download failed", e?.message || "An error occurred.");
      }
    } finally {
      setDownloading(false);
    }
  }, [fullUrl, post.id, isVideo, downloading]);

  const [liked, setLiked] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [addedToPlaylist, setAddedToPlaylist] = useState(false);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);

  // Disabled: fetch action state individually per card causes too many renders
  // TODO: replace with batch fetch at grid level
  // React.useEffect(() => { ... }, [post.id, isLoggedIn]);

  const handleLike = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      if (liked) {
        await api.unlikePost(post.id);
        setLiked(false);
      } else {
        await api.likePost(post.id);
        setLiked(true);
      }
    } catch {}
  }, [liked, post.id, isLoggedIn]);

  const handleBookmark = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      if (bookmarked) {
        await api.unbookmarkPost(post.id);
        setBookmarked(false);
      } else {
        await api.bookmarkPost(post.id);
        setBookmarked(true);
      }
    } catch {}
  }, [bookmarked, post.id, isLoggedIn]);

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
  }, [post.id, isLoggedIn, activePlaylist, addPostToActive, removePostFromActive, addedToPlaylist]);

  const pickPlaylist = useCallback(async (pl: any) => {
    setActivePlaylist(pl);
    setShowPlaylistPicker(false);
    try {
      await api.addToPlaylist(pl.id, post.id);
      setAddedToPlaylist(true);
    } catch {}
  }, [post.id, setActivePlaylist]);

  return (
    <Pressable
      onPress={() => {
        onPress?.();
        router.push({
          pathname: "/post/[id]",
          params: { id: String(post.id) },
        });
      }}
      style={[styles.card, { width: cardWidth, height: cardHeight, backgroundColor: colors.bgCard }]}
    >
      <Thumbnail
        uri={thumbUrl}
        fallbackUri={thumbFallback}
        width={cardWidth}
        height={cardHeight}
        onFinalError={() => { markBroken(post.id); onBroken?.(post.id); }}
      />
      {badgeText ? (
        <View style={styles.tagBadge}>
          <Text style={styles.tagBadgeText} numberOfLines={1}>{badgeText}</Text>
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
          <Pressable style={styles.quickBtn} onPress={handleLike}>
            <Ionicons
              name={liked ? "heart" : "heart-outline"}
              size={18}
              color={liked ? "#ff4466" : "#fff"}
            />
          </Pressable>
          <Pressable style={styles.quickBtn} onPress={handleBookmark}>
            <Ionicons
              name={bookmarked ? "bookmark" : "bookmark-outline"}
              size={18}
              color={bookmarked ? "#ffaa00" : "#fff"}
            />
          </Pressable>
          {playlists.length > 0 && (
            <Pressable style={styles.quickBtn} onPress={handlePlaylistToggle}>
              <Ionicons
                name={addedToPlaylist ? "checkmark-circle" : "add-circle-outline"}
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
              <Text style={styles.pickerText} numberOfLines={1}>{pl.title}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.pickerItem} onPress={() => setShowPlaylistPicker(false)}>
            <Ionicons name="close" size={14} color={Colors.textMuted} />
            <Text style={[styles.pickerText, { color: Colors.textMuted }]}>Cancel</Text>
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

export { NUM_COLUMNS, GAP };
