import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Platform,
  Linking,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import api, {
  UserProfile,
  Playlist,
  getAvatarUrl,
  getBannerUrl,
  getMediaUrl,
} from "../../api/rule34vault";
import { useAuth } from "../../contexts/AuthContext";
import { Colors, Radius, Spacing, FontSize } from "../../constants/theme";

function WebImg({ uri, style }: { uri: string; style: Record<string, unknown> }) {
  const [err, setErr] = useState(false);
  if (err) return null;
  if (Platform.OS === "web") {
    return <img src={uri} style={style as any} onError={() => setErr(true)} />;
  }
  return (
    <Image source={{ uri }} style={style as any} contentFit="cover" onError={() => setErr(true)} />
  );
}

function PlaylistCard({ playlist, onPress }: { playlist: Playlist; onPress: () => void }) {
  const thumbUri = playlist.lastPost ? getMediaUrl(playlist.lastPost, "thumb") : null;
  const { isLoggedIn } = useAuth();
  const [following, setFollowing] = useState<boolean | null>(null);

  useEffect(() => {
    if (isLoggedIn) {
      api.isFollowingPlaylist(playlist.id).then(setFollowing).catch(() => {});
    }
  }, [playlist.id, isLoggedIn]);

  const toggleFollow = async () => {
    if (!isLoggedIn || following === null) return;
    try {
      if (following) {
        await api.unfollowPlaylist(playlist.id);
        setFollowing(false);
      } else {
        await api.followPlaylist(playlist.id);
        setFollowing(true);
      }
    } catch {}
  };

  return (
    <View style={styles.playlistCard}>
      <Pressable style={styles.playlistRow} onPress={onPress}>
        {thumbUri ? (
          <WebImg uri={thumbUri} style={{ width: 64, height: 64, objectFit: "cover", display: "block", borderRadius: 8 }} />
        ) : (
          <View style={styles.playlistThumbPlaceholder}>
            <Ionicons name="musical-notes" size={20} color={Colors.textMuted} />
          </View>
        )}
        <View style={styles.playlistInfo}>
          <Text style={styles.playlistTitle} numberOfLines={1}>{playlist.title}</Text>
          <Text style={styles.playlistSub}>
            {playlist.items} items · {playlist.likes} likes · {playlist.followers} followers
          </Text>
        </View>
      </Pressable>
      {isLoggedIn && following !== null && (
        <Pressable
          style={[styles.followBtn, following && styles.followBtnActive]}
          onPress={toggleFollow}
        >
          <Ionicons
            name={following ? "checkmark" : "add"}
            size={14}
            color={following ? Colors.accent : "#fff"}
          />
          <Text style={[styles.followBtnText, following && { color: Colors.accent }]}>
            {following ? "Following" : "Follow"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export default function OtherUserProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [followedPlaylists, setFollowedPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadProfile = useCallback(async (showLoader = true) => {
    if (!username) return;
    if (showLoader) { setLoading(true); setError(null); }
    try {
      const user = await api.getUserProfile(username);
      setProfile(user);
      const [pl, fpl] = await Promise.all([
        api.getUserPlaylists(user.id, 50).catch(() => ({ items: [] })),
        api.getFollowedPlaylists(user.id, 50).catch(() => ({ items: [] })),
      ]);
      setPlaylists(pl.items || []);
      setFollowedPlaylists(fpl.items || []);
    } catch {
      setError("User not found");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    loadProfile(true);
  }, [username]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfile(false);
    setRefreshing(false);
  }, [loadProfile]);

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: username || "User" }} />
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "User" }} />
        <Ionicons name="person-circle-outline" size={64} color={Colors.textMuted} />
        <Text style={styles.errorText}>{error || "User not found"}</Text>
      </View>
    );
  }

  const stats = profile.data;
  const privacy = stats?.privacy;
  const avatarUrl = getAvatarUrl(profile.id, profile.avatarModifyDate ?? undefined, 256);
  const bannerUrl = getBannerUrl(profile.id, stats?.profileImageDate ?? undefined);

  const canShowBookmarks = privacy?.showBookmarks !== false;
  const canShowSuperLikes = privacy?.showSuperLikes !== false;

  const navToUserPosts = (type: string) => {
    router.push({
      pathname: "/user-posts",
      params: { type, userId: String(profile.id), userName: profile.userName },
    });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={Colors.accent}
          colors={[Colors.accent]}
          progressBackgroundColor={Colors.bgSecondary}
        />
      }
    >
      <Stack.Screen options={{ title: profile.displayName || username || "User" }} />

      {/* Banner */}
      <View style={styles.bannerWrap}>
        {bannerUrl ? (
          <WebImg uri={bannerUrl} style={{ width: "100%", height: 160, objectFit: "cover", display: "block", backgroundColor: Colors.bgTertiary }} />
        ) : (
          <View style={{ width: "100%", height: 160, backgroundColor: Colors.bgTertiary }} />
        )}
        <View style={styles.bannerGradient} />
      </View>

      {/* Profile header */}
      <View style={styles.profileHeader}>
        <View style={styles.avatarWrap}>
          <WebImg uri={avatarUrl} style={{ width: 88, height: 88, borderRadius: 44, objectFit: "cover", display: "block" }} />
        </View>
        <Text style={styles.displayName}>{profile.displayName || "User"}</Text>
        <Text style={styles.usernameText}>@{profile.userName}</Text>
        {stats?.description ? (
          <Text style={styles.bio}>{stats.description}</Text>
        ) : null}
        <Text style={styles.joined}>
          Joined {profile.created ? new Date(profile.created).toLocaleDateString() : "N/A"}
        </Text>
      </View>

      {/* Stats Row 1 — Likes, Bookmarks, Super Likes, Playlists */}
      <View style={styles.statsRow}>
        <StatItem
          icon="heart"
          value={stats?.likes ?? 0}
          label="Likes"
          onPress={() => navToUserPosts("liked")}
        />
        {canShowBookmarks ? (
          <StatItem
            icon="bookmark"
            value={stats?.bookmarks ?? 0}
            label="Bookmarks"
            onPress={() => navToUserPosts("bookmarked")}
          />
        ) : (
          <StatItem icon="lock-closed" value={0} label="Bookmarks" locked />
        )}
        {canShowSuperLikes ? (
          <StatItem icon="flame" value={stats?.superLikes ?? 0} label="Super" />
        ) : (
          <StatItem icon="lock-closed" value={0} label="Super" locked />
        )}
        <StatItem icon="list" value={stats?.playlists ?? 0} label="Playlists" />
      </View>

      {/* Stats Row 2 — Followers, Following, Uploads, Comments */}
      <View style={styles.statsRow}>
        <StatItem icon="people" value={stats?.followers ?? 0} label="Followers" />
        <StatItem icon="person-add" value={stats?.following ?? 0} label="Following" />
        <StatItem icon="cloud-upload" value={stats?.postsUploaded ?? 0} label="Uploads" />
        <StatItem icon="chatbubble" value={(stats?.postComments ?? 0) + (stats?.playlistComments ?? 0)} label="Comments" />
      </View>

      {/* Playlists */}
      {playlists.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Playlists ({playlists.length})</Text>
          {playlists.map((pl) => (
            <PlaylistCard
              key={pl.id}
              playlist={pl}
              onPress={() =>
                router.push({
                  pathname: "/playlist/[id]",
                  params: { id: String(pl.id), name: pl.title },
                })
              }
            />
          ))}
        </View>
      )}

      {/* Followed Playlists */}
      {followedPlaylists.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Followed Playlists ({followedPlaylists.length})</Text>
          {followedPlaylists.map((pl) => (
            <PlaylistCard
              key={pl.id}
              playlist={pl}
              onPress={() =>
                router.push({
                  pathname: "/playlist/[id]",
                  params: { id: String(pl.id), name: pl.title },
                })
              }
            />
          ))}
        </View>
      )}

      {/* Menu links */}
      <View style={styles.menuSection}>
        <MenuItem
          icon="globe-outline"
          label="View on Website"
          onPress={() => Linking.openURL(`https://rule34vault.com/u/${profile.userName}`)}
        />
      </View>

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

