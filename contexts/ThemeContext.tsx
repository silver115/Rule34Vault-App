import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Platform } from "react-native";
import { Spacing, Radius, FontSize } from "../constants/theme";

// ── Theme Color Definitions ─────────────────────────────────────────

export type ThemeName = "midnight" | "ocean" | "sakura";

export interface ThemeColors {
  bg: string;
  bgSecondary: string;
  bgTertiary: string;
  bgCard: string;
  bgElevated: string;
  surface: string;
  surfaceHover: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  accent: string;
  accentLight: string;
  accentDark: string;
  like: string;
  likeFilled: string;
  bookmark: string;
  bookmarkFilled: string;
  superLike: string;
  tagGeneral: string;
  tagCopyright: string;
  tagCharacter: string;
  tagArtist: string;
  tagMeta: string;
  border: string;
  borderLight: string;
  danger: string;
  success: string;
  overlay: string;
  transparent: string;
}

// Theme 1: Midnight (default — current purple theme)
const midnightColors: ThemeColors = {
  bg: "#0a0a0f",
  bgSecondary: "#12121a",
  bgTertiary: "#1a1a28",
  bgCard: "#15151f",
  bgElevated: "#1e1e2e",
  surface: "#1a1a28",
  surfaceHover: "#22223a",
  text: "#e8e8f0",
  textSecondary: "#8888a8",
  textMuted: "#555570",
  textInverse: "#0a0a0f",
  accent: "#6c5ce7",
  accentLight: "#a29bfe",
  accentDark: "#4a3fb5",
  like: "#ff6b81",
  likeFilled: "#ff4757",
  bookmark: "#ffa502",
  bookmarkFilled: "#e67e22",
  superLike: "#ff69b4",
  tagGeneral: "#6c5ce7",
  tagCopyright: "#a855f7",
  tagCharacter: "#22c55e",
  tagArtist: "#ef4444",
  tagMeta: "#facc15",
  border: "#2a2a40",
  borderLight: "#333355",
  danger: "#ff4757",
  success: "#2ed573",
  overlay: "rgba(0,0,0,0.7)",
  transparent: "transparent",
};

// Theme 2: Ocean — deep blue/teal cyberpunk
const oceanColors: ThemeColors = {
  bg: "#050e17",
  bgSecondary: "#0a1929",
  bgTertiary: "#0f2338",
  bgCard: "#0c1e30",
  bgElevated: "#122a42",
  surface: "#0f2338",
  surfaceHover: "#163a55",
  text: "#e0f0ff",
  textSecondary: "#6ba3cc",
  textMuted: "#3d6d8f",
  textInverse: "#050e17",
  accent: "#00d4aa",
  accentLight: "#5fffda",
  accentDark: "#009977",
  like: "#ff6b9d",
  likeFilled: "#ff3d7f",
  bookmark: "#ffbe0b",
  bookmarkFilled: "#e6a800",
  superLike: "#ff69b4",
  tagGeneral: "#00d4aa",
  tagCopyright: "#00b4d8",
  tagCharacter: "#80ed99",
  tagArtist: "#ff6b6b",
  tagMeta: "#ffd166",
  border: "#163a55",
  borderLight: "#1e4d6e",
  danger: "#ff4d6d",
  success: "#00d4aa",
  overlay: "rgba(5,14,23,0.8)",
  transparent: "transparent",
};

// Theme 3: Sakura — warm pink/rose elegant
const sakuraColors: ThemeColors = {
  bg: "#110a10",
  bgSecondary: "#1a1018",
  bgTertiary: "#251822",
  bgCard: "#1e1219",
  bgElevated: "#2d1c28",
  surface: "#251822",
  surfaceHover: "#362434",
  text: "#f5e6ef",
  textSecondary: "#b88aa5",
  textMuted: "#7a5570",
  textInverse: "#110a10",
  accent: "#e84393",
  accentLight: "#fd79a8",
  accentDark: "#c0246e",
  like: "#ff6b81",
  likeFilled: "#ff4757",
  bookmark: "#fdcb6e",
  bookmarkFilled: "#e6a800",
  superLike: "#e84393",
  tagGeneral: "#e84393",
  tagCopyright: "#a855f7",
  tagCharacter: "#55efc4",
  tagArtist: "#ff7675",
  tagMeta: "#ffeaa7",
  border: "#362434",
  borderLight: "#4a2e42",
  danger: "#ff4757",
  success: "#55efc4",
  overlay: "rgba(17,10,16,0.8)",
  transparent: "transparent",
};

export const THEMES: Record<ThemeName, { label: string; description: string; colors: ThemeColors }> = {
  midnight: { label: "Midnight", description: "Deep purple dark theme", colors: midnightColors },
  ocean: { label: "Ocean", description: "Teal & blue cyberpunk theme", colors: oceanColors },
  sakura: { label: "Sakura", description: "Pink & rose elegant theme", colors: sakuraColors },
};

// ── Storage ─────────────────────────────────────────────────────────

const THEME_KEY = "app_theme";

const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try { return localStorage.getItem(key); } catch { return null; }
    }
    const SecureStore = require("expo-secure-store");
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try { localStorage.setItem(key, value); } catch {}
      return;
    }
    const SecureStore = require("expo-secure-store");
    return SecureStore.setItemAsync(key, value);
  },
};

// ── Context ─────────────────────────────────────────────────────────

interface ThemeState {
  themeName: ThemeName;
  colors: ThemeColors;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeState>({
  themeName: "midnight",
  colors: midnightColors,
  setTheme: () => {},
});

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>("midnight");

  useEffect(() => {
    storage.getItem(THEME_KEY).then((val) => {
      if (val && val in THEMES) setThemeName(val as ThemeName);
    }).catch(() => {});
  }, []);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name);
    storage.setItem(THEME_KEY, name).catch(() => {});
  }, []);

  const colors = THEMES[themeName].colors;

  return (
    <ThemeContext.Provider value={{ themeName, colors, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}

export function getTagColorFromTheme(tagType: number, colors: ThemeColors): string {
  switch (tagType) {
    case 1: return colors.tagGeneral;
    case 2: return colors.tagCopyright;
    case 4: return colors.tagCharacter;
    case 8: return colors.tagArtist;
    case 32: return colors.tagMeta;
    default: return colors.textSecondary;
  }
}
