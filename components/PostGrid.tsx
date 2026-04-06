import { Image } from "expo-image";
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ActivityIndicator,
    FlatList,
    Platform,
    RefreshControl,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import api, { Post } from "../api/rule34vault";
import { Colors, FontSize, Spacing } from "../constants/theme";
import { useAuth } from "../contexts/AuthContext";
import { usePostList } from "../contexts/PostListContext";
import { useSite } from "../contexts/SiteContext";
import { getSiteMediaUrl } from "../utils/media";
import {
    GAP,
    isBrokenPost,
    NUM_COLUMNS,
    onBrokenPostsChange,
    PostCard,
} from "./PostCard";
import { PostCardSkeleton } from "./SkeletonLoader";

interface PostGridProps {
  posts: Post[];
  isLoading: boolean;
  isLoadingMore: boolean;
  onRefresh: () => void;
  onEndReached: () => void;
  emptyText?: string;
  ListHeaderComponent?: React.ReactElement;
  ListEmptyComponent?: React.ReactElement | null;
  badgeMap?: Map<number, string>;
  /** If provided, replaces the default navigate-to-detail behaviour on post tap */
  onPostPress?: (post: Post, index: number) => void;
}

export function PostGrid({
  posts,
  isLoading,
  isLoadingMore,
  onRefresh,
  onEndReached,
  emptyText = "No posts found",
  ListHeaderComponent,
  ListEmptyComponent,
  badgeMap,
  onPostPress,
}: PostGridProps) {
  const {
    actionStates,
    updateActionState,
    setActionStates,
    ensureActionStates,
  } = usePostList();
  const { isLoggedIn } = useAuth();
  const { isE621 } = useSite();
  const { width: screenWidth } = useWindowDimensions();

  // Calculate card dimensions
  const cardWidth = Math.floor(
    (screenWidth - GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS,
  );
  const cardHeight = Math.floor((cardWidth * 4) / 3); // 4:3 aspect ratio

  // Track which IDs have already had action states seeded so we never call
  // setActionStates / ensureActionStates with the full posts array on every
  // page append — only the genuinely new posts on each page load.
  const seededIdsRef = useRef(new Set<number>());

  // Seed action states only for posts that haven't been seeded yet.
  // For e621: read _e621Favorited from the search response to avoid N extra calls.
  useEffect(() => {
    if (posts.length === 0) {
      seededIdsRef.current.clear();
      return;
    }
    if (!isLoggedIn) return;
    if (isE621) {
      const newSeeds: Record<
        number,
        { isLiked: boolean; isBookmarked: boolean; isSuperLiked: boolean }
      > = {};
      for (const p of posts) {
        if (!seededIdsRef.current.has(p.id)) {
          seededIdsRef.current.add(p.id);
          newSeeds[p.id] = {
            isLiked: (p as any)._e621Favorited ?? false,
            isBookmarked: false,
            isSuperLiked: false,
          };
        }
      }
      if (Object.keys(newSeeds).length > 0) {
        setActionStates(newSeeds);
      }
    } else {
      const newIds = posts
        .map((p) => p.id)
        .filter((id) => !seededIdsRef.current.has(id));
      if (newIds.length > 0) {
        newIds.forEach((id) => seededIdsRef.current.add(id));
        ensureActionStates(newIds);
      }
    }
  }, [posts, isLoggedIn, isE621, ensureActionStates, setActionStates]);

  // Prefetch upcoming thumbnail images for smooth scrolling
  const prefetchedRef = useRef(new Set<number>());
  useEffect(() => {
    if (posts.length === 0) return;
    const PREFETCH_COUNT = 8;
    const toPrefetch = posts
      .filter((p) => !prefetchedRef.current.has(p.id))
      .slice(0, PREFETCH_COUNT);
    for (const p of toPrefetch) {
      prefetchedRef.current.add(p.id);
      const url = getSiteMediaUrl(p, isE621 ? "sample" : "thumb");
      if (url && Platform.OS !== "web") {
        Image.prefetch(url).catch(() => {});
      }
    }
  }, [posts, isE621]);

  // Refresh action states for a specific post after user action
  const refreshActionState = useCallback(
    async (postId: number) => {
      if (!isLoggedIn) return;
      try {
        const state = await api.getPostActionState(postId);
        updateActionState(postId, state);
      } catch {}
    },
    [isLoggedIn, updateActionState],
  );

  // Re-render when broken posts are detected so they get filtered out
  const [brokenTick, setBrokenTick] = useState(0);
  useEffect(() => {
    return onBrokenPostsChange(() => setBrokenTick((t) => t + 1));
  }, []);

  const filteredPosts = useMemo(
    () => posts.filter((p) => !isBrokenPost(p.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posts, brokenTick],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <PostCard
        post={item}
        index={index}
        onNavigate={onPostPress}
        badgeText={badgeMap?.get(item.id)}
        actionState={actionStates[item.id]}
        onActionChange={refreshActionState}
      />
    ),
    // filteredPosts intentionally omitted — it is not read inside renderItem.
    // actionStates kept so like/bookmark updates reach the correct cell.
    // onNavigate is a stable useCallback from the parent, never a new arrow fn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onPostPress, badgeMap, actionStates, refreshActionState],
  );

  const keyExtractor = useCallback((item: Post) => String(item.id), []);

  // Show skeleton cards during initial load
  if (isLoading && filteredPosts.length === 0) {
    return (
      <View style={styles.grid}>
        {Array.from({ length: 6 }, (_, index) => (
          <PostCardSkeleton
            key={`skeleton-${index}`}
            cardWidth={cardWidth}
            cardHeight={cardHeight}
          />
        ))}
      </View>
    );
  }

  return (
    <FlatList
      data={filteredPosts}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={NUM_COLUMNS}
      contentContainerStyle={styles.grid}
      showsVerticalScrollIndicator={false}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.1}
      removeClippedSubviews={true}
      windowSize={10}
      maxToRenderPerBatch={8}
      initialNumToRender={8}
      updateCellsBatchingPeriod={30}
      getItemLayout={(_, index) => ({
        length: cardHeight + GAP,
        offset: (cardHeight + GAP) * Math.floor(index / NUM_COLUMNS),
        index,
      })}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={
        ListEmptyComponent !== undefined ? (
          ListEmptyComponent
        ) : (
          <View style={styles.center}>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        )
      }
      ListFooterComponent={
        isLoadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator size="small" color={Colors.accent} />
          </View>
        ) : null
      }
      refreshControl={
        <RefreshControl
          refreshing={isLoading && posts.length > 0}
          onRefresh={onRefresh}
          tintColor={Colors.accent}
          colors={[Colors.accent]}
          progressBackgroundColor={Colors.bgSecondary}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  grid: {
    paddingHorizontal: GAP / 2,
    paddingTop: Spacing.sm,
    paddingBottom: 100,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
  },
  footer: {
    paddingVertical: Spacing.lg,
    alignItems: "center",
  },
});
