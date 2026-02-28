import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import api, { Post } from "../../api/rule34vault";
import { PostGrid } from "../../components/PostGrid";
import { FontSize, Radius, Spacing } from "../../constants/theme";
import { useAuth } from "../../contexts/AuthContext";
import { useAppTheme } from "../../contexts/ThemeContext";
import {
    fetchRecommendations,
    hasRecServer,
    resetRecProfile
} from "../../utils/recommendations";

const PAGE_SIZE = 30;

export default function ForYouScreen() {
  const { isLoggedIn, user, token } = useAuth();
  const { colors } = useAppTheme();
  const router = useRouter();
  const navigation = useNavigation();

  const usingServer = hasRecServer();

  const [posts, setPosts] = useState<Post[]>([]);
  const [topTags, setTopTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const cursorRef  = useRef<string | null>(null);
  const seenIdsRef = useRef<Set<number>>(new Set());
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);

  // Reset button in header (server mode only)
  useEffect(() => {
    if (!usingServer || !isLoggedIn) return;
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          style={{ marginRight: Spacing.md }}
          onPress={() => {
            Alert.alert(
              "Reset Feed",
              "Clear your seen history so you get fresh recommendations?",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Reset",
                  style: "destructive",
                  onPress: async () => {
                    if (token) await resetRecProfile(token);
                    load(true);
                  },
                },
              ]
            );
          }}
        >
          <Ionicons name="refresh-circle-outline" size={24} color={colors.textSecondary} />
        </Pressable>
      ),
    });
  }, [usingServer, isLoggedIn, token, colors]);

  const load = useCallback(
    async (refresh = false) => {
      if (!isLoggedIn || !user || !token) return;
      if (loadingRef.current) return;
      if (!refresh && !hasMoreRef.current) return;

      loadingRef.current = true;

      if (refresh) {
        setIsLoading(true);
        cursorRef.current = null;
        seenIdsRef.current = new Set();
        hasMoreRef.current = true;
      } else {
        setIsLoadingMore(true);
      }

      try {
        let items: Post[] = [];
        let tags: string[] = [];

        if (usingServer) {
          // Rec server is active — only show algorithm posts, no random fallback
          const serverResult = await fetchRecommendations(token, PAGE_SIZE);
          if (serverResult) {
            items = serverResult.posts;
            tags  = serverResult.topTags;
          }
        } else {
          // No rec server — use client-side algorithm
          const result = await api.searchForYouPosts(
            user.id,
            PAGE_SIZE,
            cursorRef.current,
            seenIdsRef.current
          );
          items = result.items;
          tags  = result.topTags;
        }

        items.forEach((p) => seenIdsRef.current.add(p.id));
        // Server always has more unseen content; client-side stops when results thin out
        hasMoreRef.current = usingServer ? items.length > 0 : items.length >= Math.floor(PAGE_SIZE * 0.5);

        if (refresh) {
          setPosts(items);
          setTopTags(tags);
        } else {
          setPosts((prev) => [...prev, ...items]);
          if (tags.length > 0) setTopTags(tags);
        }
      } catch (e) {
        console.warn("[ForYou] Load error:", e);
        hasMoreRef.current = false;
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
        loadingRef.current = false;
      }
    },
    [isLoggedIn, user, token, usingServer]
  );

  useEffect(() => {
    if (isLoggedIn && user) {
      load(true);
    }
  }, [isLoggedIn, user?.id]);

  if (!isLoggedIn) {
    return (
      <View style={[styles.gate, { backgroundColor: colors.bg }]}>
        <Ionicons name="heart-circle-outline" size={64} color={colors.textMuted} />
        <Text style={[styles.gateTitle, { color: colors.text }]}>For You</Text>
        <Text style={[styles.gateDesc, { color: colors.textSecondary }]}>
          Sign in to get personalised recommendations based on your likes and bookmarks.
        </Text>
        <Pressable
          style={[styles.loginBtn, { backgroundColor: colors.accent }]}
          onPress={() => router.push("/login")}
        >
          <Text style={styles.loginBtnText}>Sign In</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {topTags.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagsRow}
        >
          <Text style={[styles.basedOn, { color: colors.textMuted }]}>Based on:</Text>
          {topTags.map((tag) => (
            <View key={tag} style={[styles.tagPill, { backgroundColor: colors.bgTertiary }]}>
              <Text style={[styles.tagPillText, { color: colors.accent }]}>{tag}</Text>
            </View>
          ))}
        </ScrollView>
      )}
      {usingServer && (
        <View style={[styles.serverBadge, { backgroundColor: colors.bgTertiary }]}>
          <Ionicons name="server-outline" size={11} color={colors.accent} />
          <Text style={[styles.serverBadgeText, { color: colors.accent }]}>Server algorithm active</Text>
        </View>
      )}
      <PostGrid
        posts={posts}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        onRefresh={() => load(true)}
        onEndReached={() => load(false)}
        emptyText="Like or bookmark some posts to get personalised recommendations"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gate: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  gateTitle: {
    fontSize: 24,
    fontWeight: "700",
  },
  gateDesc: {
    fontSize: FontSize.md,
    textAlign: "center",
    lineHeight: 22,
  },
  loginBtn: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  loginBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: FontSize.md,
  },
  tagsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  basedOn: {
    fontSize: FontSize.sm,
    marginRight: Spacing.xs,
  },
  tagPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  tagPillText: {
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  serverBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 4,
    marginRight: Spacing.md,
    marginBottom: 2,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  serverBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
});
