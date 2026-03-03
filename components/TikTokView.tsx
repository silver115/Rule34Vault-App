import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    AppState,
    FlatList,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Post, PostComment, api, getAvatarUrl, getMediaUrl } from '../api/rule34vault';
import { Colors } from '../constants/theme';
import { useAuth } from '../contexts/AuthContext';
import { sendAttentionSignal, sendRecSignal } from '../utils/recommendations';
import { ZoomableImage } from './ZoomableImage';

const IMAGE_MAX_SEC = 30;
const DURATION_CAP_SEC = 90;

const fmt = (ms: number) => {
  if (!ms || isNaN(ms) || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};

interface TikTokViewProps {
  post: Post;
  isActive: boolean;
  onVideoEnd?: () => void;
  onVideoError?: () => void;
  initialActionState?: { isLiked: boolean; isBookmarked: boolean; isSuperLiked: boolean };
  onActionStateChange?: (postId: number, state: { isLiked: boolean; isBookmarked: boolean; isSuperLiked: boolean }) => void;
  /** Measured height of the feed container — avoids fragile manual SH-TAB-insets math */
  containerHeight?: number;
}

export function TikTokView({ post, isActive, onVideoEnd, onVideoError, initialActionState, onActionStateChange, containerHeight }: TikTokViewProps) {
  const { width: SW, height: SH } = useWindowDimensions();
  const { user, isLoggedIn, token } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const TAB_BAR_HEIGHT = 56;
  // Use the measured container height when available — it is device-accurate.
  // Fall back to manual calculation only if no containerHeight was passed.
  const H = containerHeight ?? (SH - TAB_BAR_HEIGHT - insets.bottom);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false); // auto-play with audio
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [isLiked, setIsLiked] = useState(initialActionState?.isLiked ?? false);
  const [isSuperLiked, setIsSuperLiked] = useState(initialActionState?.isSuperLiked ?? false);
  // keep ref in sync
  useEffect(() => { isLikedRef.current = isLiked; }, [isLiked]);
  const [isBookmarked, setIsBookmarked] = useState(initialActionState?.isBookmarked ?? false);
  const [likeCount, setLikeCount] = useState(post.likes || 0);
  const [bookmarkCount, setBookmarkCount] = useState(0);

  // Sync from context when initialActionState arrives or changes (e.g. prefetch resolves)
  useEffect(() => {
    if (!initialActionState) return;
    // Always sync when the post changes, or when state arrives for the first time
    setIsLiked(initialActionState.isLiked);
    setIsSuperLiked(initialActionState.isSuperLiked);
    setIsBookmarked(initialActionState.isBookmarked);
  }, [initialActionState?.isLiked, initialActionState?.isSuperLiked, initialActionState?.isBookmarked, post.id]);

  const videoRef = useRef<any>(null);
  const hideTimer = useRef<NodeJS.Timeout | null>(null);
  const controlsAnim = useRef(new Animated.Value(0)).current;
  const trackWidthRef = useRef<number>(300);

  // ── Active-time-only attention tracking ──────────────────────
  const accumulatedMs = useRef<number>(0);
  const segmentStart  = useRef<number>(0);
  const peakCompletionRef = useRef<number>(0);
  // Use ref for isLiked so flushAttention doesn't change on every like toggle
  const isLikedRef = useRef(false);
  // Replay tracking: count how many times video loops back to start while active
  const replayCount  = useRef<number>(0);
  const lastPositionRef = useRef<number>(0);

  const startSegment = useCallback(() => {
    if (segmentStart.current === 0) segmentStart.current = Date.now();
  }, []);

  const pauseSegment = useCallback(() => {
    if (segmentStart.current > 0) {
      accumulatedMs.current += Date.now() - segmentStart.current;
      segmentStart.current = 0;
    }
  }, []);

  const mediaUrl = getMediaUrl(post, 'full', true);
  const isVideo = post.type === 1;
  const isTallImage = !isVideo && post.width > 0 && (post.height / post.width) > 2.0;
  const naturalComicHeight = isTallImage ? Math.round(SW * (post.height / post.width)) : H;
  const [comicOpen, setComicOpen] = useState(false);

  const flushAttention = useCallback(() => {
    pauseSegment();
    if (!token) return;
    let durationSec = accumulatedMs.current / 1000;
    durationSec = Math.min(durationSec, post.type === 1 ? DURATION_CAP_SEC : IMAGE_MAX_SEC);
    // < 3s = not enough data to form an opinion; send nothing (immediate scroll = no signal)
    if (durationSec >= 3) {
      sendAttentionSignal(token, post.id, post.tags ?? [], durationSec, peakCompletionRef.current, isLikedRef.current, replayCount.current);
    }
    accumulatedMs.current = 0;
    peakCompletionRef.current = 0;
    replayCount.current = 0;
    lastPositionRef.current = 0;
  }, [pauseSegment, token, post.type, post.id, post.tags]); // isLiked intentionally via ref
  const userAvatarUrl = user ? getAvatarUrl(user.id, user.avatarModifyDate, 128) : null;

  // ── Play / Pause helpers ─────────────────────────────────────
  const videoPlay = useCallback(() => {
    if (!videoRef.current) return;
    if (Platform.OS === 'web') {
      (videoRef.current as HTMLVideoElement).play?.().catch(() => {});
    } else {
      videoRef.current.playAsync?.();
    }
  }, []);

  const videoPause = useCallback(() => {
    if (!videoRef.current) return;
    if (Platform.OS === 'web') {
      (videoRef.current as HTMLVideoElement).pause?.();
    } else {
      videoRef.current.pauseAsync?.();
    }
  }, []);

  // Auto-play/pause + start/stop attention timer
  useEffect(() => {
    if (isActive) {
      if (isVideo) { videoPlay(); setIsPlaying(true); startSegment(); }
      else { startSegment(); } // images: start counting immediately
    } else {
      if (isVideo) { videoPause(); setIsPlaying(false); }
      flushAttention(); // sends signal and resets accumulators
    }
  }, [isActive, isVideo, videoPlay, videoPause, startSegment, flushAttention]);

  // Pause timer when video is paused by user, resume when played
  useEffect(() => {
    if (!isActive || !isVideo) return;
    if (isPlaying) startSegment();
    else pauseSegment();
  }, [isPlaying, isActive, isVideo, startSegment, pauseSegment]);

  // ── AppState: pause timer when app goes to background (native) ─
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state: string) => {
      if (state !== 'active') pauseSegment();
      else if (isActive) startSegment();
    });
    return () => sub.remove();
  }, [isActive, pauseSegment, startSegment]);

  // ── Visibility API: pause timer when tab is hidden (web) ──────
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const handler = () => {
      if (document.hidden) pauseSegment();
      else if (isActive) startSegment();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [isActive, pauseSegment, startSegment]);

  // ── Controls visibility ──────────────────────────────────────
  const hideControls = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(controlsAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
      setShowControls(false);
    }, 3000);
  }, [controlsAnim]);

  const showControlsNow = useCallback(() => {
    setShowControls(true);
    Animated.timing(controlsAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    hideControls();
  }, [controlsAnim, hideControls]);

  const handleTap = useCallback(() => {
    if (!isVideo) return;
    if (showControls) {
      if (isPlaying) { videoPause(); setIsPlaying(false); }
      else { videoPlay(); setIsPlaying(true); }
      hideControls();
    } else {
      showControlsNow();
    }
  }, [isVideo, showControls, isPlaying, videoPlay, videoPause, showControlsNow, hideControls]);

  // ── Seek ─────────────────────────────────────────────────────
  const handleSeek = useCallback((fraction: number) => {
    if (duration <= 0 || isNaN(duration)) return;
    const t = Math.max(0, Math.min(1, fraction)) * duration;
    setPosition(t);
    if (!videoRef.current) return;
    try {
      if (Platform.OS === 'web') {
        (videoRef.current as HTMLVideoElement).currentTime = t / 1000;
      } else {
        videoRef.current.setPositionAsync?.(t);
      }
    } catch {}
  }, [duration]);

  // ── Mute ─────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const next = !isMuted;
    if (Platform.OS === 'web' && videoRef.current) {
      (videoRef.current as HTMLVideoElement).muted = next;
    } else if (videoRef.current) {
      try { videoRef.current.setIsMutedAsync?.(next); } catch {}
    }
    setIsMuted(next);
  }, [isMuted]);

  // ── Native playback status (non-web) ─────────────────────────
  const onPlaybackStatus = useCallback((s: any) => {
    if (!s.isLoaded) return;
    const dur = s.durationMillis || 0;
    const pos = s.positionMillis || 0;
    setDuration(dur);
    setPosition(pos);
    setIsPlaying(s.isPlaying || false);
    // Track peak completion rate for attention signal
    if (dur > 0) {
      const completion = pos / dur;
      if (completion > peakCompletionRef.current) peakCompletionRef.current = completion;
      // Detect replay: position resets to near start while previously past 10%
      if (lastPositionRef.current > dur * 0.10 && pos < dur * 0.05 && s.isPlaying) {
        replayCount.current += 1;
      }
      lastPositionRef.current = pos;
    }
    if (s.didJustFinish && !s.isLooping) onVideoEnd?.();
  }, [onVideoEnd]);

  // ── Like / Bookmark ──────────────────────────────────────────
  const handleLike = useCallback(async () => {
    if (!isLoggedIn) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !isLiked;
    setIsLiked(next);
    if (!next) setIsSuperLiked(false);
    setLikeCount(c => next ? c + 1 : Math.max(0, c - 1));
    try {
      if (next) {
        await api.likePost(post.id);
        if (token && post.tags) sendRecSignal(token, post.id, 'like', post.tags);
      } else {
        await api.unlikePost(post.id);
      }
      onActionStateChange?.(post.id, { isLiked: next, isSuperLiked: next ? isSuperLiked : false, isBookmarked });
    } catch {
      setIsLiked(!next);
      if (!next) setIsSuperLiked(isSuperLiked);
      setLikeCount(post.likes || 0);
    }
  }, [isLiked, isSuperLiked, isBookmarked, isLoggedIn, post.id, post.likes, post.tags, token, onActionStateChange]);

  const handleSuperLike = useCallback(async () => {
    if (!isLoggedIn || isSuperLiked) return;
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsSuperLiked(true);
    setIsLiked(true);
    setLikeCount(c => isLiked ? c : c + 1);
    try {
      await api.superLikePost(post.id);
      if (token && post.tags) sendRecSignal(token, post.id, 'super_like', post.tags);
      onActionStateChange?.(post.id, { isLiked: true, isSuperLiked: true, isBookmarked });
    } catch {
      setIsSuperLiked(false);
    }
  }, [isLoggedIn, isSuperLiked, isLiked, isBookmarked, post.id, post.tags, token, onActionStateChange]);

  const handleBookmark = useCallback(async () => {
    if (!isLoggedIn) return;
    const next = !isBookmarked;
    setIsBookmarked(next);
    setBookmarkCount(c => next ? c + 1 : Math.max(0, c - 1));
    try {
      if (next) {
        await api.bookmarkPost(post.id);
        if (token && post.tags) sendRecSignal(token, post.id, 'bookmark', post.tags);
      } else {
        await api.unbookmarkPost(post.id);
      }
      onActionStateChange?.(post.id, { isLiked, isSuperLiked, isBookmarked: next });
    } catch {
      setIsBookmarked(!next);
      setBookmarkCount(c => next ? Math.max(0, c - 1) : c + 1);
    }
  }, [isBookmarked, isLiked, isSuperLiked, isLoggedIn, post.id, post.tags, token, onActionStateChange]);

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

  const handleComments = useCallback(() => {
    setCommentsOpen(true);
    setCommentsLoading(true);
    api.getPostComments(post.id, 50)
      .then((res) => setComments(res.items))
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }, [post.id]);

  const handleShare = useCallback(() => {
    const url = `https://rule34vault.com/post/${post.id}`;
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.share) {
        navigator.share({ title: `Post #${post.id}`, url }).catch(() => {
          navigator.clipboard?.writeText(url);
        });
      } else {
        navigator.clipboard?.writeText(url);
      }
    } else {
      Linking.openURL(url);
    }
  }, [post.id]);

  const handleProfile = useCallback(() => {
    router.push('/(tabs)/profile' as any);
  }, [router]);

  // ── Progress bar width fraction ──────────────────────────────
  const progress = duration > 0 && !isNaN(duration) && !isNaN(position)
    ? `${Math.min(100, Math.max(0, (position / duration) * 100))}%`
    : '0%';

  return (
    <View style={[styles.container, { width: SW, height: H }]}>

      {/* ── Media ─────────────────────────────────────────────── */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleTap}>
        {mediaError ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={48} color="#555" />
            <Text style={styles.errorText}>Failed to load</Text>
          </View>
        ) : isVideo ? (
          Platform.OS === 'web' ? (
            <video
              ref={videoRef}
              src={mediaUrl}
              style={{ width: SW, height: H, objectFit: 'contain', backgroundColor: '#000', display: 'block' }}
              autoPlay={isActive}
              loop
              muted={isMuted}
              onTimeUpdate={(e: any) => {
                const v = e.target as HTMLVideoElement;
                setPosition(v.currentTime * 1000);
                if (!isNaN(v.duration)) setDuration(v.duration * 1000);
                setIsPlaying(!v.paused);
                if (v.duration > 0) {
                  const c = v.currentTime / v.duration;
                  if (c > peakCompletionRef.current) peakCompletionRef.current = c;
                }
              }}
              onError={() => { setMediaError(true); onVideoError?.(); }}
            />
          ) : (
            <Video
              ref={videoRef}
              source={{ uri: mediaUrl }}
              style={{ width: SW, height: H }}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={isActive}
              isMuted={isMuted}
              isLooping
              onPlaybackStatusUpdate={onPlaybackStatus}
              onError={() => { setMediaError(true); onVideoError?.(); }}
            />
          )
        ) : isTallImage ? (
          // Tall comic/strip: show tiny contained preview + prominent Read button
          <>
            {Platform.OS === 'web' ? (
              <img
                src={mediaUrl}
                style={{ width: SW, height: H, objectFit: 'contain', backgroundColor: '#000', display: 'block' }}
                onError={() => setMediaError(true)}
              />
            ) : (
              <Image
                source={{ uri: mediaUrl }}
                style={{ width: SW, height: H }}
                contentFit="contain"
                onError={() => setMediaError(true)}
              />
            )}
            <Pressable
              style={styles.comicExpandBtn}
              onPress={() => setComicOpen(true)}
            >
              <Ionicons name="expand-outline" size={20} color="#fff" />
              <Text style={styles.comicExpandText}>Read</Text>
            </Pressable>
          </>
        ) : (
          Platform.OS === 'web' ? (
            <img
              src={mediaUrl}
              style={{ width: SW, height: H, objectFit: 'contain', backgroundColor: '#000', display: 'block' }}
              onError={() => setMediaError(true)}
            />
          ) : (
            <ZoomableImage
              uri={mediaUrl}
              width={SW}
              height={H}
              onError={() => setMediaError(true)}
            />
          )
        )}
      </Pressable>

      {/* ── Video Controls ────────────────────────────────────── */}
      {isVideo && !mediaError && (
        <Animated.View style={[styles.controlsOverlay, { opacity: showControls ? controlsAnim : 0.0 }]} pointerEvents={showControls ? 'box-none' : 'none'}>
          {/* Centre play/pause */}
          <Pressable style={styles.centreBtn} onPress={() => {
            if (isPlaying) { videoPause(); setIsPlaying(false); }
            else { videoPlay(); setIsPlaying(true); }
          }}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={44} color="white" />
          </Pressable>
        </Animated.View>
      )}

      {/* ── Bottom player bar (always visible for videos) ───── */}
      {isVideo && !mediaError && (
        <View style={[styles.playerBar, { bottom: 8 }]} pointerEvents="box-none">
          {/* Scrubber row */}
          <View style={styles.scrubRow} pointerEvents="box-none">
            <Text style={styles.timeText}>{fmt(position)}</Text>
            <View
              style={styles.scrubTrack}
              onLayout={(e) => { trackWidthRef.current = e.nativeEvent.layout.width || 300; }}
            >
              <View style={[styles.scrubFill, { width: progress as any }]} />
              {/* Tall transparent hit area for easy scrubbing */}
              <View
                style={styles.scrubHitArea}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(e) => handleSeek(e.nativeEvent.locationX / trackWidthRef.current)}
                onResponderMove={(e) => handleSeek(e.nativeEvent.locationX / trackWidthRef.current)}
                onResponderRelease={(e) => handleSeek(e.nativeEvent.locationX / trackWidthRef.current)}
              />
            </View>
            <Text style={styles.timeText}>{fmt(duration)}</Text>
            <Pressable onPress={toggleMute} style={styles.muteBtn} hitSlop={8}>
              <Ionicons name={isMuted ? 'volume-mute' : 'volume-high'} size={18} color="white" />
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Right-side actions ────────────────────────────────── */}
      <View style={[styles.rightSide, { bottom: 80 }]} pointerEvents="box-none">
        {/* Profile */}
        <Pressable style={styles.avatarBtn} onPress={handleProfile}>
          {userAvatarUrl ? (
            <Image source={{ uri: userAvatarUrl }} style={styles.avatarImg} contentFit="cover" />
          ) : (
            <Ionicons name="person" size={22} color="white" />
          )}
        </Pressable>

        {/* Like — long-press for super like */}
        <Pressable style={styles.sideBtn} onPress={handleLike} onLongPress={handleSuperLike} delayLongPress={400}>
          <Ionicons
            name={isSuperLiked ? 'heart-circle' : isLiked ? 'heart' : 'heart-outline'}
            size={30}
            color={isSuperLiked ? '#FFD700' : isLiked ? '#ff375f' : 'white'}
          />
          <Text style={[styles.sideBtnText, isSuperLiked && { color: '#FFD700' }]}>{likeCount}</Text>
        </Pressable>

        {/* Bookmark */}
        <Pressable style={styles.sideBtn} onPress={handleBookmark}>
          <Ionicons name={isBookmarked ? 'bookmark' : 'bookmark-outline'} size={28} color={isBookmarked ? Colors.accent : 'white'} />
          <Text style={styles.sideBtnText}>{bookmarkCount}</Text>
        </Pressable>

        {/* Comments */}
        <Pressable style={styles.sideBtn} onPress={handleComments}>
          <Ionicons name="chatbubble-ellipses-outline" size={28} color="white" />
          <Text style={styles.sideBtnText}>{post.comments || 0}</Text>
        </Pressable>

        {/* Share */}
        <Pressable style={styles.sideBtn} onPress={handleShare}>
          <Ionicons name="arrow-redo-outline" size={28} color="white" />
          <Text style={styles.sideBtnText}>Share</Text>
        </Pressable>
      </View>

      {/* ── Post info bottom-left ─────────────────────────────── */}
      <View style={[styles.postInfo, { bottom: isVideo ? 102 : 20 }]} pointerEvents="none">
        <Text style={styles.postId}>Post #{post.id}</Text>
        {post.tags && post.tags.length > 0 && (
          <Text style={styles.tags} numberOfLines={2}>
            {post.tags.slice(0, 4).map(t => `#${t.value}`).join('  ')}
          </Text>
        )}
      </View>
      {/* ── Comic Reader Modal ─────────────────────────── */}
      {isTallImage && (
        <Modal
          visible={comicOpen}
          transparent={false}
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => setComicOpen(false)}
        >
          <View style={styles.comicModal}>
            {/* Header bar */}
            <View style={styles.comicHeader}>
              <Text style={styles.comicHeaderTitle}>Post #{post.id}</Text>
              <Pressable onPress={() => setComicOpen(false)} hitSlop={12} style={styles.comicCloseBtn}>
                <Ionicons name="close" size={24} color="#fff" />
              </Pressable>
            </View>
            {Platform.OS === 'web' ? (
              // Web: overflow-y scroll div
              <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as any}>
                <img
                  src={mediaUrl}
                  style={{ width: '100%', display: 'block' }}
                />
              </div>
            ) : (
              // Native: ScrollView with image at full screen width for crisp quality
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ alignItems: 'center' }}
                showsVerticalScrollIndicator={true}
                bounces={false}
                scrollEventThrottle={16}
              >
                <Image
                  source={{ uri: mediaUrl }}
                  style={{ width: SW, height: naturalComicHeight }}
                  contentFit="fill"
                  cachePolicy="memory-disk"
                />
              </ScrollView>
            )}
          </View>
        </Modal>
      )}

      {/* ── Comments Sheet ────────────────────────────────── */}
      <Modal
        visible={commentsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCommentsOpen(false)}
      >
        <Pressable style={cStyles.backdrop} onPress={() => setCommentsOpen(false)} />
        <View style={cStyles.sheet}>
          <View style={cStyles.handle} />
          <View style={cStyles.header}>
            <Text style={cStyles.headerTitle}>{post.comments || 0} Comments</Text>
            <Pressable onPress={() => setCommentsOpen(false)} hitSlop={12}>
              <Text style={cStyles.closeBtn}>✕</Text>
            </Pressable>
          </View>
          {commentsLoading ? (
            <ActivityIndicator size="large" color={Colors.accent} style={{ marginTop: 40 }} />
          ) : comments.length === 0 ? (
            <Text style={cStyles.empty}>No comments yet</Text>
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(c) => String(c.id)}
              contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16 }}
              renderItem={({ item: c }) => {
                const name = c.user?.displayName || c.user?.userName || `User #${c.userId}`;
                const timeAgo = (() => {
                  const diff = Math.max(0, Date.now() - new Date(c.created).getTime());
                  const mins = Math.floor(diff / 60000);
                  if (mins < 1) return 'just now';
                  if (mins < 60) return `${mins}m ago`;
                  const hrs = Math.floor(mins / 60);
                  if (hrs < 24) return `${hrs}h ago`;
                  return `${Math.floor(hrs / 24)}d ago`;
                })();
                return (
                  <View style={cStyles.commentRow}>
                    <View style={cStyles.commentAvatar}>
                      <Text style={cStyles.commentAvatarText}>
                        {name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={cStyles.commentBody}>
                      <View style={cStyles.commentMeta}>
                        <Text style={cStyles.commentUser}>{name}</Text>
                        <Text style={cStyles.commentTime}>{timeAgo}</Text>
                      </View>
                      <Text style={cStyles.commentText}>{c.content}</Text>
                      {c.likes > 0 && (
                        <View style={cStyles.commentLikes}>
                          <Text style={cStyles.commentLikesText}>♥ {c.likes}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const cStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '75%',
    paddingTop: 8,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 18,
    fontWeight: '600',
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
  },
  commentRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  commentAvatarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  commentBody: {
    flex: 1,
    gap: 4,
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commentUser: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  commentTime: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
  },
  commentText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    lineHeight: 20,
  },
  commentLikes: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  commentLikesText: {
    color: 'rgba(255,100,100,0.8)',
    fontSize: 12,
    fontWeight: '600',
  },
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  errorBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  errorText: { color: '#666', fontSize: 14 },

  // Controls overlay (fade in/out)
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  centreBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Bottom player bar
  playerBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingBottom: 8,
    paddingTop: 6,
    backgroundColor: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
  },
  scrubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  timeText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'center',
  },
  scrubTrack: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2,
    overflow: 'visible',
  },
  scrubFill: {
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 2,
  },
  scrubHitArea: {
    position: 'absolute',
    top: -14,
    left: 0,
    right: 0,
    bottom: -14,
  },
  muteBtn: {
    padding: 4,
  },

  // Right side actions
  rightSide: {
    position: 'absolute',
    right: 12,
    alignItems: 'center',
    gap: 18,
  },
  avatarBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    overflow: 'hidden',
    backgroundColor: Colors.accent,
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  avatarImg: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  sideBtn: {
    alignItems: 'center',
    gap: 3,
  },
  sideBtnText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // Post info
  postInfo: {
    position: 'absolute',
    left: 12,
    right: 80,
  },
  postId: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  tags: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Comic / tall-image expand button (bottom-center overlay)
  comicExpandBtn: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  comicExpandText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Comic reader full-screen modal
  comicModal: {
    flex: 1,
    backgroundColor: '#000',
  },
  comicHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  comicHeaderTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  comicCloseBtn: {
    padding: 4,
  },
});
