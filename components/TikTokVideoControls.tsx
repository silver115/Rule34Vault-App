import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Animated,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Colors } from "../constants/theme";

interface TikTokVideoControlsProps {
  post: { id: number; type: number };
  mediaUrl: string;
  videoPosterUrl?: string;
  screenW: number;
  screenH: number;
  displayH: number;
  isActive: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  onVideoError?: () => void;
  onVideoSuccess?: () => void;
}

export function TikTokVideoControls({
  post,
  mediaUrl,
  videoPosterUrl,
  screenW,
  screenH,
  displayH,
  isActive,
  isMuted,
  onToggleMute,
  onVideoError,
  onVideoSuccess,
}: TikTokVideoControlsProps) {
  const videoRef = useRef<any>(null);
  const webVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaError, setMediaError] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackWidthRef = useRef(300);

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  const handleSeek = useCallback(
    (frac: number) => {
      const seekTo = Math.max(0, Math.min(1, frac)) * duration;
      if (Platform.OS === "web" && webVideoRef.current) {
        webVideoRef.current.currentTime = seekTo / 1000;
        setPosition(seekTo);
      } else if (videoRef.current) {
        videoRef.current.setPositionAsync(seekTo);
      }
    },
    [duration],
  );

  const togglePlay = useCallback(() => {
    if (mediaError) return;
    setIsPlaying((p) => !p);
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  }, [mediaError]);

  // Auto-play when active
  useEffect(() => {
    if (isActive && !mediaError) {
      setIsPlaying(true);
    } else if (!isActive) {
      setIsPlaying(false);
    }
  }, [isActive, mediaError]);

  // Control video based on isPlaying state
  useEffect(() => {
    try {
      if (Platform.OS === "web" && webVideoRef.current) {
        const v = webVideoRef.current;
        v.muted = isMuted;
        if (isPlaying) {
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      }
      if (Platform.OS !== "web" && videoRef.current) {
        if (isPlaying) {
          videoRef.current.playAsync?.().catch?.(() => {});
        } else {
          videoRef.current.pauseAsync?.().catch?.(() => {});
        }
      }
    } catch (e) {
      console.warn("[TikTokVideoControls] Video control error:", e);
    }
  }, [isPlaying, isMuted]);

  // Update position/duration
  const updateStatus = useCallback(() => {
    if (Platform.OS === "web" && webVideoRef.current) {
      setPosition(webVideoRef.current.currentTime * 1000);
      setDuration(webVideoRef.current.duration * 1000);
    } else if (videoRef.current) {
      videoRef.current
        .getStatusAsync()
        .then((status: any) => {
          setPosition(status.positionMillis || 0);
          setDuration(status.durationMillis || 0);
          if (status.isLoaded && !mediaError) {
            onVideoSuccess?.();
          }
        })
        .catch(() => {});
    }
  }, [mediaError, onVideoSuccess]);

  useEffect(() => {
    const interval = setInterval(updateStatus, 250);
    return () => clearInterval(interval);
  }, [updateStatus]);

  return (
    <View
      style={{
        width: screenW,
        height: displayH,
        backgroundColor: "#000",
        position: "relative",
      }}
    >
      {mediaError ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={48} color="#666" />
          <Text style={styles.errorText}>Failed to load video</Text>
        </View>
      ) : (
        <>
          {Platform.OS === "web" ? (
            <video
              ref={(el: HTMLVideoElement | null) => {
                webVideoRef.current = el;
              }}
              src={mediaUrl}
              poster={videoPosterUrl}
              style={{
                width: screenW,
                height: displayH,
                objectFit: "contain",
                backgroundColor: "#000",
              }}
              muted={isMuted}
              playsInline
              onLoadedMetadata={onVideoSuccess}
              onError={onVideoError}
              onTimeUpdate={updateStatus}
            />
          ) : (
            <Video
              ref={videoRef}
              source={{ uri: mediaUrl }}
              style={{ width: screenW, height: displayH }}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={isPlaying}
              isMuted={isMuted}
              useNativeControls={false}
              onPlaybackStatusUpdate={updateStatus}
              onError={onVideoError}
              onLoad={onVideoSuccess}
            />
          )}

          {/* Center play/pause button (shows when controls visible or paused) */}
          {(!isPlaying || showControls) && (
            <Animated.View style={styles.controlsOverlay}>
              <Pressable style={styles.centreBtn} onPress={togglePlay}>
                <Ionicons
                  name={isPlaying ? "pause" : "play"}
                  size={44}
                  color="white"
                />
              </Pressable>
            </Animated.View>
          )}

          {/* Bottom player bar */}
          <View
            style={[styles.playerBar, { bottom: 8 }]}
            pointerEvents="box-none"
          >
            <View style={styles.scrubRow} pointerEvents="box-none">
              <Text style={styles.timeText}>{fmt(position)}</Text>
              <View
                style={styles.scrubTrack}
                onLayout={(e) => {
                  trackWidthRef.current = e.nativeEvent.layout.width || 300;
                }}
              >
                <View style={[styles.scrubFill, { width: `${progress}%` }]} />
                <View
                  style={styles.scrubHitArea}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(e) =>
                    handleSeek(e.nativeEvent.locationX / trackWidthRef.current)
                  }
                  onResponderMove={(e) =>
                    handleSeek(e.nativeEvent.locationX / trackWidthRef.current)
                  }
                  onResponderRelease={(e) =>
                    handleSeek(e.nativeEvent.locationX / trackWidthRef.current)
                  }
                />
              </View>
              <Text style={styles.timeText}>{fmt(duration)}</Text>
              <Pressable
                onPress={onToggleMute}
                style={styles.muteBtn}
                hitSlop={8}
              >
                <Ionicons
                  name={isMuted ? "volume-mute" : "volume-high"}
                  size={18}
                  color="white"
                />
              </Pressable>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  errorBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  errorText: { color: "#666", fontSize: 14 },

  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  centreBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },

  playerBar: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingBottom: 8,
    paddingTop: 6,
    backgroundColor: "linear-gradient(transparent, rgba(0,0,0,0.7))",
  },
  scrubRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  timeText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "600",
    minWidth: 32,
    textAlign: "center",
  },
  scrubTrack: {
    flex: 1,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 2,
    overflow: "visible",
  },
  scrubFill: {
    height: "100%",
    backgroundColor: Colors.accent,
    borderRadius: 2,
  },
  scrubHitArea: {
    position: "absolute",
    top: -14,
    left: 0,
    right: 0,
    bottom: -14,
  },
  muteBtn: {
    padding: 4,
  },
});
