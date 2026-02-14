import React, { useCallback } from "react";
import {
  FlatList,
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  RefreshControl,
} from "react-native";
import { Post } from "../api/rule34vault";
import { PostCard, NUM_COLUMNS, GAP } from "./PostCard";
import { usePostList } from "../contexts/PostListContext";
import { Colors, Spacing, FontSize } from "../constants/theme";

interface PostGridProps {
  posts: Post[];
  isLoading: boolean;
  isLoadingMore: boolean;
  onRefresh: () => void;
  onEndReached: () => void;
  emptyText?: string;
  ListHeaderComponent?: React.ReactElement;
  badgeMap?: Map<number, string>;
}

export function PostGrid({
  posts,
  isLoading,
  isLoadingMore,
  onRefresh,
  onEndReached,
  emptyText = "No posts found",
  ListHeaderComponent,
  badgeMap,
}: PostGridProps) {
  const { setPosts } = usePostList();

  const renderItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <PostCard
        post={item}
        index={index}
        onPress={() => setPosts(posts)}
        badgeText={badgeMap?.get(item.id)}
      />
    ),
    [posts, setPosts, badgeMap]
  );

  const keyExtractor = useCallback((item: Post) => String(item.id), []);

  if (isLoading && posts.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <FlatList
      data={posts}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={NUM_COLUMNS}
      contentContainerStyle={styles.grid}
      showsVerticalScrollIndicator={false}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
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
