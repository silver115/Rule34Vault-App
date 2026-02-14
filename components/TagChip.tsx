import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Tag } from "../api/rule34vault";
import { Colors, Radius, Spacing, FontSize, getTagColor } from "../constants/theme";

interface TagChipProps {
  tag: Tag;
  onPress?: (tag: Tag) => void;
  compact?: boolean;
}

export function TagChip({ tag, onPress, compact }: TagChipProps) {
  const router = useRouter();
  const color = getTagColor(tag.type);

  function handlePress() {
    if (onPress) {
      onPress(tag);
    } else {
      router.push({ pathname: "/tag/[id]", params: { id: String(tag.id), name: tag.value } });
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      style={[
        styles.chip,
        { borderColor: color },
        compact && styles.compact,
      ]}
    >
      <Text style={[styles.text, { color }, compact && styles.compactText]}>
        {tag.value}
      </Text>
      {!compact && tag.count > 0 && (
        <Text style={styles.count}>{formatCount(tag.count)}</Text>
      )}
    </Pressable>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
    backgroundColor: Colors.bgTertiary,
  },
  compact: {
    paddingHorizontal: Spacing.xs + 2,
    paddingVertical: 2,
  },
  text: {
    fontSize: FontSize.sm,
    fontWeight: "500",
  },
  compactText: {
    fontSize: FontSize.xs,
  },
  count: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
});
