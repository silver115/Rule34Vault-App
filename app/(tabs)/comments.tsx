import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import api, { PostComment, getAvatarUrl } from "../../api/rule34vault";
import { useAppTheme } from "../../contexts/ThemeContext";
import { Colors, Radius, Spacing, FontSize } from "../../constants/theme";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function Avatar({ userId, avatarModifyDate, size = 40 }: { userId: number; avatarModifyDate?: string | null; size?: number }) {
  const uri = avatarModifyDate ? getAvatarUrl(userId, avatarModifyDate, size > 64 ? 256 : 128) : null;
  const [err, setErr] = useState(false);
  const r = size / 2;

  if (!uri || err) {
    return (
      <View style={{ width: size, height: size, borderRadius: r, backgroundColor: Colors.bgTertiary, justifyContent: "center", alignItems: "center" }}>
        <Ionicons name="person" size={size * 0.5} color={Colors.textMuted} />
      </View>
    );
  }
  if (Platform.OS === "web") {
    return (
      <img
        src={uri}
        style={{ width: size, height: size, borderRadius: r, objectFit: "cover", display: "block" }}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: r }}
      contentFit="cover"
      cachePolicy="memory-disk"
      onError={() => setErr(true)}
    />
  );
}

function PostImage({ postId, width }: { postId: number; width: number }) {
  const bucket = Math.floor(postId / 1000);
  const cdnUri = `https://r34xyz.b-cdn.net/posts/${bucket}/${postId}/${postId}.thumbnail.jpg`;
  const directUri = `https://rule34vault.com/posts/${bucket}/${postId}/${postId}.thumbnail.jpg`;
  const [src, setSrc] = useState(cdnUri);
  const [err, setErr] = useState(false);
  const triedFallback = useRef(false);
  const h = Math.round(width * 0.56);

  if (err) {
    return (
      <View style={[styles.postImagePlaceholder, { width, height: h }]}>
        <Ionicons name="image-outline" size={32} color={Colors.textMuted} />
      </View>
    );
  }
  if (Platform.OS === "web") {
    return (
      <img
        src={src}
        style={{ width, height: h, objectFit: "cover", display: "block", borderRadius: 0 }}
        onError={() => {
          if (!triedFallback.current) { triedFallback.current = true; setSrc(directUri); }
          else setErr(true);
        }}
      />
    );
  }
  return (
    <Image
      source={{ uri: src }}
      style={{ width, height: h }}
      contentFit="cover"
      cachePolicy="memory-disk"
      onError={() => {
        if (!triedFallback.current) { triedFallback.current = true; setSrc(directUri); }
        else setErr(true);
      }}
    />
  );
}

