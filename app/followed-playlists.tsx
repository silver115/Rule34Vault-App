import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, Stack } from "expo-router";
import { useAuth } from "../contexts/AuthContext";
import api, { Playlist, getMediaUrl } from "../api/rule34vault";
import { Colors, Radius, Spacing, FontSize } from "../constants/theme";

function PlaylistThumb({ playlist }: { playlist: Playlist }) {
  if (!playlist.lastPost) {
    return (
      <View style={styles.thumbPlaceholder}>
        <Ionicons name="musical-notes" size={24} color={Colors.textMuted} />
      </View>
    );
  }
  const uri = getMediaUrl(playlist.lastPost, "thumb");
  if (Platform.OS === "web") {
    return (
      <img
        src={uri}
        style={{ width: 80, height: 80, objectFit: "cover", display: "block", borderRadius: 8 }}
      />
    );
  }
  return <Image source={{ uri }} style={styles.thumb} contentFit="cover" />;
}

export default function FollowedPlaylistsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setIsLoading(true);
    api.getFollowedPlaylists(user.id, 50)
      .then((resp) => setPlaylists(resp.items))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [user?.id]);

  const handleUnfollow = async (playlistId: number) => {
    try {
      await api.unfollowPlaylist(playlistId);
      setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
    } catch {}
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Followed Playlists" }} />
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Followed Playlists" }} />
      {playlists.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="albums-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyText}>No followed playlists yet</Text>
        </View>
      ) : (
        <FlatList
          data={playlists}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.rowContent}
                onPress={() =>
                  router.push({
                    pathname: "/playlist/[id]",
                    params: { id: String(item.id), name: item.title },
                  })
                }
              >
                <PlaylistThumb playlist={item} />
                <View style={styles.info}>
                  <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                  {item.user && (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/user/[username]",
                          params: { username: item.user!.userName },
                        })
                      }
                    >
                      <Text style={styles.owner}>by @{item.user.userName}</Text>
                    </Pressable>
                  )}
                  <Text style={styles.sub}>
                    {item.items} items · {item.likes} likes · {item.followers} followers
                  </Text>
                </View>
              </Pressable>
              <Pressable style={styles.unfollowBtn} onPress={() => handleUnfollow(item.id)}>
                <Ionicons name="close-circle-outline" size={20} color={Colors.danger} />
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: Spacing.md, backgroundColor: Colors.bg },
  emptyText: { fontSize: FontSize.md, color: Colors.textMuted },
  list: { padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.bgCard, borderRadius: Radius.md, padding: Spacing.sm },
  rowContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.md },
  thumb: { width: 80, height: 80, borderRadius: Radius.md },
  thumbPlaceholder: { width: 80, height: 80, borderRadius: Radius.md, backgroundColor: Colors.bgTertiary, justifyContent: "center", alignItems: "center" },
  info: { flex: 1, gap: 2 },
  title: { fontSize: FontSize.md, fontWeight: "700", color: Colors.text },
  owner: { fontSize: FontSize.xs, color: Colors.accent },
  sub: { fontSize: FontSize.xs, color: Colors.textMuted },
  unfollowBtn: { padding: Spacing.sm },
});
