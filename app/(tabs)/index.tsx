import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useNavigation } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import api, { Post, SearchFilters } from "../../api/rule34vault";
import { FilterBar } from "../../components/FilterBar";
import { PostGrid } from "../../components/PostGrid";
import { TikTokFeed } from "../../components/TikTokFeed";
import { Colors, FontSize, Radius, Spacing } from "../../constants/theme";
import { useSettings } from "../../contexts/SettingsContext";
import { useAppTheme } from "../../contexts/ThemeContext";

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
  const [loadError, setLoadError] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [feedType, setFeedType] = useState<FeedType>("recent");
  const [feedOpen, setFeedOpen] = useState(false);
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
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

    setLoadError(false);
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
      if (refresh) setLoadError(true);
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
  const { colors } = useAppTheme();
  const { viewingMode, setViewingMode } = useSettings();
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const handlePostPress = useCallback((_post: Post, index: number) => {
    setFullscreenIndex(index);
  }, []);

  // Hide the top header when in TikTok mode for full immersion
  useEffect(() => {
    navigation.setOptions({
      headerShown: viewingMode !== "tiktok",
    });
  }, [viewingMode, navigation]);

  if (loadError && posts.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg, justifyContent: "center", alignItems: "center", gap: 12 }]}>
        <Ionicons name="cloud-offline-outline" size={52} color={colors.textMuted} />
        <Text style={[styles.feedLabel, { color: colors.text, fontSize: FontSize.lg }]}>Failed to load</Text>
        <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm, textAlign: "center", paddingHorizontal: 32 }}>
          Check your connection and try again
        </Text>
        <Pressable
          style={[styles.feedSelector, { backgroundColor: colors.accent, borderColor: colors.accent, marginTop: 8 }]}
          onPress={() => doLoad(true)}
        >
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={[styles.feedLabel, { color: "#fff" }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }

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
          onPress={() => setViewingMode(viewingMode === "grid" ? "tiktok" : "grid")}
        >
          <Ionicons
            name={viewingMode === "grid" ? "phone-portrait-outline" : "grid-outline"}
            size={16}
            color={colors.accent}
          />
        </Pressable>
      </View>

      {feedOpen && (
        <Pressable style={styles.feedBackdrop} onPress={() => setFeedOpen(false)} />
      )}
      {feedOpen && (
        <View style={[styles.feedDropdown, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {FEED_OPTIONS.map((opt) => {
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

      {viewingMode !== "tiktok" && (
        <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />
      )}

      {/* Main Content — only one view mounted at a time to save RAM */}
      {viewingMode === "tiktok" ? (
        <TikTokFeed
          key={`tiktok-${feedType}-${filters.type ?? "all"}-${filters.includeTags?.join(",") ?? ""}`}
          posts={posts}
          isLoading={isLoading}
          tabFocused={isFocused}
          onRefresh={() => doLoad(true)}
          onLoadMore={() => doLoad(false)}
        />
      ) : (
        <PostGrid
          key={`grid-${feedType}-${filters.type ?? "all"}-${filters.includeTags?.join(",") ?? ""}`}
          posts={posts}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          onRefresh={() => doLoad(true)}
          onEndReached={() => doLoad(false)}
          onPostPress={handlePostPress}
        />
      )}

      {/* Full-screen TikTok player modal — opened when tapping a grid post */}
      <Modal
        visible={fullscreenIndex !== null}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setFullscreenIndex(null)}
      >
        <View style={styles.fullscreenModal}>
          <StatusBar hidden />
          {fullscreenIndex !== null && (
            <TikTokFeed
              posts={posts.slice(fullscreenIndex)}
              isLoading={false}
              tabFocused={fullscreenIndex !== null}
              onRefresh={() => doLoad(true)}
              onLoadMore={() => doLoad(false)}
            />
          )}
          {/* Close button — top-right, above safe area */}
          <Pressable
            style={[styles.modalCloseBtn, { top: insets.top + 12 }]}
            onPress={() => setFullscreenIndex(null)}
            hitSlop={12}
          >
            <Ionicons name="close" size={22} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>
      </Modal>
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
  feedBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  feedDropdown: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.xs,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    zIndex: 2,
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
  feedItemText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  fullscreenModal: {
    flex: 1,
    backgroundColor: "#000",
  },
  modalCloseBtn: {
    position: "absolute",
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 50,
  },
});
