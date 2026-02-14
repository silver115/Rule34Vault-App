import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, StyleSheet } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import api, { Post, SearchFilters } from "../../api/rule34vault";
import { PostGrid } from "../../components/PostGrid";
import { FilterBar } from "../../components/FilterBar";
import { Colors } from "../../constants/theme";

export default function TagPostsScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const navigation = useNavigation();
  const tagName = name || id;

  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({});
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    navigation.setOptions({ title: `#${tagName}` });
  }, [tagName]);

  useEffect(() => {
    loadPosts(true);
  }, [tagName, filters]);

  const loadPosts = useCallback(
    async (refresh = false) => {
      const currentFilters = filtersRef.current;
      if (refresh) {
        setIsLoading(true);
        cursorRef.current = null;
        hasMoreRef.current = true;
      } else {
        if (!hasMoreRef.current || isLoadingMore) return;
        setIsLoadingMore(true);
      }

      try {
        const minScore = currentFilters.minScore ?? 0;
        const batchSize = minScore > 0 ? 120 : 60;
        const data = await api.searchPostsByTag(
          tagName,
          batchSize,
          refresh ? null : cursorRef.current,
          currentFilters
        );
        cursorRef.current = data.cursor;
        if (!data.items.length || !data.cursor) hasMoreRef.current = false;

        let items = data.items;
        if (minScore > 0) {
          const detailed = await api.getPostsBatch(items.map((p) => p.id));
          items = detailed.filter((p) => (p.likes ?? 0) >= minScore);
        }

        if (refresh) {
          setPosts(items);
        } else {
          setPosts((prev) => [...prev, ...items]);
        }
      } catch (e) {
        console.error("Failed to load tag posts:", e);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [tagName, isLoadingMore]
  );

  return (
    <View style={styles.container}>
      <FilterBar filters={filters} onFiltersChange={setFilters} hideTagInput />
      <PostGrid
        posts={posts}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        onRefresh={() => loadPosts(true)}
        onEndReached={() => loadPosts(false)}
        emptyText="No posts found for this tag"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
});
