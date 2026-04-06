import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    Linking,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import api, { getAvatarUrl, getBannerUrl, Tag } from "../../api/rule34vault";
import { Colors, FontSize, Radius, Spacing } from "../../constants/theme";
import { useAuth } from "../../contexts/AuthContext";
import { usePlaylist } from "../../contexts/PlaylistContext";
import { useSite } from "../../contexts/SiteContext";
import { useAppTheme } from "../../contexts/ThemeContext";

function WebImg({
  uri,
  style,
}: {
  uri: string;
  style: Record<string, unknown>;
}) {
  const [err, setErr] = useState(false);
  if (err) return null;
  if (Platform.OS === "web") {
    return <img src={uri} style={style as any} onError={() => setErr(true)} />;
  }
  return (
    <Image
      source={{ uri }}
      style={style as any}
      contentFit="cover"
      onError={() => setErr(true)}
    />
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isLoggedIn, isLoading: authLoading, logout } = useAuth();
  const { isE621 } = useSite();
  const { colors } = useAppTheme();
  const { playlists, activePlaylist, setActivePlaylist, refreshPlaylists } =
    usePlaylist();
  const [blacklist, setBlacklist] = useState<{
    tags: Tag[];
    isActive: boolean;
  } | null>(null);
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadProfileData = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const [bl] = await Promise.all([
        api.getTagBlacklist().catch(() => null),
        refreshPlaylists(),
      ]);
      if (bl) setBlacklist(bl);
    } catch (e) {
      console.warn("[Profile] loadProfileData error:", e);
    }
  }, [isLoggedIn, refreshPlaylists]);

  useEffect(() => {
    loadProfileData();
  }, [isLoggedIn]);

  // Refresh stats whenever the tab gains focus (keeps counts up to date after liking/bookmarking)
  useFocusEffect(
    useCallback(() => {
      loadProfileData();
    }, [loadProfileData]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfileData();
    setRefreshing(false);
  }, [loadProfileData]);

  if (authLoading) {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          { backgroundColor: colors.bg },
        ]}
      >
        <Ionicons
          name="person-circle-outline"
          size={64}
          color={colors.textMuted}
        />
      </View>
    );
  }

  if (!isLoggedIn || !user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.center}>
          <Ionicons
            name="person-circle-outline"
            size={80}
            color={colors.textMuted}
          />
          <Text style={[styles.notLoggedTitle, { color: colors.text }]}>
            Not signed in
          </Text>
          <Text style={[styles.notLoggedSub, { color: colors.textSecondary }]}>
            Sign in to like, bookmark, and manage playlists
          </Text>
          <Pressable
            style={[styles.loginBtn, { backgroundColor: colors.accent }]}
            onPress={() => router.push("/login")}
          >
            <Ionicons name="log-in-outline" size={20} color="#fff" />
            <Text style={styles.loginBtnText}>Sign In</Text>
          </Pressable>
          <Pressable
            style={[styles.settingsBtn, { borderColor: colors.border }]}
            onPress={() => router.push("/settings")}
          >
            <Ionicons
              name="settings-outline"
              size={16}
              color={colors.textSecondary}
            />
            <Text
              style={[styles.settingsBtnText, { color: colors.textSecondary }]}
            >
              Settings
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const stats = user.data;
  // e621 users don't have R34V CDN avatars/banners — skip those URL lookups
  const avatarUrl = isE621
    ? user.avatarModifyDate || null
    : getAvatarUrl(user.id, user.avatarModifyDate ?? undefined, 256);
  const bannerUrl = isE621
    ? null
    : getBannerUrl(user.id, stats?.profileImageDate ?? undefined);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.bgSecondary}
        />
      }
    >
      {/* Banner */}
      <View style={[styles.bannerWrap, { backgroundColor: colors.bgTertiary }]}>
        {bannerUrl ? (
          <WebImg
            uri={bannerUrl}
            style={{
              width: "100%",
              height: 160,
              objectFit: "cover",
              display: "block",
              backgroundColor: colors.bgTertiary,
            }}
          />
        ) : (
          <View
            style={{
              width: "100%",
              height: 160,
              backgroundColor: colors.bgTertiary,
            }}
          />
        )}
        <View style={styles.bannerGradient} />
      </View>

      {/* Profile header */}
      <View style={styles.profileHeader}>
        <View
          style={[
            styles.avatarWrap,
            { backgroundColor: colors.bgTertiary, borderColor: colors.bg },
          ]}
        >
          {avatarUrl ? (
            <WebImg
              uri={avatarUrl}
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <Ionicons name="person" size={48} color={colors.textMuted} />
          )}
        </View>
        <Text style={[styles.displayName, { color: colors.text }]}>
          {user.displayName ?? "User"}
        </Text>
        <Text style={[styles.username, { color: colors.textSecondary }]}>
          @{user.userName ?? "unknown"}
        </Text>
        {stats?.description ? (
          <Text style={[styles.bio, { color: colors.textSecondary }]}>
            {stats.description}
          </Text>
        ) : null}
        <Text style={[styles.joined, { color: colors.textMuted }]}>
          Joined{" "}
          {user.created ? new Date(user.created).toLocaleDateString() : "N/A"}
        </Text>
      </View>

      {/* Stats */}
      {isE621 ? (
        <View style={[styles.statsRow, { backgroundColor: colors.bgCard }]}>
          <StatItem
            icon="heart"
            value={stats?.likes ?? 0}
            label="Favorites"
            onPress={() =>
              router.push({
                pathname: "/user-posts",
                params: { type: "liked" },
              })
            }
          />
          <StatItem
            icon="cloud-upload"
            value={stats?.postsUploaded ?? 0}
            label="Uploads"
          />
        </View>
      ) : (
        <>
          <View style={[styles.statsRow, { backgroundColor: colors.bgCard }]}>
            <StatItem
              icon="heart"
              value={stats?.likes ?? 0}
              label="Likes"
              onPress={() =>
                router.push({
                  pathname: "/user-posts",
                  params: { type: "liked" },
                })
              }
            />
            <StatItem
              icon="bookmark"
              value={stats?.bookmarks ?? 0}
              label="Bookmarks"
              onPress={() =>
                router.push({
                  pathname: "/user-posts",
                  params: { type: "bookmarked" },
                })
              }
            />
            <StatItem
              icon="flame"
              value={stats?.superLikes ?? 0}
              label="Super"
              onPress={() =>
                router.push({
                  pathname: "/user-posts",
                  params: { type: "super-liked" },
                })
              }
            />
            <StatItem
              icon="list"
              value={stats?.playlists ?? 0}
              label="Playlists"
              onPress={() => router.push({ pathname: "/user-playlists" })}
            />
          </View>

          <View style={[styles.statsRow, { backgroundColor: colors.bgCard }]}>
            <StatItem
              icon="people"
              value={stats?.followers ?? 0}
              label="Followers"
            />
            <StatItem
              icon="person-add"
              value={stats?.following ?? 0}
              label="Following"
            />
            <StatItem
              icon="albums"
              value={stats?.followingPlaylists ?? 0}
              label="Followed PL"
              onPress={() => router.push({ pathname: "/followed-playlists" })}
            />
          </View>
        </>
      )}

      {/* Active Playlist — R34V only */}
      {!isE621 && (
        <View style={[styles.section, { backgroundColor: colors.bgCard }]}>
          <MenuItem
            icon="musical-notes-outline"
            label="Active Playlist"
            subtitle={
              activePlaylist
                ? activePlaylist.title
                : "None selected — tap to choose"
            }
            onPress={() => setShowPlaylistPicker(!showPlaylistPicker)}
          />
        </View>
      )}

      {!isE621 && showPlaylistPicker && (
        <View
          style={[styles.blacklistPanel, { backgroundColor: colors.bgCard }]}
        >
          <Text
            style={[styles.blacklistTitle, { color: colors.textSecondary }]}
          >
            Your Playlists ({playlists.length})
          </Text>
          {playlists.length === 0 ? (
            <Text style={[styles.blacklistEmpty, { color: colors.textMuted }]}>
              No playlists found. Create one on rule34vault.com
            </Text>
          ) : (
            <View style={{ gap: 4 }}>
              {activePlaylist && (
                <Pressable
                  style={[styles.playlistItem, styles.playlistItemActive]}
                  onPress={() => {
                    setActivePlaylist(null);
                    setShowPlaylistPicker(false);
                  }}
                >
                  <Ionicons
                    name="close-circle"
                    size={16}
                    color={Colors.textMuted}
                  />
                  <Text style={styles.playlistItemText}>Clear selection</Text>
                </Pressable>
              )}
              {playlists.map((pl) => {
                const isActive = activePlaylist?.id === pl.id;
                return (
                  <Pressable
                    key={pl.id}
                    style={[
                      styles.playlistItem,
                      isActive && styles.playlistItemActive,
                    ]}
                    onPress={() => {
                      setActivePlaylist(pl);
                      setShowPlaylistPicker(false);
                    }}
                  >
                    <Ionicons
                      name={isActive ? "checkmark-circle" : "list-outline"}
                      size={16}
                      color={isActive ? Colors.accent : Colors.textSecondary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.playlistItemText,
                          isActive && { color: Colors.accent },
                        ]}
                      >
                        {pl.title}
                      </Text>
                      <Text style={styles.playlistItemSub}>
                        {pl.items} items · {pl.likes} likes
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* Menu */}
      <View style={[styles.section, { backgroundColor: colors.bgCard }]}>
        {!isE621 && (
          <MenuItem
            icon="albums-outline"
            label="Followed Playlists"
            subtitle={`${stats?.followingPlaylists ?? 0} playlists`}
            onPress={() => router.push({ pathname: "/followed-playlists" })}
          />
        )}
        <MenuItem
          icon="globe-outline"
          label="View on Website"
          onPress={() =>
            Linking.openURL(
              isE621
                ? `https://e621.net/users/${user.userName}`
                : `https://rule34vault.com/u/${user.userName}`,
            )
          }
        />
        <MenuItem
          icon="eye-off-outline"
          label="Tag Blacklist"
          subtitle={
            blacklist
              ? `${blacklist.tags.length} tags · ${blacklist.isActive ? "Active" : "Inactive"}`
              : undefined
          }
          onPress={() => setShowBlacklist(!showBlacklist)}
        />
        <MenuItem
          icon="settings-outline"
          label="Settings"
          subtitle="Notifications, sign out"
          onPress={() => router.push("/settings")}
        />
      </View>

      {/* Blacklist panel */}
      {showBlacklist && blacklist && (
        <View
          style={[styles.blacklistPanel, { backgroundColor: colors.bgCard }]}
        >
          <Text
            style={[styles.blacklistTitle, { color: colors.textSecondary }]}
          >
            Blacklisted Tags ({blacklist.tags.length})
          </Text>
          {blacklist.tags.length === 0 ? (
            <Text style={[styles.blacklistEmpty, { color: colors.textMuted }]}>
              No blacklisted tags
            </Text>
          ) : (
            <View style={styles.blacklistTags}>
              {blacklist.tags.map((tag) => (
                <View key={tag.id} style={styles.blacklistChip}>
                  <Text style={styles.blacklistChipText}>{tag.value}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

function StatItem({
  icon,
  value,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  label: string;
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper style={styles.statItem} onPress={onPress}>
      <Ionicons name={icon} size={16} color={colors.accent} />
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>
        {label}
      </Text>
    </Wrapper>
  );
}

function MenuItem({
  icon,
  label,
  subtitle,
  danger,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      style={[styles.menuItem, { borderBottomColor: colors.border }]}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={20}
        color={danger ? colors.danger : colors.textSecondary}
      />
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.menuLabel,
            { color: colors.text },
            danger && { color: colors.danger },
          ]}
        >
          {label}
        </Text>
        {subtitle ? (
          <Text style={[styles.menuSub, { color: colors.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  scroll: {
    paddingBottom: 100,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  notLoggedTitle: {
    fontSize: FontSize.xl,
    fontWeight: "700",
    color: Colors.text,
    marginTop: Spacing.md,
  },
  notLoggedSub: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  loginBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    marginTop: Spacing.md,
  },
  loginBtnText: {
    color: "#fff",
    fontSize: FontSize.lg,
    fontWeight: "700",
  },
  settingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  settingsBtnText: {
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  bannerWrap: {
    width: "100%",
    height: 160,
    backgroundColor: Colors.bgTertiary,
    overflow: "hidden",
  },
  bannerGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: "transparent",
  },
  profileHeader: {
    alignItems: "center",
    marginTop: -44,
    paddingBottom: Spacing.md,
    gap: Spacing.xs,
  },
  avatarWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: "hidden",
    backgroundColor: Colors.bgTertiary,
    borderWidth: 3,
    borderColor: Colors.bg,
  },
  displayName: {
    fontSize: FontSize.xl,
    fontWeight: "800",
    color: Colors.text,
    marginTop: Spacing.sm,
  },
  username: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  bio: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.xs,
  },
  joined: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    paddingVertical: Spacing.md,
    marginHorizontal: Spacing.md,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
  },
  statItem: {
    alignItems: "center",
    gap: 2,
    minWidth: 60,
  },
  statValue: {
    fontSize: FontSize.lg,
    fontWeight: "700",
    color: Colors.text,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  section: {
    marginTop: Spacing.lg,
    marginHorizontal: Spacing.md,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  menuLabel: {
    fontSize: FontSize.md,
    color: Colors.text,
    fontWeight: "500",
  },
  menuSub: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  blacklistPanel: {
    marginTop: Spacing.md,
    marginHorizontal: Spacing.md,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  blacklistTitle: {
    fontSize: FontSize.sm,
    fontWeight: "700",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  blacklistEmpty: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: "center",
    paddingVertical: Spacing.md,
  },
  blacklistTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  blacklistChip: {
    backgroundColor: Colors.danger + "22",
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.danger + "44",
  },
  blacklistChipText: {
    fontSize: FontSize.xs,
    color: Colors.danger,
    fontWeight: "500",
  },
  playlistItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgTertiary,
  },
  playlistItemActive: {
    backgroundColor: Colors.accent + "18",
    borderWidth: 1,
    borderColor: Colors.accent + "44",
  },
  playlistItemText: {
    fontSize: FontSize.sm,
    color: Colors.text,
    fontWeight: "500",
  },
  playlistItemSub: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  sectionHeaderText: {
    fontSize: FontSize.sm,
    fontWeight: "700",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
