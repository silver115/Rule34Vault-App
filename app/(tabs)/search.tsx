import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import api, { Tag } from "../../api/rule34vault";
import { Colors, FontSize, getTagColor, Radius, Spacing } from "../../constants/theme";
import { useAppTheme } from "../../contexts/ThemeContext";

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function storageSet(key: string, val: string): Promise<void> {
  if (Platform.OS === "web") { localStorage.setItem(key, val); return; }
  await SecureStore.setItemAsync(key, val);
}

async function storageDel(key: string): Promise<void> {
  if (Platform.OS === "web") { localStorage.removeItem(key); return; }
  await SecureStore.deleteItemAsync(key);
}

const RECENT_KEY = "search_recent_tags";
const MAX_RECENT = 10;

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [trendingTags, setTrendingTags] = useState<Tag[]>([]);
  const [recentTags, setRecentTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    loadTrending();
    loadRecent();
  }, []);

  async function loadTrending() {
    try {
      const data = await api.getTrendingTags();
      setTrendingTags(data);
    } catch {}
  }

  async function loadRecent() {
    try {
      const raw = await storageGet(RECENT_KEY);
      if (raw) setRecentTags(JSON.parse(raw));
    } catch {}
  }

  async function saveRecent(tag: Tag) {
    try {
      const prev = recentTags.filter((t) => t.id !== tag.id);
      const next = [tag, ...prev].slice(0, MAX_RECENT);
      setRecentTags(next);
      await storageSet(RECENT_KEY, JSON.stringify(next));
    } catch {}
  }

  async function clearRecent() {
    setRecentTags([]);
    await storageDel(RECENT_KEY);
  }

  const searchTags = useCallback(async (q: string) => {
    if (!q.trim()) {
      setTags([]);
      setHasSearched(false);
      return;
    }
    setIsLoading(true);
    setHasSearched(true);
    try {
      const data = await api.searchTags(q.trim());
      setTags(data);
    } catch {}
    finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchTags(query), 400);
    return () => clearTimeout(timer);
  }, [query, searchTags]);

  const { colors } = useAppTheme();

  // Decide what to show
  const showRecent = !hasSearched && recentTags.length > 0;
  const displayTags = hasSearched ? tags : trendingTags;
  const sectionTitle = hasSearched ? `Results (${tags.length})` : "Trending Tags";

  function navigateToTag(item: Tag) {
    saveRecent(item);
    router.push({ pathname: "/tag/[id]", params: { id: String(item.id), name: item.value } });
  }

  function renderTag({ item }: { item: Tag }) {
    const color = getTagColor(item.type);
    return (
      <Pressable
        style={({ pressed }) => [styles.tagRow, { backgroundColor: colors.bgCard }, pressed && { opacity: 0.75 }]}
        onPress={() => navigateToTag(item)}
      >
        <View style={[styles.tagDot, { backgroundColor: color }]} />
        <View style={styles.tagInfo}>
          <Text style={[styles.tagName, { color }]}>{item.value}</Text>
          <Text style={[styles.tagCount, { color: colors.textMuted }]}>
            {formatCount(item.count)} posts
            {item.popularity ? ` · ${formatCount(item.popularity)} popular` : ""}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>
    );
  }

  function renderRecentTag({ item }: { item: Tag }) {
    return (
      <Pressable
        style={({ pressed }) => [styles.tagRow, { backgroundColor: colors.bgCard }, pressed && { opacity: 0.75 }]}
        onPress={() => navigateToTag(item)}
      >
        <Ionicons name="time-outline" size={16} color={colors.textMuted} />
        <View style={styles.tagInfo}>
          <Text style={[styles.tagName, { color: colors.text }]}>{item.value}</Text>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => setRecentTags((prev) => {
            const next = prev.filter((t) => t.id !== item.id);
            storageSet(RECENT_KEY, JSON.stringify(next)).catch(() => {});
            return next;
          })}
        >
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </Pressable>
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.searchBar, { backgroundColor: colors.bgTertiary, borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder="Search tags..."
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Recent searches section */}
      {showRecent && (
        <>
          <View style={styles.sectionRow}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginHorizontal: 0 }]}>Recent</Text>
            <Pressable onPress={clearRecent} hitSlop={8}>
              <Text style={[styles.clearBtn, { color: colors.accent }]}>Clear</Text>
            </Pressable>
          </View>
          <FlatList
            data={recentTags}
            renderItem={renderRecentTag}
            keyExtractor={(item) => `recent-${item.id}`}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            scrollEnabled={false}
          />
        </>
      )}

      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{sectionTitle}</Text>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={displayTags}
          renderItem={renderTag}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            hasSearched ? (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.empty, { color: colors.textMuted }]}>No tags found for "{query}"</Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  clearBtn: {
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: Spacing.xxl,
    gap: Spacing.sm,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgTertiary,
    margin: Spacing.md,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    height: 44,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSize.md,
    height: "100%",
  },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  list: {
    paddingHorizontal: Spacing.md,
    paddingBottom: 100,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.xs,
    gap: Spacing.md,
  },
  tagDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tagInfo: {
    flex: 1,
    gap: 2,
  },
  tagName: {
    fontSize: FontSize.md,
    fontWeight: "600",
  },
  tagCount: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  empty: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: "center",
    paddingVertical: Spacing.xxl,
  },
});
