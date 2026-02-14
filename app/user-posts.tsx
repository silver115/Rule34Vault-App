import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import api, { Post } from "../api/rule34vault";
import { PostGrid } from "../components/PostGrid";
import { useAuth } from "../contexts/AuthContext";
import { Colors, FontSize, Spacing } from "../constants/theme";

type PostType = "liked" | "bookmarked" | "super-liked";

const TITLES: Record<PostType, string> = {
  liked: "Liked Posts",
  bookmarked: "Bookmarked Posts",
  "super-liked": "Super Liked Posts",
};

export default function UserPostsScreen() {
  const { type, userId: userIdParam, userName } = useLocalSearchParams<{ type: string; userId?: string; userName?: string }>();
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);

  const targetUserId = userIdParam ? parseInt(userIdParam, 10) : user?.id;
  const postType = (type as PostType) || "liked";
  const prefix = userName ? `@${userName}'s ` : "";
  const title = `${prefix}${TITLES[postType] || "Posts"}`;

  async function loadPosts(refresh: boolean) {
    if (!targetUserId) return;
    if (!refresh && !hasMoreRef.current) return;

    if (refresh) {
      setIsLoading(true);
      cursorRef.current = null;
      hasMoreRef.current = true;
    } else {
      setIsLoadingMore(true);
    }

    try {
      let resp;
      const cursor = refresh ? undefined : cursorRef.current;
      switch (postType) {
        case "liked":
          resp = await api.searchLikedPosts(targetUserId, 30, cursor);
          break;
        case "bookmarked":
          resp = await api.searchBookmarkedPosts(targetUserId, 30, cursor);
          break;
        case "super-liked":
          resp = await api.searchSuperLikedPosts(targetUserId, 30, cursor);
          break;
        default:
          return;
      }

      if (refresh) {
        setPosts(resp.items);
      } else {
        setPosts((prev) => [...prev, ...resp.items]);
      }
      cursorRef.current = resp.cursor;
      hasMoreRef.current = !!resp.cursor;
    } catch (e) {
      console.error("Failed to load posts:", e);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }

  useEffect(() => {
    loadPosts(true);
  }, [postType, targetUserId]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title }} />
      {posts.length === 0 && !isLoading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No {title.toLowerCase()} yet</Text>
        </View>
      ) : (
        <PostGrid
          posts={posts}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          onRefresh={() => loadPosts(true)}
          onEndReached={() => loadPosts(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
  },
});
