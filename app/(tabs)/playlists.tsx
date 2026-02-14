import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Text,
  RefreshControl,
} from "react-native";
import api, { Playlist } from "../../api/rule34vault";
import { PlaylistCard } from "../../components/PlaylistCard";
import { Colors, Spacing, FontSize } from "../../constants/theme";
import { useAppTheme } from "../../contexts/ThemeContext";

export default function PlaylistsScreen() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);

  const loadPlaylists = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setIsLoading(true);
        cursorRef.current = null;
        hasMoreRef.current = true;
      } else {
        if (!hasMoreRef.current || isLoadingMore) return;
        setIsLoadingMore(true);
      }

      try {
        const data = await api.searchPlaylists(
          20,
          refresh ? null : cursorRef.current
        );
        if (refresh) {
          setPlaylists(data.items);
        } else {
          setPlaylists((prev) => [...prev, ...data.items]);
        }
        cursorRef.current = data.cursor;
        if (!data.items.length || !data.cursor) hasMoreRef.current = false;
      } catch (e) {
        console.error("Failed to load playlists:", e);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [isLoadingMore]
  );

  useEffect(() => {
    loadPlaylists(true);
  }, []);

  const { colors } = useAppTheme();

  if (isLoading && playlists.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <FlatList
        data={playlists}
        renderItem={({ item }) => <PlaylistCard playlist={item} />}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={() => loadPlaylists(false)}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textMuted }]}>No playlists found</Text>
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={isLoading && playlists.length > 0}
            onRefresh={() => loadPlaylists(true)}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.bgSecondary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  list: {
    paddingVertical: Spacing.sm,
    paddingBottom: 100,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.bg,
  },
  empty: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: "center",
    paddingVertical: Spacing.xxl,
  },
  footer: {
    paddingVertical: Spacing.lg,
    alignItems: "center",
  },
});
