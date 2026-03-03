import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import api, { Post } from "../api/rule34vault";

export interface PostActionState {
  isLiked: boolean;
  isBookmarked: boolean;
  isSuperLiked: boolean;
}

interface PostListState {
  postIds: number[];
  /** Accepts a Post array for convenience; only IDs are stored to save RAM */
  setPosts: (posts: Post[]) => void;
  actionStates: Record<number, PostActionState>;
  setActionStates: (states: Record<number, PostActionState>) => void;
  updateActionState: (postId: number, state: PostActionState) => void;
  /**
   * Batch-fetch action states for the given IDs, skipping any already cached.
   * Safe to call repeatedly — deduplicates by an internal fetched-set.
   */
  ensureActionStates: (postIds: number[]) => Promise<void>;
}

const PostListContext = createContext<PostListState>({
  postIds: [],
  setPosts: () => {},
  actionStates: {},
  setActionStates: () => {},
  updateActionState: () => {},
  ensureActionStates: async () => {},
});

export function PostListProvider({ children }: { children: React.ReactNode }) {
  const [postIds, setPostIds] = useState<number[]>([]);
  const [actionStates, setActionStatesState] = useState<Record<number, PostActionState>>({});

  // Track which IDs have already been fetched (or are in-flight) to avoid duplicate requests
  const fetchedRef = useRef(new Set<number>());
  // Guard against concurrent fetches for the same IDs
  const inFlightRef = useRef(new Set<number>());

  const setPosts = useCallback((p: Post[]) => setPostIds(p.map((x) => x.id)), []);

  // Pre-seed states (e.g. from user-posts.tsx where type is known).
  // Only fills IDs not yet authoritatively fetched from the API (not in fetchedRef),
  // so it never corrupts a properly-fetched or user-mutated state.
  const setActionStates = useCallback((states: Record<number, PostActionState>) => {
    setActionStatesState(prev => {
      const next = { ...prev };
      for (const [idStr, state] of Object.entries(states)) {
        const id = Number(idStr);
        if (!fetchedRef.current.has(id)) {
          next[id] = state;
        }
      }
      return next;
    });
  }, []);

  const updateActionState = useCallback((postId: number, state: PostActionState) => {
    setActionStatesState(prev => ({ ...prev, [postId]: state }));
    fetchedRef.current.add(postId); // mark as known so ensureActionStates won't overwrite
  }, []);

  const ensureActionStates = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    const missing = ids.filter(
      id => !fetchedRef.current.has(id) && !inFlightRef.current.has(id)
    );
    if (missing.length === 0) return;

    // Mark as in-flight immediately to prevent concurrent duplicate requests
    missing.forEach(id => inFlightRef.current.add(id));

    try {
      let states: Record<number, PostActionState> = {};
      try {
        states = await api.getPostActionStates(missing);
      } catch {
        // Fallback: individual calls for small batches
        await Promise.all(
          missing.map(id =>
            api.getPostActionState(id)
              .then(s => { states[id] = s; })
              .catch(() => { states[id] = { isLiked: false, isBookmarked: false, isSuperLiked: false }; })
          )
        );
      }
      // Detect IDs user-mutated during in-flight: updateActionState adds to fetchedRef
      // but we haven't added `missing` to fetchedRef yet, so any missing ID already in
      // fetchedRef at this point was mutated by the user while we were awaiting the API.
      const userMutatedDuringFlight = new Set(
        missing.filter(id => fetchedRef.current.has(id))
      );
      // Now mark all fetched IDs as done
      missing.forEach(id => {
        fetchedRef.current.add(id);
        inFlightRef.current.delete(id);
      });
      // Apply API results — API wins so all three flags (liked+bookmarked+superliked)
      // reflect the real server state, overwriting any partial pre-seeded values.
      // Skip IDs the user mutated while we were awaiting to preserve their optimistic update.
      setActionStatesState(prev => {
        const next = { ...prev };
        for (const [idStr, state] of Object.entries(states)) {
          const id = Number(idStr);
          if (!userMutatedDuringFlight.has(id)) {
            next[id] = state;
          }
        }
        return next;
      });
    } catch {
      missing.forEach(id => inFlightRef.current.delete(id));
    }
  }, []);

  return (
    <PostListContext.Provider value={{ postIds, setPosts, actionStates, setActionStates, updateActionState, ensureActionStates }}>
      {children}
    </PostListContext.Provider>
  );
}

export function usePostList() {
  return useContext(PostListContext);
}
