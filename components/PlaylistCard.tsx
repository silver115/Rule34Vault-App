import React, { memo } from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Playlist, getMediaUrl } from "../api/rule34vault";
import { Colors, Radius, Spacing, FontSize } from "../constants/theme";

interface PlaylistCardProps {
  playlist: Playlist;
}

function PlaylistCardInner({ playlist }: PlaylistCardProps) {
  const router = useRouter();
  const thumbUrl = playlist.lastPost
    ? getMediaUrl(playlist.lastPost, "thumb")
    : null;

  return (
    <Pressable
      onPress={() => router.push(`/playlist/${playlist.id}`)}
      style={styles.card}
    >
      <View style={styles.thumbWrap}>
        {thumbUrl ? (
          <Image
            source={{ uri: thumbUrl }}
            style={styles.thumb}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[styles.thumb, styles.noThumb]}>
            <Ionicons name="images-outline" size={28} color={Colors.textMuted} />
          </View>
        )}
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{playlist.items}</Text>
        </View>
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {playlist.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {playlist.user?.displayName ?? "Unknown"} · {playlist.items} items
        </Text>
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Ionicons name="heart" size={12} color={Colors.textMuted} />
            <Text style={styles.statText}>{playlist.likes}</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="eye" size={12} color={Colors.textMuted} />
            <Text style={styles.statText}>{playlist.views}</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="people" size={12} color={Colors.textMuted} />
            <Text style={styles.statText}>{playlist.followers}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export const PlaylistCard = memo(PlaylistCardInner);

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
    overflow: "hidden",
  },
  thumbWrap: {
    width: 100,
    height: 100,
    position: "relative",
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  noThumb: {
    backgroundColor: Colors.bgTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  countBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: Radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  countText: {
    color: "#fff",
    fontSize: FontSize.xs,
    fontWeight: "700",
  },
  info: {
    flex: 1,
    padding: Spacing.md,
    justifyContent: "center",
    gap: Spacing.xs,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: "700",
  },
  sub: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
  stats: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: 2,
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  statText: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },
});
