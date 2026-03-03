import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import api, { Playlist } from "../../api/rule34vault";
import { PlaylistCard } from "../../components/PlaylistCard";
import { SkeletonLoader } from "../../components/SkeletonLoader";
import { Colors, FontSize, Spacing } from "../../constants/theme";
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
  const { width } = useWindowDimensions();

  if (isLoading && playlists.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={[styles.skeletonRow, { backgroundColor: colors.bgCard }]}>
            <SkeletonLoader width={56} height={56} style={{ borderRadius: 8 }} />
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonLoader width="70%" height={14} />
              <SkeletonLoader width="40%" height={11} />
            </View>
          </View>
        ))}
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
          <View style={styles.emptyState}>
            <Ionicons name="list-outline" size={56} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Playlists</Text>
            <Text style={[styles.empty, { color: colors.textMuted }]}>Create playlists on rule34vault.com</Text>
          </View>
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
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 10,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: Spacing.xxl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: "700",
  },
});
