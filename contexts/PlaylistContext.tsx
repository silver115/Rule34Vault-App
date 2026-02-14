import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { Platform } from "react-native";
import api, { Playlist } from "../api/rule34vault";
import { useAuth } from "./AuthContext";

interface PlaylistState {
  playlists: Playlist[];
  activePlaylist: Playlist | null;
  setActivePlaylist: (p: Playlist | null) => void;
  refreshPlaylists: () => Promise<void>;
  addPostToActive: (postId: number) => Promise<boolean>;
  removePostFromActive: (postId: number) => Promise<boolean>;
}

const PlaylistContext = createContext<PlaylistState>({
  playlists: [],
  activePlaylist: null,
  setActivePlaylist: () => {},
  refreshPlaylists: async () => {},
  addPostToActive: async () => false,
  removePostFromActive: async () => false,
});

const storage = {
  getItem(key: string): string | null {
    if (Platform.OS === "web") {
      try { return localStorage.getItem(key); } catch { return null; }
    }
    return null;
  },
  setItem(key: string, value: string) {
    if (Platform.OS === "web") {
      try { localStorage.setItem(key, value); } catch {}
    }
  },
};

export function PlaylistProvider({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuth();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activePlaylist, setActivePlaylistState] = useState<Playlist | null>(null);

  const refreshPlaylists = useCallback(async () => {
    if (!isLoggedIn) { setPlaylists([]); return; }
    try {
      const resp = await api.getMyPlaylists(50);
      setPlaylists(resp.items);
      // Restore active playlist from storage
      const storedId = storage.getItem("r34v_active_playlist");
      if (storedId) {
        const found = resp.items.find((p) => p.id === Number(storedId));
        if (found) setActivePlaylistState(found);
      }
    } catch {
      setPlaylists([]);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) refreshPlaylists();
    else {
      setPlaylists([]);
      setActivePlaylistState(null);
    }
  }, [isLoggedIn]);

  const setActivePlaylist = useCallback((p: Playlist | null) => {
    setActivePlaylistState(p);
    if (p) storage.setItem("r34v_active_playlist", String(p.id));
    else storage.setItem("r34v_active_playlist", "");
  }, []);

  const addPostToActive = useCallback(async (postId: number): Promise<boolean> => {
    if (!activePlaylist) return false;
    try {
      await api.addToPlaylist(activePlaylist.id, postId);
      return true;
    } catch {
      return false;
    }
  }, [activePlaylist]);

  const removePostFromActive = useCallback(async (postId: number): Promise<boolean> => {
    if (!activePlaylist) return false;
    try {
      await api.removeFromPlaylist(activePlaylist.id, postId);
      return true;
    } catch {
      return false;
    }
  }, [activePlaylist]);

  const contextValue = useMemo(() => ({
    playlists, activePlaylist, setActivePlaylist, refreshPlaylists, addPostToActive, removePostFromActive,
  }), [playlists, activePlaylist, setActivePlaylist, refreshPlaylists, addPostToActive, removePostFromActive]);

  return (
    <PlaylistContext.Provider value={contextValue}>
      {children}
    </PlaylistContext.Provider>
  );
}

export function usePlaylist() {
  return useContext(PlaylistContext);
}
