import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import api, { Post, SearchFilters } from "../../api/rule34vault";
import { PostGrid } from "../../components/PostGrid";
import { FeedView } from "../../components/FeedView";
import { FilterBar } from "../../components/FilterBar";
import { Colors, Radius, Spacing, FontSize } from "../../constants/theme";
import { useAppTheme } from "../../contexts/ThemeContext";
import { useSettings } from "../../contexts/SettingsContext";

type FeedType = "recent" | "hot" | "highest" | "comments";

const FEED_OPTIONS: { key: FeedType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "recent", label: "Latest", icon: "time-outline" },
  { key: "hot", label: "Hot", icon: "flame-outline" },
  { key: "highest", label: "Highest Rated", icon: "trophy-outline" },
  { key: "comments", label: "Most Commented", icon: "chatbubbles-outline" },
];

export default function BrowseScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [feedType, setFeedType] = useState<FeedType>("recent");
  const [feedOpen, setFeedOpen] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const isLoadingMoreRef = useRef(false);
  const filtersRef = useRef(filters);
  const feedRef = useRef(feedType);
  filtersRef.current = filters;
  feedRef.current = feedType;

  async function doLoad(refresh: boolean, overrideFilters?: SearchFilters, overrideFeed?: FeedType) {
    const currentFilters = overrideFilters ?? filtersRef.current;
    const currentFeed = overrideFeed ?? feedRef.current;
    const minScore = currentFilters.minScore ?? 0;
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
      const batchSize = minScore > 0 ? 120 : 60;
      const feedFilters: SearchFilters = { ...currentFilters };

      // sortBy enum: 0=id (recent), 1=likes (top rated), 2=views
      if (currentFeed === "hot") {
        feedFilters.sortBy = 1;
        if (!feedFilters.postedFromDays) feedFilters.postedFromDays = 7;
      }
      if (currentFeed === "highest") feedFilters.sortBy = 1;

      const data = await api.searchPosts(
        batchSize,
        refresh ? null : cursorRef.current,
        feedFilters
      );
      cursorRef.current = data.cursor;
      if (!data.items.length || !data.cursor) hasMoreRef.current = false;

      let items = data.items;
      const needsDetails = minScore > 0 || currentFeed === "comments";
      if (needsDetails) {
        const detailed = await api.getPostsBatch(items.map((p) => p.id));
        const detailMap = new Map(detailed.map((p) => [p.id, p]));
        items = items.map((p) => detailMap.get(p.id) ?? p);
      }

      if (minScore > 0) {
        items = items.filter((p) => (p.likes ?? 0) >= minScore);
      }

      if (currentFeed === "comments") {
        items = [...items].sort(
          (a, b) => (b.comments ?? 0) - (a.comments ?? 0)
        );
      }

      if (refresh) {
        setPosts(items);
      } else {
        setPosts((prev) => [...prev, ...items]);
      }
    } catch (e: any) {
      console.error("Failed to load posts:", e?.message || e, JSON.stringify(e));
    } finally {
      setIsLoading(false);
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }

  function handleFiltersChange(f: SearchFilters) {
    setFilters(f);
    filtersRef.current = f;
    setPosts([]);
    doLoad(true, f, feedRef.current);
  }

  function handleFeedChange(f: FeedType) {
    setFeedType(f);
    setFeedOpen(false);
    feedRef.current = f;
    setPosts([]);
    doLoad(true, filtersRef.current, f);
  }

  useEffect(() => {
    doLoad(true);
  }, []);

  const activeFeed = FEED_OPTIONS.find((f) => f.key === feedType)!;
  const availableFeeds = FEED_OPTIONS;
  const { colors } = useAppTheme();
  const { viewingMode, setViewingMode } = useSettings();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Feed selector */}
      <View style={styles.feedBar}>
        <Pressable
          style={[styles.feedSelector, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          onPress={() => setFeedOpen(!feedOpen)}
        >
          <Ionicons name={activeFeed.icon} size={16} color={colors.accent} />
          <Text style={[styles.feedLabel, { color: colors.text }]}>{activeFeed.label}</Text>
          <Ionicons
            name={feedOpen ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.textMuted}
          />
        </Pressable>
        <Pressable
          style={[styles.viewToggle, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          onPress={() => setViewingMode(viewingMode === "grid" ? "feed" : "grid")}
        >
          <Ionicons
            name={viewingMode === "grid" ? "phone-portrait-outline" : "grid-outline"}
            size={16}
            color={colors.accent}
          />
        </Pressable>
      </View>

      {feedOpen && (
        <View style={[styles.feedDropdown, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {availableFeeds.map((opt) => {
            const active = feedType === opt.key;
            return (
              <Pressable
                key={opt.key}
                style={[styles.feedItem, { borderBottomColor: colors.border }, active && { backgroundColor: colors.accent + "15" }]}
                onPress={() => handleFeedChange(opt.key)}
              >
                <Ionicons
                  name={opt.icon}
                  size={16}
                  color={active ? colors.accent : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.feedItemText,
                    { color: colors.textSecondary },
                    active && { color: colors.accent, fontWeight: "700" },
                  ]}
                >
                  {opt.label}
                </Text>
                {active && (
                  <Ionicons name="checkmark" size={16} color={colors.accent} />
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />
      <PostGrid
        key={`grid-${feedType}-${filters.type ?? "all"}-${filters.includeTags?.join(",") ?? ""}`}
        posts={posts}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        onRefresh={() => doLoad(true)}
        onEndReached={() => doLoad(false)}
      />
      {viewingMode === "feed" && (
        <FeedView
          key={`feed-${feedType}-${filters.type ?? "all"}-${filters.includeTags?.join(",") ?? ""}`}
          posts={posts}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          onRefresh={() => doLoad(true)}
          onEndReached={() => doLoad(false)}
          onExit={() => setViewingMode("grid")}
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
  feedBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  feedSelector: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  viewToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    marginLeft: "auto",
  },
  feedLabel: {
    fontSize: FontSize.sm,
    fontWeight: "700",
    color: Colors.text,
  },
  feedDropdown: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  feedItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  feedItemActive: {
    backgroundColor: `${Colors.accent}15`,
  },
  feedItemText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  feedItemTextActive: {
    color: Colors.accent,
    fontWeight: "700",
  },
});
