import React, { createContext, useContext, useState, useCallback } from "react";
import { Post } from "../api/rule34vault";

interface PostListState {
  posts: Post[];
  setPosts: (posts: Post[]) => void;
}

const PostListContext = createContext<PostListState>({
  posts: [],
  setPosts: () => {},
});

export function PostListProvider({ children }: { children: React.ReactNode }) {
  const [posts, setPostsState] = useState<Post[]>([]);
  const setPosts = useCallback((p: Post[]) => setPostsState(p), []);

  return (
    <PostListContext.Provider value={{ posts, setPosts }}>
      {children}
    </PostListContext.Provider>
  );
}

export function usePostList() {
  return useContext(PostListContext);
}