export default function CommentsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { width: screenW } = useWindowDimensions();
  const cardW = screenW - Spacing.md * 2;
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);

  const loadComments = useCallback(async (refresh = false) => {
    if (!refresh && !hasMoreRef.current) return;
    if (refresh) {
      setRefreshing(true);
      cursorRef.current = null;
      hasMoreRef.current = true;
    } else {
      setLoadingMore(true);
    }

    try {
      const cursor = refresh ? undefined : cursorRef.current;
      const resp = await api.getRecentComments(20, cursor);
      if (refresh) {
        setComments(resp.items);
      } else {
        setComments((prev) => {
          const existingIds = new Set(prev.map((c) => c.id));
          const newItems = resp.items.filter((c) => !existingIds.has(c.id));
          return [...prev, ...newItems];
        });
      }
      cursorRef.current = resp.cursor;
      hasMoreRef.current = !!resp.cursor;
    } catch (e) {
      console.error("Failed to load comments:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadComments(true);
  }, []);

  const renderComment = useCallback(({ item }: { item: PostComment }) => {
    const user = item.user;
    const displayName = user?.displayName || user?.userName || `User #${item.userId}`;
    const userName = user?.userName;

    return (
      <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
        {/* Post image — tappable hero banner */}
        <Pressable
          onPress={() => router.push({ pathname: "/post/[id]", params: { id: String(item.postId) } })}
        >
          <PostImage postId={item.postId} width={cardW} />
          <View style={styles.postIdBadge}>
            <Text style={styles.postIdText}>#{item.postId}</Text>
          </View>
        </Pressable>

        {/* Comment content below */}
        <View style={styles.cardBody}>
          {/* User row: avatar + name + time */}
          <View style={styles.userRow}>
            <Pressable
              style={styles.userInfo}
              onPress={() => userName && router.push({ pathname: "/user/[username]", params: { username: userName } })}
            >
              <Avatar
                userId={item.userId}
                avatarModifyDate={user?.avatarModifyDate}
                size={40}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.displayName, { color: colors.text }]} numberOfLines={1}>
                  {displayName}
                </Text>
                {userName && (
                  <Text style={[styles.userName, { color: colors.textSecondary }]} numberOfLines={1}>
                    @{userName}
                  </Text>
                )}
              </View>
            </Pressable>
            <Text style={[styles.timeAgo, { color: colors.textMuted }]}>
              {timeAgo(item.created)}
            </Text>
          </View>

          {/* Reply indicator */}
          {item.parentId && (
            <View style={[styles.replyIndicator, { backgroundColor: colors.accent + "15", borderLeftColor: colors.accent }]}>
              <Ionicons name="return-down-forward" size={13} color={colors.accent} />
              <Text style={[styles.replyIndicatorText, { color: colors.accent }]}>Reply to a comment</Text>
            </View>
          )}

          {/* Comment text */}
          <Text style={[styles.commentText, { color: colors.text }]}>
            {item.content}
          </Text>

          {/* Footer actions */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <View style={styles.footerChip}>
              <Ionicons name="heart" size={14} color={item.likes > 0 ? Colors.like : colors.textMuted} />
              <Text style={[styles.footerText, { color: item.likes > 0 ? Colors.like : colors.textMuted }]}>
                {item.likes}
              </Text>
            </View>
            <View style={styles.footerChip}>
              <Ionicons name="heart-dislike" size={14} color={item.dislikes > 0 ? Colors.danger : colors.textMuted} />
              <Text style={[styles.footerText, { color: item.dislikes > 0 ? Colors.danger : colors.textMuted }]}>
                {item.dislikes}
              </Text>
            </View>
            <View style={styles.footerChip}>
              <Ionicons name="chatbubble-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.footerText, { color: colors.textMuted }]}>
                {item.childrenCount}
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <Pressable
              style={styles.viewPostBtn}
              onPress={() => router.push({ pathname: "/post/[id]", params: { id: String(item.postId) } })}
            >
              <Text style={[styles.viewPostText, { color: colors.accent }]}>View Post</Text>
              <Ionicons name="open-outline" size={13} color={colors.accent} />
            </Pressable>
          </View>
        </View>
      </View>
    );
  }, [colors, router, cardW]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <FlatList
        data={comments}
        renderItem={renderComment}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={() => loadComments(false)}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="chatbubbles-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>No comments found</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: Spacing.lg, alignItems: "center" }}>
              <ActivityIndicator size="small" color={Colors.accent} />
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadComments(true)}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
            progressBackgroundColor={colors.bgSecondary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: Spacing.md, padding: Spacing.xl },
  list: { padding: Spacing.md, paddingBottom: 100, gap: Spacing.lg },
  emptyText: { fontSize: FontSize.lg },

  card: {
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
  postImagePlaceholder: {
    backgroundColor: Colors.bgTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  postIdBadge: {
    position: "absolute",
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  postIdText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: FontSize.xs,
    fontWeight: "700",
  },

  cardBody: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  userInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  displayName: {
    fontSize: FontSize.lg,
    fontWeight: "700",
  },
  userName: {
    fontSize: FontSize.sm,
    marginTop: 1,
  },
  timeAgo: {
    fontSize: FontSize.sm,
  },

  replyIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    borderLeftWidth: 3,
  },
  replyIndicatorText: {
    fontSize: FontSize.sm,
    fontWeight: "600",
  },

  commentText: {
    fontSize: FontSize.lg,
    lineHeight: 26,
  },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    marginTop: Spacing.xs,
  },
  footerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  footerText: {
    fontSize: FontSize.md,
    fontWeight: "600",
  },
  viewPostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewPostText: {
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
});
