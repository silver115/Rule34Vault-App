import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import api, { Post, Playlist as PlaylistType } from "../../api/rule34vault";
import { useAuth } from "../../contexts/AuthContext";
import { PostGrid } from "../../components/PostGrid";
import { Colors, Radius, Spacing, FontSize } from "../../constants/theme";

export default function PlaylistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const playlistId = Number(id);

  const [playlist, setPlaylist] = useState<PlaylistType | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isFollowing, setIsFollowing] = useState<boolean | null>(null);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);

  useEffect(() => {
    if (isLoggedIn && playlistId) {
      api.isFollowingPlaylist(playlistId)
        .then(setIsFollowing)
        .catch(() => setIsFollowing(false));
    }
  }, [playlistId, isLoggedIn]);

  const toggleFollow = async () => {
    console.log("toggleFollow called", { isLoggedIn, isFollowing, playlistId });
    if (!isLoggedIn || isFollowing === null) return;
    try {
      if (isFollowing) {
        await api.unfollowPlaylist(playlistId);
        console.log("unfollowed ok");
        setIsFollowing(false);
      } else {
        await api.followPlaylist(playlistId);
        console.log("followed ok");
        setIsFollowing(true);
      }
    } catch (e) {
      console.error("follow error:", e);
    }
  };

  useEffect(() => {
    loadPlaylist();
    loadPosts(true);
  }, [playlistId]);

  async function loadPlaylist() {
    try {
      const data = await api.getPlaylist(playlistId);
      setPlaylist(data);
      navigation.setOptions({ title: data.title });
    } catch (e) {
      console.error("Failed to load playlist:", e);
    }
  }

  const loadPosts = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setIsLoading(true);
        cursorRef.current = null;
        hasMoreRef.current = true;
      } else {
        if (!hasMoreRef.current || isLoadingMore) return;
        setIsLoadingMore(true);
      }

      try {
        const data = await api.searchPostsByPlaylist(
          playlistId,
          30,
          refresh ? null : cursorRef.current
        );
        if (refresh) {
          setPosts(data.items);
        } else {
          setPosts((prev) => [...prev, ...data.items]);
        }
        cursorRef.current = data.cursor;
        if (!data.items.length || !data.cursor) hasMoreRef.current = false;
      } catch (e) {
        console.error("Failed to load playlist posts:", e);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [playlistId, isLoadingMore]
  );

  const header = playlist ? (
    <View style={styles.header}>
      <Text style={styles.title}>{playlist.title}</Text>
      {playlist.description ? (
        <Text style={styles.desc}>{playlist.description}</Text>
      ) : null}
      <View style={styles.statsRow}>
        <StatBadge icon="images" value={playlist.items} />
        <StatBadge icon="heart" value={playlist.likes} />
        <StatBadge icon="eye" value={playlist.views} />
        <StatBadge icon="people" value={playlist.followers} />
      </View>
      <View style={styles.ownerRow}>
        <Text style={styles.owner}>by </Text>
        {playlist.user?.userName ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/user/[username]",
                params: { username: playlist.user!.userName },
              })
            }
          >
            <Text style={styles.ownerLink}>{playlist.user.displayName || playlist.user.userName}</Text>
          </Pressable>
        ) : (
          <Text style={styles.owner}>Unknown</Text>
        )}
        <Text style={styles.owner}>
          {" "}· updated {new Date(playlist.updated).toLocaleDateString()}
        </Text>
      </View>
      {isLoggedIn && isFollowing !== null && (
        <Pressable
          style={[styles.followBtn, isFollowing && styles.followBtnActive]}
          onPress={toggleFollow}
        >
          <Ionicons
            name={isFollowing ? "checkmark" : "add"}
            size={16}
            color={isFollowing ? Colors.accent : "#fff"}
          />
          <Text style={[styles.followBtnText, isFollowing && { color: Colors.accent }]}>
            {isFollowing ? "Following" : "Follow Playlist"}
          </Text>
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <PostGrid
        posts={posts}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        onRefresh={() => loadPosts(true)}
        onEndReached={() => loadPosts(false)}
        emptyText="This playlist is empty"
        ListHeaderComponent={header ?? undefined}
      />
    </View>
  );
}

function StatBadge({
  icon,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={14} color={Colors.accent} />
      <Text style={styles.statText}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    padding: Spacing.lg,
    backgroundColor: Colors.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: "800",
    color: Colors.text,
  },
  desc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  statsRow: {
    flexDirection: "row",
    gap: Spacing.lg,
    marginTop: Spacing.xs,
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statText: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  ownerRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 2,
  },
  owner: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  ownerLink: {
    fontSize: FontSize.xs,
    color: Colors.accent,
    fontWeight: "600",
  },
  followBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: Spacing.sm,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
  },
  followBtnActive: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  followBtnText: {
    fontSize: FontSize.sm,
    fontWeight: "700",
    color: "#fff",
  },
});
