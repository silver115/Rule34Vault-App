import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
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
import { GAP, isBrokenPost, NUM_COLUMNS, onBrokenPostsChange, PostCard } from "./PostCard";
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
  const { actionStates, updateActionState, ensureActionStates } = usePostList();
  const { isLoggedIn } = useAuth();
  const { width: screenWidth } = useWindowDimensions();

  // Calculate card dimensions
  const cardWidth = Math.floor((screenWidth - GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS);
  const cardHeight = Math.floor(cardWidth * 4 / 3); // 4:3 aspect ratio

  // Fetch action states for all posts, deduplication handled by context
  useEffect(() => {
    if (!isLoggedIn || posts.length === 0) return;
    ensureActionStates(posts.map(p => p.id));
  }, [posts, isLoggedIn, ensureActionStates]);

  // Refresh action states for a specific post after user action
  const refreshActionState = useCallback(async (postId: number) => {
    if (!isLoggedIn) return;
    try {
      const state = await api.getPostActionState(postId);
      updateActionState(postId, state);
    } catch {}
  }, [isLoggedIn, updateActionState]);

  // Re-render when broken posts are detected so they get filtered out
  const [brokenTick, setBrokenTick] = useState(0);
  useEffect(() => {
    return onBrokenPostsChange(() => setBrokenTick((t) => t + 1));
  }, []);

  const filteredPosts = useMemo(
    () => posts.filter((p) => !isBrokenPost(p.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posts, brokenTick]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <PostCard
        post={item}
        index={index}
        onPress={onPostPress ? () => onPostPress(item, index) : undefined}
        badgeText={badgeMap?.get(item.id)}
        actionState={actionStates[item.id]}
        onActionChange={refreshActionState}
      />
    ),
    [filteredPosts, onPostPress, badgeMap, actionStates, refreshActionState]
  );

  const keyExtractor = useCallback((item: Post) => String(item.id), []);

  // Show skeleton cards during initial load
  if (isLoading && filteredPosts.length === 0) {
    return (
      <View style={styles.grid}>
        {Array.from({ length: 6 }, (_, index) => (
          <PostCardSkeleton key={`skeleton-${index}`} cardWidth={cardWidth} cardHeight={cardHeight} />
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
      windowSize={5}
      maxToRenderPerBatch={6}
      initialNumToRender={6}
      updateCellsBatchingPeriod={30}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={
        ListEmptyComponent !== undefined ? ListEmptyComponent : (
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
