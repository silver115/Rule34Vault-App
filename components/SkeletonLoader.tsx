import React, { useEffect, useRef } from "react";
import { Animated, View, StyleSheet } from "react-native";
import { useAppTheme } from "../contexts/ThemeContext";
import { Radius, Spacing } from "../constants/theme";

interface SkeletonLoaderProps {
  width?: number | string;
  height?: number | string;
  style?: any;
  variant?: "rect" | "circle";
}

export function SkeletonLoader({
  width = "100%",
  height = 20,
  style,
  variant = "rect",
}: SkeletonLoaderProps) {
  const { colors } = useAppTheme();
  const animatedValue = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 0.7,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [animatedValue]);

  const skeletonStyle = {
    width,
    height,
    backgroundColor: colors.bgTertiary,
    borderRadius: variant === "circle" ? 999 : Radius.sm,
    overflow: "hidden" as const,
  };

  return (
    <Animated.View
      style={[
        skeletonStyle,
        {
          opacity: animatedValue,
        },
        style,
      ]}
    />
  );
}

interface PostCardSkeletonProps {
  cardWidth: number;
  cardHeight: number;
}

export function PostCardSkeleton({ cardWidth, cardHeight }: PostCardSkeletonProps) {
  const { colors } = useAppTheme();
  const animatedValue = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 0.7,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [animatedValue]);

  return (
    <Animated.View
      style={[
        styles.cardSkeleton,
        {
          width: cardWidth,
          height: cardHeight,
          backgroundColor: colors.bgCard,
          opacity: animatedValue,
        },
      ]}
    >
      <View style={styles.skeletonContent}>
        <View style={styles.videoBadge} />
        <View style={styles.likesBadge} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cardSkeleton: {
    borderRadius: Radius.md,
    margin: Spacing.sm / 2,
    overflow: "hidden",
  },
  skeletonContent: {
    flex: 1,
    backgroundColor: "#1a1a28",
  },
  videoBadge: {
    position: "absolute",
    top: Spacing.xs,
    right: Spacing.xs,
    width: 40,
    height: 20,
    backgroundColor: "#2a2a40",
    borderRadius: Radius.sm,
  },
  likesBadge: {
    position: "absolute",
    bottom: Spacing.xs,
    left: Spacing.xs,
    width: 30,
    height: 16,
    backgroundColor: "#2a2a40",
    borderRadius: Radius.sm,
  },
});
