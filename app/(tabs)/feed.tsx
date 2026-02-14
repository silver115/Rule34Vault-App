import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import * as Notifications from "expo-notifications";
import api, { Post, Tag } from "../../api/rule34vault";
import { PostGrid } from "../../components/PostGrid";
import { useAuth } from "../../contexts/AuthContext";
import { useFeedCount } from "../../contexts/FeedCountContext";
import { Colors, Radius, Spacing, FontSize } from "../../constants/theme";
import { useAppTheme } from "../../contexts/ThemeContext";

export default function FeedScreen() {
  const { user, isLoggedIn, isLoading: authLoading } = useAuth();
  const { setCount: setFeedCount } = useFeedCount();
  const router = useRouter();

  // Dismiss all notifications when user visits the Feed tab
  useFocusEffect(
    useCallback(() => {
      Notifications.dismissAllNotificationsAsync();
      Notifications.setBadgeCountAsync(0);
    }, [])
  );

  const [posts, setPosts] = useState<Post[]>([]);
  const [subscribedTags, setSubscribedTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [postTagMap, setPostTagMap] = useState<Map<number, string>>(new Map());
  const subscribedTagsRef = useRef<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);

  // Count how many loaded feed posts each subscribed tag has, filter & sort by that count
  const { sortedTags, feedTagCounts } = useMemo(() => {
    const countMap = new Map<number, number>();
    for (const p of posts) {
      if (p.tags) {
        for (const t of p.tags) countMap.set(t.id, (countMap.get(t.id) ?? 0) + 1);
      }
    }
    // Also count via badgeMap for posts without enriched tags
    for (const [, tagValue] of postTagMap) {
      const tag = subscribedTags.find((t) => t.value === tagValue);
      if (tag && !countMap.has(tag.id)) countMap.set(tag.id, (countMap.get(tag.id) ?? 0) + 1);
    }

    const subIds = new Set(subscribedTags.map((t) => t.id));
    let visible = subscribedTags.filter((t) => countMap.has(t.id) && subIds.has(t.id));
    // Sort by feed post count descending
    visible.sort((a, b) => (countMap.get(b.id) ?? 0) - (countMap.get(a.id) ?? 0));

    // If a tag is selected, pin it first
    if (selectedTagId != null) {
      const selected = visible.find((t) => t.id === selectedTagId);
      const rest = visible.filter((t) => t.id !== selectedTagId);
      visible = selected ? [selected, ...rest] : rest;
    }

    return { sortedTags: visible, feedTagCounts: countMap };
  }, [posts, subscribedTags, postTagMap, selectedTagId]);

  // Filter posts by selected tag
  const filteredPosts = useMemo(() => {
    if (selectedTagId == null) return posts;
    return posts.filter((p) => {
      if (p.tags) return p.tags.some((t) => t.id === selectedTagId);
      // Fallback: check the badgeMap
      const badge = postTagMap.get(p.id);
      const selTag = subscribedTags.find((t) => t.id === selectedTagId);
      return badge && selTag && badge === selTag.value;
    });
  }, [posts, selectedTagId, postTagMap, subscribedTags]);

  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const isLoadingMoreRef = useRef(false);

  function enrichPostsInBackground(items: Post[], subTags: Tag[], refresh: boolean) {
    const subTagIds = new Set(subTags.map((t) => t.id));
    api.getPostsBatch(items.map((p) => p.id)).then((detailed) => {
      const detailMap = new Map(detailed.map((p) => [p.id, p]));
      const enriched = items.map((p) => detailMap.get(p.id) ?? p);
      const newBadges = new Map<number, string>();

      for (const post of enriched) {
        if (post.tags) {
          const match = post.tags.find((tag) => subTagIds.has(tag.id));
          if (match) newBadges.set(post.id, match.value);
        }
      }

      // Update posts with enriched data (tags)
      if (refresh) {
        setPosts(enriched);
        setPostTagMap(newBadges);
      } else {
        setPosts((prev) =>
          prev.map((p) => detailMap.get(p.id) ?? p)
        );
        setPostTagMap((prev) => {
          const merged = new Map(prev);
          newBadges.forEach((v, k) => merged.set(k, v));
          return merged;
        });
      }
    }).catch(() => {});
  }

  async function loadFeed(refresh: boolean) {
    if (!user) return;

    if (refresh) {
      setIsLoading(true);
      cursorRef.current = null;
      hasMoreRef.current = true;
    } else {
      if (!hasMoreRef.current || isLoadingMoreRef.current) return;
      isLoadingMoreRef.current = true;
      setIsLoadingMore(true);
    }

    try {
      const data = await api.searchFeedPosts(
        user.id,
        40,
        refresh ? null : cursorRef.current
      );

      cursorRef.current = data.cursor;
      if (!data.items.length || !data.cursor) hasMoreRef.current = false;

      // Show posts immediately (fast)
      if (refresh) {
        setPosts(data.items);
        try { await api.markFeedWatched(); } catch {}
        setFeedCount(0);
      } else {
        setPosts((prev) => [...prev, ...data.items]);
      }

      // Enrich with tag details in background (for badges + tag filtering)
      const subTags = subscribedTagsRef.current;
      if (subTags.length > 0 && data.items.length > 0) {
        enrichPostsInBackground(data.items, subTags, refresh);
      }
    } catch (e: any) {
      console.error("Failed to load feed:", e?.message || e);
    } finally {
      setIsLoading(false);
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }

  async function loadSubscribedTags() {
    try {
      const tags = await api.getActiveTagSubscriptions();
      setSubscribedTags(tags);
      subscribedTagsRef.current = tags;
    } catch {}
  }

  useEffect(() => {
    if (isLoggedIn && user) {
      // Load subscribed tags first so badge matching works on first feed load
      (async () => {
        await loadSubscribedTags();
        loadFeed(true);
      })();
    } else if (!authLoading) {
      setIsLoading(false);
    }
  }, [isLoggedIn, user?.id]);

  // Not logged in state
  const { colors } = useAppTheme();

  if (!authLoading && !isLoggedIn) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.bg }]}>
        <Ionicons name="notifications-outline" size={64} color={colors.textMuted} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Sign in to see your feed</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Subscribe to tags and see new posts from your favorite content here.
        </Text>
        <Pressable
          style={[styles.loginButton, { backgroundColor: colors.accent }]}
          onPress={() => router.push("/login")}
        >
          <Text style={styles.loginButtonText}>Sign In</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Subscribed tags bar */}
      {sortedTags.length > 0 && (
        <View style={[styles.tagsSection, { borderBottomColor: colors.border }]}>
          <Text style={[styles.tagsSectionTitle, { color: colors.textSecondary }]}>
            <Ionicons name="pricetags-outline" size={14} color={colors.textSecondary} />
            {"  "}Subscribed Tags ({sortedTags.length})
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tagsRow}
          >
            {sortedTags.map((tag) => {
              const isActive = selectedTagId === tag.id;
              return (
                <Pressable
                  key={tag.id}
                  style={[styles.tagChip, { backgroundColor: colors.bgTertiary, borderColor: colors.border }, isActive && { backgroundColor: colors.accent, borderColor: colors.accentLight }]}
                  onPress={() =>
                    setSelectedTagId(isActive ? null : tag.id)
                  }
                >
                  <Text style={[styles.tagChipText, { color: colors.accentLight }, isActive && styles.tagChipTextActive]}>
                    {tag.value}
                  </Text>
                  {feedTagCounts.has(tag.id) && (
                    <Text style={[styles.tagChipCount, { color: colors.textMuted }, isActive && styles.tagChipCountActive]}>
                      {feedTagCounts.get(tag.id)}
                    </Text>
                  )}
                  {isActive && (
                    <Ionicons name="close-circle" size={14} color="#fff" style={{ marginLeft: 4 }} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Empty state */}
      {!isLoading && filteredPosts.length === 0 && (
        <View style={[styles.centerContainer, { backgroundColor: colors.bg }]}>
          <Ionicons name="notifications-off-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Your feed is empty</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Subscribe to tags to see new posts here. Browse and tap the subscribe
            button on any tag to get started.
          </Text>
        </View>
      )}

      {/* Post grid */}
      {(filteredPosts.length > 0 || isLoading) && (
        <PostGrid
          posts={filteredPosts}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          onRefresh={() => loadFeed(true)}
          onEndReached={() => loadFeed(false)}
          badgeMap={postTagMap}
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
  centerContainer: {
    flex: 1,
    backgroundColor: Colors.bg,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: "700",
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  emptySubtitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    textAlign: "center",
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  loginButton: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
  },
  loginButtonText: {
    color: "#fff",
    fontSize: FontSize.md,
    fontWeight: "700",
  },
  tagsSection: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tagsSectionTitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: "600",
    marginBottom: Spacing.sm,
  },
  tagsRow: {
    gap: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgTertiary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagChipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accentLight,
  },
  tagChipText: {
    color: Colors.accentLight,
    fontSize: FontSize.sm,
    fontWeight: "500",
  },
  tagChipTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  tagChipCount: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    marginLeft: Spacing.xs,
  },
  tagChipCountActive: {
    color: "rgba(255,255,255,0.7)",
  },
});
