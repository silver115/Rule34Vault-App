import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import api, { SearchFilters, Tag } from "../api/rule34vault";
import { Colors, Radius, Spacing, FontSize, getTagColor } from "../constants/theme";

interface FilterBarProps {
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  hideTagInput?: boolean;
}

const TYPE_OPTIONS = [
  { label: "All", value: null, icon: "apps" as const },
  { label: "Images", value: 0, icon: "image" as const },
  { label: "Videos", value: 1, icon: "videocam" as const },
];

const HOT_RANGE_OPTIONS = [
  { label: "Default", value: -1, icon: "list" as const },
  { label: "All Time", value: 0, icon: "infinite" as const },
  { label: "Daily", value: 1, icon: "today" as const },
  { label: "Weekly", value: 7, icon: "calendar" as const },
  { label: "Monthly", value: 30, icon: "calendar-outline" as const },
];

export function FilterBar({ filters, onFiltersChange, hideTagInput }: FilterBarProps) {
  const [rangeOpen, setRangeOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [suggestions, setSuggestions] = useState<Tag[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentRange = filters.postedFromDays != null ? filters.postedFromDays : -1;
  const rangeLabel = HOT_RANGE_OPTIONS.find((o) => o.value === currentRange)?.label ?? "Hot";
  const tags = useMemo(() => filters.includeTags ?? [], [filters.includeTags]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (tagInput.length >= 1) {
      debounceRef.current = setTimeout(async () => {
        try {
          const results = await api.searchTags(tagInput);
          setSuggestions(results.filter(
            (t) => !tags.includes(t.value.toLowerCase())
          ).slice(0, 10));
        } catch {
          setSuggestions([]);
        }
      }, 200);
    } else {
      setSuggestions((prev) => prev.length === 0 ? prev : []);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [tagInput, tags]);

  function addTag(tagValue: string) {
    const normalized = tagValue.trim().toLowerCase();
    if (!normalized || tags.includes(normalized)) return;
    onFiltersChange({ ...filters, includeTags: [...tags, normalized] });
    setTagInput("");
    setSuggestions([]);
  }

  function removeTag(tagValue: string) {
    onFiltersChange({
      ...filters,
      includeTags: tags.filter((t) => t !== tagValue),
    });
  }

  function handleSubmit() {
    if (tagInput.trim()) addTag(tagInput);
  }

  return (
    <View style={styles.container}>
      {/* Row 1: Type chips + Score dropdown */}
      <View style={styles.row}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {TYPE_OPTIONS.map((opt) => {
            const active =
              filters.type === opt.value ||
              (opt.value === null && filters.type == null);
            return (
              <Pressable
                key={opt.label}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => onFiltersChange({ ...filters, type: opt.value })}
              >
                <Ionicons
                  name={opt.icon}
                  size={14}
                  color={active ? "#fff" : Colors.textSecondary}
                />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}

          {/* Hot range dropdown trigger */}
          <Pressable
            style={[styles.chip, currentRange >= 0 && styles.chipActive]}
            onPress={() => setRangeOpen(!rangeOpen)}
          >
            <Ionicons
              name="flame"
              size={14}
              color={currentRange >= 0 ? "#fff" : Colors.textSecondary}
            />
            <Text style={[styles.chipText, currentRange >= 0 && styles.chipTextActive]}>
              {rangeLabel}
            </Text>
            <Ionicons
              name={rangeOpen ? "chevron-up" : "chevron-down"}
              size={12}
              color={currentRange >= 0 ? "#fff" : Colors.textSecondary}
            />
          </Pressable>
        </ScrollView>
      </View>

      {/* Hot range dropdown panel */}
      {rangeOpen && (
        <View style={styles.dropdown}>
          {HOT_RANGE_OPTIONS.map((opt) => {
            const active = currentRange === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                onPress={() => {
                  if (opt.value === -1) {
                    // Default: clear hot range and reset sort
                    const { postedFromDays, sortBy, ...rest } = filters;
                    onFiltersChange(rest);
                  } else {
                    onFiltersChange({
                      ...filters,
                      postedFromDays: opt.value === 0 ? undefined : opt.value,
                      sortBy: opt.value >= 0 ? 1 : filters.sortBy,
                    });
                  }
                  setRangeOpen(false);
                }}
              >
                <Ionicons name={opt.icon} size={16} color={active ? Colors.accent : Colors.textSecondary} />
                <Text style={[styles.dropdownText, active && styles.dropdownTextActive]}>
                  {opt.label}
                </Text>
                {active && <Ionicons name="checkmark" size={16} color={Colors.accent} />}
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Row 2: Tag search input + active tag chips */}
      {!hideTagInput && (
        <View style={styles.tagSection}>
          <View style={styles.tagInputRow}>
            <Ionicons name="pricetag" size={14} color={Colors.textMuted} />
            <TextInput
              style={styles.tagInput}
              placeholder="Search tags to filter..."
              placeholderTextColor={Colors.textMuted}
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={handleSubmit}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
            {tagInput.length > 0 && (
              <Pressable onPress={handleSubmit} style={styles.addBtn}>
                <Ionicons name="add-circle" size={22} color={Colors.accent} />
              </Pressable>
            )}
          </View>

          {/* Autocomplete / trending suggestions */}
          {suggestions.length > 0 && (
            <View style={styles.suggestionsBox}>
              {suggestions.map((tag) => (
                <Pressable
                  key={tag.id}
                  style={styles.suggestionItem}
                  onPress={() => addTag(tag.value)}
                >
                  <View
                    style={[styles.tagDot, { backgroundColor: getTagColor(tag.type) }]}
                  />
                  <Text style={styles.suggestionText}>{tag.value}</Text>
                  <Text style={styles.suggestionCount}>
                    {tag.count > 1000
                      ? `${(tag.count / 1000).toFixed(1)}K`
                      : tag.count}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Active tag chips */}
          {tags.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.activeTagsRow}
            >
              {tags.map((t) => (
                <Pressable
                  key={t}
                  style={styles.activeTag}
                  onPress={() => removeTag(t)}
                >
                  <Text style={styles.activeTagText}>{t}</Text>
                  <Ionicons name="close-circle" size={14} color={Colors.textSecondary} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    zIndex: 50,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  chipRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.bgTertiary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  chipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: "500",
  },
  chipTextActive: {
    color: "#fff",
  },
  // Score dropdown
  dropdown: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  dropdownItemActive: {
    backgroundColor: Colors.bgTertiary,
  },
  dropdownText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  dropdownTextActive: {
    color: Colors.accent,
    fontWeight: "600",
  },
  // Tag section
  tagSection: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    zIndex: 100,
  },
  tagInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgTertiary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
    height: 36,
  },
  tagInput: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    paddingVertical: 0,
  },
  addBtn: {
    padding: 2,
  },
  // Suggestions
  suggestionsBox: {
    marginTop: 4,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    maxHeight: 280,
  },
  suggestionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  suggestionsHeaderText: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tagDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  suggestionText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  suggestionCount: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  // Active tags
  activeTagsRow: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  activeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.accent + "22",
    borderWidth: 1,
    borderColor: Colors.accent + "55",
  },
  activeTagText: {
    fontSize: FontSize.xs,
    color: Colors.accentLight,
    fontWeight: "500",
  },
});
