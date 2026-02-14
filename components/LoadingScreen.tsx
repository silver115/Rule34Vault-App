import React from "react";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { Colors, FontSize } from "../constants/theme";

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message }: LoadingScreenProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.accent} />
      {message && <Text style={styles.text}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.bg,
    gap: 16,
  },
  text: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
  },
});
