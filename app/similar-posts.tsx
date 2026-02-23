import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, StyleSheet } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import api, { Post } from "../api/rule34vault";
import { PostGrid } from "../components/PostGrid";
import { Colors } from "../constants/theme";

export default function SimilarPostsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const navigation = useNavigation();
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

  useEffect(() => {
    loadSimilar();
  }, [postId]);

  return (
    <View style={styles.container}>
      <PostGrid
        posts={posts}
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
