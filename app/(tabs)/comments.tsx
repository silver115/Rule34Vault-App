import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import Constants from "expo-constants";
import api, { PostComment, getAvatarUrl } from "../../api/rule34vault";
import { detectSpamComments, resetSpamCache, fetchSharedBlocklist, reportSpamToServer, runDistributedScanCycle, getDistributedScanStatus, DistScanResult, isBlocklisted, getBlocklistSize } from "../../utils/spamFilter";
import { useAuth } from "../../contexts/AuthContext";
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

interface SpamGroup {
  content_norm: string;
  content_preview: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

function SpamPanel({ colors, onClose, authToken }: { colors: any; onClose: () => void; authToken: string | null }) {
  const [groups, setGroups] = useState<SpamGroup[]>([]);
  const [totalBlocked, setTotalBlocked] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedNorm, setExpandedNorm] = useState<string | null>(null);
  const [expandedComments, setExpandedComments] = useState<any[]>([]);
  const [loadingExpand, setLoadingExpand] = useState(false);
  const PUSH_URL = Constants.expoConfig?.extra?.pushServerUrl || "";

  // Distributed scan state
  const [scanning, setScanning] = useState(false);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanCycles, setScanCycles] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);
  const [scanSpam, setScanSpam] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [distStatus, setDistStatus] = useState<any>(null);
  const scanAbortRef = useRef(false);

  useEffect(() => {
    if (!PUSH_URL) { setLoading(false); return; }
    Promise.all([
      fetch(`${PUSH_URL}/api/spam/groups`).then((r) => r.json()).catch(() => null),
      getDistributedScanStatus().catch(() => null),
    ]).then(([groupData, distData]) => {
      if (groupData) {
        setGroups(groupData.groups || []);
        setTotalBlocked(groupData.totalBlocked || 0);
      }
      if (distData) setDistStatus(distData);
    }).finally(() => setLoading(false));
  }, []);

  const handleExpand = useCallback(async (norm: string) => {
    if (expandedNorm === norm) { setExpandedNorm(null); return; }
    setExpandedNorm(norm);
    setLoadingExpand(true);
    try {
      const resp = await fetch(`${PUSH_URL}/api/spam/group/${encodeURIComponent(norm)}`);
      const data = await resp.json();
      setExpandedComments(data.comments || []);
    } catch { setExpandedComments([]); }
    finally { setLoadingExpand(false); }
  }, [expandedNorm, PUSH_URL]);

  // Run continuous scan cycles
  const startHelping = useCallback(async () => {
    if (!authToken || scanRunning) return;
    setScanRunning(true);
    setScanError(null);
    scanAbortRef.current = false;

    let cycles = 0;
    let total = 0;
    let spam = 0;

    while (!scanAbortRef.current) {
      const result = await runDistributedScanCycle(authToken);
      cycles++;
      setScanCycles(cycles);

      if (!result.success) {
        if (result.error?.includes("No more comments")) {
          setScanError("Scan complete — no more comments to process!");
          break;
        }
        setScanError(result.error || "Unknown error");
        break;
      }

      total += result.commentsProcessed;
      spam += result.newSpamAdded;
      setScanTotal(total);
      setScanSpam(spam);

      // Small delay between cycles to be gentle
      await new Promise((r) => setTimeout(r, 2000));
    }

    setScanRunning(false);
    // Refresh status
    try {
      const newStatus = await getDistributedScanStatus();
      if (newStatus) setDistStatus(newStatus);
    } catch {} // Ignore if endpoints not available
  }, [authToken, scanRunning]);

  const stopHelping = useCallback(() => {
    scanAbortRef.current = true;
  }, []);

  return (
    <View style={[spamStyles.panel, { backgroundColor: colors.bgCard }]}>
      {/* Header */}
      <View style={[spamStyles.panelHeader, { borderBottomColor: colors.border }]}>
        <View style={spamStyles.panelHeaderLeft}>
          <Ionicons name="shield-checkmark" size={18} color={Colors.accent} />
          <View>
            <Text style={[spamStyles.panelTitle, { color: colors.text }]}>Spam Filter</Text>
            <Text style={[spamStyles.panelSubtitle, { color: colors.textMuted }]}>
              {totalBlocked.toLocaleString()} comments blocked
            </Text>
          </View>
        </View>
        <Pressable onPress={onClose} hitSlop={12}>
          <Ionicons name="close-circle" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Help Scan Section - only show if distributed endpoints are available */}
      {distStatus && (
        <View style={[spamStyles.helpSection, { borderBottomColor: colors.border }]}>
          <View style={spamStyles.helpHeader}>
            <Ionicons name="people" size={16} color={Colors.accent} />
            <Text style={[spamStyles.helpTitle, { color: colors.text }]}>Help Scan</Text>
          </View>
          <Text style={[spamStyles.helpDesc, { color: colors.textMuted }]}>
            Your device fetches comments and the server detects spam. All results are verified server-side.
          </Text>

          <View style={spamStyles.statsRow}>
            <View style={spamStyles.statItem}>
              <Text style={[spamStyles.statValue, { color: colors.text }]}>{(distStatus.totalScanned || 0).toLocaleString()}</Text>
              <Text style={[spamStyles.statLabel, { color: colors.textMuted }]}>Scanned</Text>
            </View>
            <View style={spamStyles.statItem}>
              <Text style={[spamStyles.statValue, { color: Colors.danger }]}>{(distStatus.totalSpam || 0).toLocaleString()}</Text>
              <Text style={[spamStyles.statLabel, { color: colors.textMuted }]}>Spam</Text>
            </View>
            <View style={spamStyles.statItem}>
              <Text style={[spamStyles.statValue, { color: Colors.accent }]}>{distStatus.activeWorkers || 0}</Text>
              <Text style={[spamStyles.statLabel, { color: colors.textMuted }]}>Workers</Text>
            </View>
          </View>

          {scanRunning && (
            <View style={spamStyles.scanProgress}>
              <ActivityIndicator size="small" color={Colors.accent} />
              <Text style={[spamStyles.scanProgressText, { color: colors.textSecondary }]}>
                Cycle {scanCycles} — {scanTotal} comments, {scanSpam} spam found
              </Text>
            </View>
          )}

          {scanError && (
            <Text style={[spamStyles.scanError, { color: scanError.includes("complete") ? Colors.accent : Colors.danger }]}>
              {scanError}
            </Text>
          )}

          {authToken ? (
            <Pressable
              style={[spamStyles.helpBtn, scanRunning && spamStyles.helpBtnStop]}
              onPress={scanRunning ? stopHelping : startHelping}
            >
              <Ionicons
                name={scanRunning ? "stop-circle" : "flash"}
                size={16}
                color="#fff"
              />
              <Text style={spamStyles.helpBtnText}>
                {scanRunning ? "Stop Helping" : "Start Helping"}
              </Text>
            </Pressable>
          ) : (
            <Text style={[spamStyles.helpLoginMsg, { color: colors.textMuted }]}>
              Log in to help scan for spam
            </Text>
          )}
        </View>
      )}

      {/* Spam Groups */}
      {loading ? (
        <ActivityIndicator size="small" color={Colors.accent} style={{ padding: Spacing.lg }} />
      ) : groups.length === 0 ? (
        <Text style={[spamStyles.emptyMsg, { color: colors.textMuted }]}>
          No spam groups detected yet. Help scan or wait for the auto-scan.
        </Text>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.content_norm}
          style={{ maxHeight: 300 }}
          renderItem={({ item: g }) => {
            const isExpanded = expandedNorm === g.content_norm;
            return (
              <View>
                <Pressable
                  style={[spamStyles.groupRow, { borderBottomColor: colors.border },
                    isExpanded && { backgroundColor: colors.accent + "10" }]}
                  onPress={() => handleExpand(g.content_norm)}
                >
                  <View style={spamStyles.groupInfo}>
                    <Text style={[spamStyles.groupPreview, { color: colors.text }]} numberOfLines={2}>
                      {g.content_preview || g.content_norm}
                    </Text>
                    <Text style={[spamStyles.groupMeta, { color: colors.textMuted }]}>
                      Last seen {timeAgo(g.last_seen)}
                    </Text>
                  </View>
                  <View style={spamStyles.groupRight}>
                    <View style={spamStyles.countBadge}>
                      <Text style={spamStyles.countText}>{g.count.toLocaleString()}</Text>
                    </View>
                    <Ionicons
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={14}
                      color={colors.textMuted}
                    />
                  </View>
                </Pressable>
                {isExpanded && (
                  <View style={[spamStyles.expandedSection, { backgroundColor: colors.bg }]}>
                    {loadingExpand ? (
                      <ActivityIndicator size="small" color={Colors.accent} style={{ padding: Spacing.sm }} />
                    ) : expandedComments.length === 0 ? (
                      <Text style={[spamStyles.expandedEmpty, { color: colors.textMuted }]}>No details available</Text>
                    ) : (
                      expandedComments.slice(0, 20).map((c: any) => (
                        <View key={c.comment_id} style={[spamStyles.expandedRow, { borderBottomColor: colors.border }]}>
                          <Text style={[spamStyles.expandedId, { color: colors.textMuted }]}>#{c.comment_id}</Text>
                          <Text style={[spamStyles.expandedPreview, { color: colors.textSecondary }]} numberOfLines={1}>
                            {c.content_preview}
                          </Text>
                          <Text style={[spamStyles.expandedUser, { color: colors.textMuted }]}>
                            User {c.user_id}
                          </Text>
                        </View>
                      ))
                    )}
                    {expandedComments.length > 20 && (
                      <Text style={[spamStyles.moreText, { color: colors.textMuted }]}>
                        +{expandedComments.length - 20} more...
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

export default function CommentsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { token: authToken } = useAuth();
  const { width: screenW } = useWindowDimensions();
  const cardW = screenW - Spacing.md * 2;
  const [allComments, setAllComments] = useState<PostComment[]>([]);
  const [spamIds, setSpamIds] = useState<Set<number>>(new Set());
  const [showSpam, setShowSpam] = useState(false);
  const [spamPanelOpen, setSpamPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const isLoadingRef = useRef(false);

  const recomputeSpam = useCallback((comments: PostComment[]) => {
    const result = detectSpamComments(comments);
    setSpamIds(result.spamIds);
    // Auto-report locally detected spam to shared blocklist
    if (result.spamIds.size > 0) {
      reportSpamToServer([...result.spamIds], authToken ?? null);
    }
  }, [authToken]);

  const visibleComments = useMemo(() => {
    if (showSpam) return allComments;
    return allComments.filter((c) => !spamIds.has(c.id));
  }, [allComments, spamIds, showSpam]);

  const spamCount = spamIds.size;

  const [serverSkipped, setServerSkipped] = useState(0);

  const loadComments = useCallback(async (refresh = false) => {
    if (isLoadingRef.current) return;
    if (!refresh && !hasMoreRef.current) return;
    isLoadingRef.current = true;
    if (refresh) {
      setRefreshing(true);
      cursorRef.current = null;
      hasMoreRef.current = true;
      resetSpamCache();
      setServerSkipped(0);
    } else {
      setLoadingMore(true);
    }

    try {
      let prev = refresh ? [] : allComments;
      let existingIds = new Set(prev.map((c) => c.id));
      let collected: PostComment[] = [];
      let skipped = 0;
      let cursor: string | undefined = refresh ? undefined : (cursorRef.current ?? undefined);
      const MIN_CLEAN = 10; // Keep fetching until we have at least this many clean new comments
      const MAX_PAGES = 5;  // Max pages to fetch per load call to avoid hammering

      for (let page = 0; page < MAX_PAGES; page++) {
        const resp = await api.getRecentComments(20, cursor);
        if (!resp.items || resp.items.length === 0) {
          hasMoreRef.current = false;
          break;
        }

        for (const c of resp.items) {
          if (existingIds.has(c.id)) continue;
          // Skip comments already in the server blocklist — don't even store them
          if (isBlocklisted(c.id)) {
            skipped++;
            continue;
          }
          existingIds.add(c.id);
          collected.push(c);
        }

        cursor = resp.cursor ?? undefined;
        cursorRef.current = resp.cursor;
        hasMoreRef.current = !!resp.cursor;

        // If we've collected enough clean comments, stop
        if (collected.length >= MIN_CLEAN) break;
        // If no more pages, stop
        if (!resp.cursor) break;
      }

      const updated = [...prev, ...collected];
      setAllComments(updated);
      recomputeSpam(updated);
      setServerSkipped((prev) => prev + skipped);
    } catch (e) {
      console.error("Failed to load comments:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      isLoadingRef.current = false;
    }
  }, [allComments, recomputeSpam]);

  useEffect(() => {
    // Fetch shared blocklist first, then load comments
    fetchSharedBlocklist().finally(() => loadComments(true));
  }, []);

  const renderComment = useCallback(({ item }: { item: PostComment }) => {
    const user = item.user;
    const displayName = user?.displayName || user?.userName || `User #${item.userId}`;
    const userName = user?.userName;
    const isSpam = spamIds.has(item.id);

    return (
      <View style={[styles.card, { backgroundColor: colors.bgCard }, isSpam && { opacity: 0.6 }]}>
        {/* SPAM badge */}
        {isSpam && (
          <View style={styles.spamTagBadge}>
            <Ionicons name="warning" size={10} color="#fff" />
            <Text style={styles.spamTagText}>SPAM</Text>
          </View>
        )}
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
  }, [colors, router, cardW, spamIds]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {(spamCount > 0 || serverSkipped > 0) && (
        <View style={[styles.spamBanner, { backgroundColor: colors.bgCard, borderBottomColor: colors.border }]}>
          {spamCount > 0 && (
            <Pressable
              style={styles.spamBannerBtn}
              onPress={() => setShowSpam(!showSpam)}
            >
              <Ionicons name={showSpam ? "eye-off" : "eye"} size={14} color={Colors.accent} />
              <Text style={[styles.spamBannerText, { color: colors.textSecondary }]}>
                {showSpam ? "Hide" : "Show"} {spamCount} spam
              </Text>
            </Pressable>
          )}
          {serverSkipped > 0 && (
            <View style={styles.spamBannerBtn}>
              <Ionicons name="shield-checkmark" size={14} color={Colors.accent} />
              <Text style={[styles.spamBannerText, { color: colors.textSecondary }]}>
                {serverSkipped} skipped
              </Text>
            </View>
          )}
          <Pressable
            style={styles.spamBannerBtn}
            onPress={() => setSpamPanelOpen(!spamPanelOpen)}
          >
            <Ionicons name="analytics" size={14} color={Colors.accent} />
            <Text style={[styles.spamBannerText, { color: colors.textSecondary }]}>Details</Text>
          </Pressable>
        </View>
      )}
      {spamPanelOpen && (
        <SpamPanel colors={colors} onClose={() => setSpamPanelOpen(false)} authToken={authToken} />
      )}
      <FlatList
        data={visibleComments}
        renderItem={renderComment}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={() => loadComments(false)}
        onEndReachedThreshold={0.4}
        removeClippedSubviews={true}
        maxToRenderPerBatch={6}
        windowSize={5}
        initialNumToRender={5}
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
  spamBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  spamBannerText: {
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  spamTagBadge: {
    position: "absolute",
    top: Spacing.sm,
    left: Spacing.sm,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(220,50,50,0.85)",
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  spamTagText: {
    color: "#fff",
    fontSize: FontSize.xs,
    fontWeight: "700",
  },
  spamBannerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
});

// ── Spam panel styles ────────────────────────────────────────────────
const spamStyles = StyleSheet.create({
  panel: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  panelHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  panelTitle: {
    fontSize: FontSize.md,
    fontWeight: "700",
  },
  panelSubtitle: {
    fontSize: FontSize.xs,
  },
  emptyMsg: {
    fontSize: FontSize.sm,
    textAlign: "center",
    padding: Spacing.lg,
  },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupInfo: {
    flex: 1,
    gap: 2,
  },
  groupPreview: {
    fontSize: FontSize.sm,
  },
  groupMeta: {
    fontSize: FontSize.xs,
  },
  groupRight: {
    alignItems: "center",
    gap: 4,
    marginLeft: Spacing.sm,
  },
  countBadge: {
    backgroundColor: "rgba(220,50,50,0.85)",
    borderRadius: Radius.full,
    minWidth: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  countText: {
    color: "#fff",
    fontSize: FontSize.xs,
    fontWeight: "700",
  },
  expandedSection: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  expandedEmpty: {
    fontSize: FontSize.xs,
    textAlign: "center",
    padding: Spacing.sm,
  },
  expandedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  expandedId: {
    fontSize: FontSize.xs,
    fontWeight: "600",
    width: 60,
  },
  expandedPreview: {
    flex: 1,
    fontSize: FontSize.xs,
  },
  expandedUser: {
    fontSize: FontSize.xs,
  },
  moreText: {
    fontSize: FontSize.xs,
    textAlign: "center",
    paddingVertical: Spacing.sm,
  },
  // Help Scan section
  helpSection: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    gap: Spacing.xs,
  },
  helpHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  helpTitle: {
    fontSize: FontSize.md,
    fontWeight: "700",
  },
  helpDesc: {
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: Spacing.xs,
  },
  statItem: {
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    fontSize: FontSize.lg,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: FontSize.xs,
  },
  scanProgress: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  scanProgressText: {
    fontSize: FontSize.xs,
    flex: 1,
  },
  scanError: {
    fontSize: FontSize.xs,
    paddingVertical: Spacing.xs,
  },
  helpBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  helpBtnStop: {
    backgroundColor: Colors.danger,
  },
  helpBtnText: {
    color: "#fff",
    fontSize: FontSize.sm,
    fontWeight: "700",
  },
  helpLoginMsg: {
    fontSize: FontSize.xs,
    textAlign: "center",
    paddingVertical: Spacing.sm,
  },
});
