import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import api, { Tag } from "../../api/rule34vault";
import { Colors, Radius, Spacing, FontSize, getTagColor } from "../../constants/theme";
import { useAppTheme } from "../../contexts/ThemeContext";

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [trendingTags, setTrendingTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    loadTrending();
  }, []);

  async function loadTrending() {
    try {
      const data = await api.getTrendingTags();
      setTrendingTags(data);
    } catch (e) {
      console.error("Failed to load trending tags:", e);
    }
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
    } catch (e) {
      console.error("Failed to search tags:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchTags(query), 400);
    return () => clearTimeout(timer);
  }, [query, searchTags]);

  const { colors } = useAppTheme();

  const displayTags = hasSearched ? tags : trendingTags;
  const sectionTitle = hasSearched
    ? `Results (${tags.length})`
    : "Trending Tags";

  function renderTag({ item }: { item: Tag }) {
    const color = getTagColor(item.type);
    return (
      <Pressable
        style={[styles.tagRow, { backgroundColor: colors.bgCard }]}
        onPress={() => router.push({ pathname: "/tag/[id]", params: { id: String(item.id), name: item.value } })}
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
          <Pressable onPress={() => setQuery("")}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

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
              <Text style={styles.empty}>No tags found for "{query}"</Text>
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