function StatItem({
  icon,
  value,
  label,
  onPress,
  locked,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  label: string;
  onPress?: () => void;
  locked?: boolean;
}) {
  const Wrapper = onPress && !locked ? Pressable : View;
  return (
    <Wrapper style={styles.statItem} onPress={onPress}>
      <Ionicons name={icon} size={16} color={locked ? Colors.textMuted : Colors.accent} />
      {locked ? (
        <Text style={[styles.statValue, { color: Colors.textMuted }]}>—</Text>
      ) : (
        <Text style={styles.statValue}>{value}</Text>
      )}
      <Text style={styles.statLabel}>{label}</Text>
      {onPress && !locked && (
        <Ionicons name="chevron-forward" size={10} color={Colors.textMuted} style={{ marginTop: 1 }} />
      )}
    </Wrapper>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.menuItem} onPress={onPress}>
      <Ionicons name={icon} size={20} color={Colors.textSecondary} />
      <Text style={styles.menuLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: Spacing.md, backgroundColor: Colors.bg },
  errorText: { fontSize: FontSize.md, color: Colors.textMuted, marginTop: Spacing.sm },
  bannerWrap: { width: "100%", height: 160, backgroundColor: Colors.bgTertiary, overflow: "hidden" },
  bannerGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 60, backgroundColor: "transparent" },
  profileHeader: { alignItems: "center", marginTop: -44, paddingBottom: Spacing.md, gap: Spacing.xs },
  avatarWrap: { width: 88, height: 88, borderRadius: 44, overflow: "hidden", backgroundColor: Colors.bgTertiary, borderWidth: 3, borderColor: Colors.bg },
  displayName: { fontSize: FontSize.xl, fontWeight: "800", color: Colors.text, marginTop: Spacing.sm },
  usernameText: { fontSize: FontSize.md, color: Colors.textSecondary },
  bio: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", paddingHorizontal: Spacing.xl, marginTop: Spacing.xs },
  joined: { fontSize: FontSize.sm, color: Colors.textMuted },
  statsRow: { flexDirection: "row", justifyContent: "space-evenly", paddingVertical: Spacing.md, marginHorizontal: Spacing.md, backgroundColor: Colors.bgCard, borderRadius: Radius.md, marginBottom: Spacing.sm },
  statItem: { alignItems: "center", gap: 2, minWidth: 60 },
  statValue: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.text },
  statLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  section: { marginTop: Spacing.md, marginHorizontal: Spacing.md },
  sectionTitle: { fontSize: FontSize.sm, fontWeight: "700", color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: Spacing.sm },
  playlistCard: { backgroundColor: Colors.bgCard, borderRadius: Radius.md, marginBottom: Spacing.sm, padding: Spacing.sm },
  playlistRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  playlistThumbPlaceholder: { width: 64, height: 64, borderRadius: Radius.md, backgroundColor: Colors.bgTertiary, justifyContent: "center", alignItems: "center" },
  playlistInfo: { flex: 1, gap: 2 },
  playlistTitle: { fontSize: FontSize.md, fontWeight: "700", color: Colors.text },
  playlistSub: { fontSize: FontSize.xs, color: Colors.textMuted },
  followBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: Spacing.xs, paddingVertical: 6, borderRadius: Radius.md, backgroundColor: Colors.accent },
  followBtnActive: { backgroundColor: "transparent", borderWidth: 1, borderColor: Colors.accent },
  followBtnText: { fontSize: FontSize.xs, fontWeight: "700", color: "#fff" },
  menuSection: { marginTop: Spacing.lg, marginHorizontal: Spacing.md, backgroundColor: Colors.bgCard, borderRadius: Radius.md, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", padding: Spacing.lg, gap: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  menuLabel: { flex: 1, fontSize: FontSize.md, color: Colors.text, fontWeight: "500" },
});
