import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Tabs, usePathname, useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getAvatarUrl } from "../../api/rule34vault";
import { Colors, Spacing } from "../../constants/theme";
import { useAuth } from "../../contexts/AuthContext";
import { useFeedCount } from "../../contexts/FeedCountContext";
import { useSettings } from "../../contexts/SettingsContext";
import { useAppTheme } from "../../contexts/ThemeContext";

function HeaderRight() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoggedIn } = useAuth();
  const { count: feedCount } = useFeedCount();
  const { colors } = useAppTheme();

  const isFeedActive = pathname === "/feed";
  const isProfileActive = pathname === "/profile";
  const avatarUrl = user ? getAvatarUrl(user.id, user.avatarModifyDate) : "";

  return (
    <View style={headerStyles.row}>
      <Pressable
        style={[headerStyles.iconBtn, isFeedActive && { backgroundColor: colors.bgTertiary }]}
        onPress={() => router.push("/feed")}
      >
        <Ionicons
          name={isFeedActive ? "notifications" : "notifications-outline"}
          size={22}
          color={isFeedActive ? colors.accent : colors.textSecondary}
        />
        {feedCount > 0 && (
          <View style={headerStyles.badge}>
            <Text style={headerStyles.badgeText}>
              {feedCount > 99 ? "99+" : feedCount}
            </Text>
          </View>
        )}
      </Pressable>

      <Pressable
        style={[headerStyles.avatarBtn, isProfileActive && { borderColor: colors.accent }]}
        onPress={() => router.push("/profile")}
      >
        {isLoggedIn && avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={headerStyles.avatar}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[headerStyles.avatarPlaceholder, { backgroundColor: colors.bgTertiary }]}>
            <Ionicons name="person" size={18} color={colors.textSecondary} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginRight: Spacing.md,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  badge: {
    position: "absolute",
    top: 0,
    left: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#ff3b30",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
  },
  avatarBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: "transparent",
    overflow: "hidden",
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  avatarPlaceholder: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.bgTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
});

export default function TabLayout() {
  const { colors } = useAppTheme();
  const { scrollMode } = useSettings();
  const pathname = usePathname();

  const isForYouActive = pathname === "/(tabs)/for-you";
  const isTiktokMode = scrollMode === "tiktok";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.bgSecondary,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 56,
          paddingBottom: 6,
          // Keep bottom nav visible in TikTok mode
        },
        tabBarItemStyle: {
          flex: 1,
        },
        headerStyle: { 
          backgroundColor: colors.bgSecondary,
          display: (isForYouActive && isTiktokMode) ? "none" : "flex",
        },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" },
        headerRight: () => (isForYouActive && isTiktokMode) ? null : <HeaderRight />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Browse",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarButton: () => null,
          tabBarItemStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="for-you"
        options={{
          title: "For You",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="heart-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="playlists"
        options={{
          title: "Playlists",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="comments"
        options={{
          title: "Comments",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarButton: () => null,
          tabBarItemStyle: { display: "none" },
        }}
      />
    </Tabs>
  );
}
