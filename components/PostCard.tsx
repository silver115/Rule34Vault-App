import React, { memo, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Text,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import api, { Post, getMediaUrl, getMediaUrlDirect } from "../api/rule34vault";
import { useAuth } from "../contexts/AuthContext";
import { usePlaylist } from "../contexts/PlaylistContext";
import { Colors, Radius, Spacing, FontSize } from "../constants/theme";
import { useAppTheme } from "../contexts/ThemeContext";

const NUM_COLUMNS = 2;
const GAP = Spacing.sm;
const FIXED_ASPECT = 3 / 4;

interface PostCardProps {
  post: Post;
  index: number;
  onPress?: () => void;
  badgeText?: string;
}

function Thumbnail({ uri, fallbackUri, width, height }: { uri: string; fallbackUri?: string; width: number; height: number }) {
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

function PostCardInner({ post, index, onPress, badgeText }: PostCardProps) {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const { colors } = useAppTheme();
  const { playlists, activePlaylist, setActivePlaylist, addPostToActive, removePostFromActive } = usePlaylist();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.floor((screenWidth - GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS);
  const cardHeight = Math.floor(cardWidth / FIXED_ASPECT);
  const thumbUrl = getMediaUrl(post, "thumb");
  const thumbFallback = getMediaUrlDirect(post, "thumb");
  const isVideo = post.type === 1;

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
      <Thumbnail uri={thumbUrl} fallbackUri={thumbFallback} width={cardWidth} height={cardHeight} />
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
