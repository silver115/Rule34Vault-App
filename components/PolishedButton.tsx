import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
    Animated,
    Pressable,
    StyleSheet,
    Text,
    TextStyle,
    ViewStyle,
} from "react-native";
import { FontSize, Radius, Spacing } from "../constants/theme";
import { useAppTheme } from "../contexts/ThemeContext";

interface PolishedButtonProps {
  title?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  size?: "small" | "medium" | "large";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function PolishedButton({
  title,
  icon,
  onPress,
  variant = "primary",
  size = "medium",
  disabled = false,
  loading = false,
  style,
  textStyle,
}: PolishedButtonProps) {
  const { colors } = useAppTheme();
  const [scaleAnim] = useState(new Animated.Value(1));
  const [opacityAnim] = useState(new Animated.Value(1));

  const handlePressIn = () => {
    if (onPress) {
      onPress();
    }
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.96,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0.8,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handlePressOut = () => {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const getButtonStyle = (): ViewStyle => {
    const baseStyle: ViewStyle = {
      borderRadius: Radius.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.sm,
      overflow: "hidden",
    };

    // Size styles
    const sizeStyles = {
      small: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
      medium: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
      large: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg },
    };

    // Variant styles
    const variantStyles = {
      primary: {
        backgroundColor: colors.accent,
        shadowColor: colors.accent,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 3,
      },
      secondary: {
        backgroundColor: colors.bgCard,
        borderWidth: 1,
        borderColor: colors.border,
      },
      ghost: {
        backgroundColor: "transparent",
      },
    };

    return {
      ...baseStyle,
      ...sizeStyles[size],
      ...variantStyles[variant],
    };
  };

  const getTextStyle = (): TextStyle => {
    const baseStyle: TextStyle = {
      fontWeight: "600",
    };

    const sizeStyles = {
      small: { fontSize: FontSize.sm },
      medium: { fontSize: FontSize.md },
      large: { fontSize: FontSize.lg },
    };

    const variantStyles = {
      primary: { color: "#fff" },
      secondary: { color: colors.text },
      ghost: { color: colors.accent },
    };

    return {
      ...baseStyle,
      ...sizeStyles[size],
      ...variantStyles[variant],
    };
  };

  const getIconColor = () => {
    if (variant === "primary") return "#fff";
    if (variant === "ghost") return colors.accent;
    return colors.textSecondary;
  };

  return (
    <Animated.View
      style={[
        styles.animatedContainer,
        {
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <Pressable
        style={[getButtonStyle(), disabled && styles.disabled, style]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={variant === "primary" ? "#fff" : colors.accent}
          />
        ) : (
          <>
            {icon && (
              <Ionicons
                name={icon}
                size={size === "small" ? 16 : size === "large" ? 24 : 20}
                color={getIconColor()}
              />
            )}
            {title && <Text style={[getTextStyle(), textStyle]}>{title}</Text>}
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  animatedContainer: {
    alignSelf: "flex-start",
  },
  disabled: {
    opacity: 0.5,
  },
});

// Import ActivityIndicator for loading state
import { ActivityIndicator } from "react-native";

