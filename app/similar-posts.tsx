import { useLocalSearchParams, useNavigation } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import api, { Post, SearchFilters } from "../api/rule34vault";
import { FilterBar } from "../components/FilterBar";
import { PostGrid } from "../components/PostGrid";
import { Colors } from "../constants/theme";

export default function SimilarPostsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const navigation = useNavigation();
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<SearchFilters>({});
  const loadedRef = useRef(false);

  useEffect(() => {
    navigation.setOptions({ title: "Similar Posts" });
  }, []);

  const loadSimilar = useCallback(async () => {
    if (!postId) return;
    setIsLoading(true);
    try {
      const post = await api.getPost(Number(postId));
      const similar = await api.searchSimilarPosts(post, 60);
      setPosts(similar);
    } catch (e) {
      console.error("Failed to load similar posts:", e);
    } finally {
      setIsLoading(false);
      loadedRef.current = true;
    }
  }, [postId]);

  // Apply filters to posts
  const filteredPosts = useMemo(() => {
    let filtered = [...posts];
    
    // Filter by type
    if (filters.type != null) {
      filtered = filtered.filter(p => p.type === filters.type);
    }
    
    // Filter by hot range (postedFromDays)
    if (filters.postedFromDays != null && filters.postedFromDays > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - filters.postedFromDays);
      filtered = filtered.filter(p => {
        const postDate = new Date(p.created);
        return postDate >= cutoffDate;
      });
    }
    // Note: 999 (All Time) and -1 (Default) don't need time filtering
    
    return filtered;
  }, [posts, filters]);

  useEffect(() => {
    loadSimilar();
  }, [postId]);

  return (
    <View style={styles.container}>
      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        hideTagInput={true}
      />
      <PostGrid
        posts={filteredPosts}
        isLoading={isLoading}
        isLoadingMore={false}
        onRefresh={loadSimilar}
        onEndReached={() => {}}
        emptyText="No similar posts found"
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
