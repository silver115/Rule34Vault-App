import React, { useState, useCallback } from "react";
import { Pressable, Text, StyleSheet, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import api, { Tag } from "../api/rule34vault";
import { useAuth } from "../contexts/AuthContext";
import { Colors, Radius, Spacing, FontSize, getTagColor } from "../constants/theme";

interface TagChipProps {
  tag: Tag;
  onPress?: (tag: Tag) => void;
  compact?: boolean;
}

export function TagChip({ tag, onPress, compact }: TagChipProps) {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const color = getTagColor(tag.type);
  const [subState, setSubState] = useState<"subscribed" | "unsubscribed" | null>(null);

  function handlePress() {
    if (onPress) {
      onPress(tag);
    } else {
      router.push({ pathname: "/tag/[id]", params: { id: String(tag.id), name: tag.value } });
    }
  }

  const handleLongPress = useCallback(async () => {
    if (!isLoggedIn) return;

    try {
      // Check current subscription status
      const subs = await api.getActiveTagSubscriptions();
      const isSubscribed = subs.some((t) => t.id === tag.id);

      const action = isSubscribed ? "Unsubscribe from" : "Subscribe to";
      const tagLabel = `#${tag.value}`;

      if (Platform.OS === "web") {
        const confirmed = window.confirm(`${action} ${tagLabel}?`);
        if (!confirmed) return;
        if (isSubscribed) {
          await api.unsubscribeFromTag(tag.id);
          setSubState("unsubscribed");
        } else {
          await api.subscribeToTag(tag.id);
          setSubState("subscribed");
        }
      } else {
        Alert.alert(
          `${action} ${tagLabel}?`,
          isSubscribed
            ? "You will stop receiving feed updates for this tag."
            : "You will receive feed updates when new posts are added with this tag.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: isSubscribed ? "Unsubscribe" : "Subscribe",
              style: isSubscribed ? "destructive" : "default",
              onPress: async () => {
                try {
                  if (isSubscribed) {
                    await api.unsubscribeFromTag(tag.id);
                    setSubState("unsubscribed");
                  } else {
                    await api.subscribeToTag(tag.id);
                    setSubState("subscribed");
                  }
                } catch {
                  Alert.alert("Error", "Failed to update subscription. Try again.");
                }
              },
            },
          ]
        );
      }
    } catch {
      if (Platform.OS === "web") {
        window.alert("Failed to check subscription status.");
      } else {
        Alert.alert("Error", "Failed to check subscription status.");
      }
    }
  }, [tag, isLoggedIn]);

  const isHighlighted = subState === "subscribed";
  const isUnsubbed = subState === "unsubscribed";

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={isLoggedIn ? handleLongPress : undefined}
      delayLongPress={400}
      style={[
        styles.chip,
        { borderColor: color },
        compact && styles.compact,
        isHighlighted && { backgroundColor: color + "30", borderColor: color },
        isUnsubbed && { opacity: 0.6 },
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
