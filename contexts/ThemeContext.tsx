import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, Platform } from "react-native";

// ── Theme Color Definitions ─────────────────────────────────────────

export type ThemeName = "midnight" | "ocean" | "sakura" | "lucario" | "floragato" | "braixen" | "salazzle" | "tsareena" | "auto";
export type AccentColor = "purple" | "blue" | "green" | "orange" | "pink" | "red" | "teal";

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

// Accent color definitions
export const ACCENT_COLORS: Record<AccentColor, { label: string; color: string; light: string }> = {
  purple: { label: "Purple", color: "#6c5ce7", light: "#a29bfe" },
  blue: { label: "Blue", color: "#0984e3", light: "#54a0ff" },
  green: { label: "Green", color: "#10b981", light: "#34d399" },
  orange: { label: "Orange", color: "#f97316", light: "#fb923c" },
  pink: { label: "Pink", color: "#ec4899", light: "#f472b6" },
  red: { label: "Red", color: "#ef4444", light: "#f87171" },
  teal: { label: "Teal", color: "#14b8a6", light: "#5eead4" },
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

// ── Pokémon Theme: Lucario — Steel/Fighting aura blue ───────────────
const lucarioColors: ThemeColors = {
  bg: "#060b12",
  bgSecondary: "#0b1520",
  bgTertiary: "#101e2e",
  bgCard: "#09121b",
  bgElevated: "#142236",
  surface: "#101e2e",
  surfaceHover: "#1a2d45",
  text: "#cde8ff",
  textSecondary: "#5a8db5",
  textMuted: "#2e5878",
  textInverse: "#060b12",
  accent: "#1a82f0",
  accentLight: "#55b8ff",
  accentDark: "#0d5cba",
  like: "#f5d800",
  likeFilled: "#d4b800",
  bookmark: "#1a82f0",
  bookmarkFilled: "#0d5cba",
  superLike: "#ff9900",
  tagGeneral: "#1a82f0",
  tagCopyright: "#55b8ff",
  tagCharacter: "#00d4b8",
  tagArtist: "#f5d800",
  tagMeta: "#ff9900",
  border: "#132033",
  borderLight: "#1c3050",
  danger: "#ff4455",
  success: "#00d4b8",
  overlay: "rgba(6,11,18,0.88)",
  transparent: "transparent",
};

// ── Pokémon Theme: Floragato — Grass/flower teal-green & hot pink ────
const floragatoColors: ThemeColors = {
  bg: "#060e08",
  bgSecondary: "#0b1a0e",
  bgTertiary: "#112416",
  bgCard: "#0d1c10",
  bgElevated: "#172e1e",
  surface: "#112416",
  surfaceHover: "#1c3826",
  text: "#ddf5e2",
  textSecondary: "#76be88",
  textMuted: "#3a6e48",
  textInverse: "#060e08",
  accent: "#36d668",
  accentLight: "#78ffaa",
  accentDark: "#20a848",
  like: "#ff4fa0",
  likeFilled: "#ff1880",
  bookmark: "#ffe050",
  bookmarkFilled: "#e0c000",
  superLike: "#ff4fa0",
  tagGeneral: "#36d668",
  tagCopyright: "#78ffaa",
  tagCharacter: "#ff4fa0",
  tagArtist: "#ff8c50",
  tagMeta: "#ffe050",
  border: "#183220",
  borderLight: "#224830",
  danger: "#ff4455",
  success: "#36d668",
  overlay: "rgba(6,14,8,0.88)",
  transparent: "transparent",
};

// ── Pokémon Theme: Braixen — Fire/Psychic warm amber & cream ─────────
const braixenColors: ThemeColors = {
  bg: "#140800",
  bgSecondary: "#200d02",
  bgTertiary: "#2e1604",
  bgCard: "#251005",
  bgElevated: "#3c1e08",
  surface: "#2e1604",
  surfaceHover: "#4a2610",
  text: "#fff3e0",
  textSecondary: "#c88848",
  textMuted: "#7a4e28",
  textInverse: "#140800",
  accent: "#ff7800",
  accentLight: "#ffb450",
  accentDark: "#c45500",
  like: "#ff2828",
  likeFilled: "#e80000",
  bookmark: "#ffe030",
  bookmarkFilled: "#d4b800",
  superLike: "#ff7800",
  tagGeneral: "#ff7800",
  tagCopyright: "#ffb450",
  tagCharacter: "#ffe030",
  tagArtist: "#ff2828",
  tagMeta: "#e0ccff",
  border: "#3c1e08",
  borderLight: "#562a10",
  danger: "#ff2828",
  success: "#44d090",
  overlay: "rgba(20,8,0,0.90)",
  transparent: "transparent",
};

// ── Pokémon Theme: Salazzle — Poison/Fire neon pink & toxic black ────
const salazzleColors: ThemeColors = {
  bg: "#06010a",
  bgSecondary: "#0e0318",
  bgTertiary: "#160524",
  bgCard: "#0f0316",
  bgElevated: "#1c0830",
  surface: "#160524",
  surfaceHover: "#250c3e",
  text: "#f2d8ff",
  textSecondary: "#a050d0",
  textMuted: "#602e90",
  textInverse: "#06010a",
  accent: "#ff14cc",
  accentLight: "#ff80e8",
  accentDark: "#cc009e",
  like: "#ff14cc",
  likeFilled: "#ff00b8",
  bookmark: "#b020ff",
  bookmarkFilled: "#8800dd",
  superLike: "#ff50ff",
  tagGeneral: "#ff14cc",
  tagCopyright: "#b020ff",
  tagCharacter: "#ff80e8",
  tagArtist: "#ff4444",
  tagMeta: "#40ffff",
  border: "#200840",
  borderLight: "#300d55",
  danger: "#ff3030",
  success: "#40ffb0",
  overlay: "rgba(6,1,10,0.92)",
  transparent: "transparent",
};

// ── Pokémon Theme: Tsareena — Grass/Queen crimson & ivory ────────────
const tsareenaColors: ThemeColors = {
  bg: "#0e0208",
  bgSecondary: "#180408",
  bgTertiary: "#240610",
  bgCard: "#1c050a",
  bgElevated: "#300a14",
  surface: "#240610",
  surfaceHover: "#3e0e1e",
  text: "#fdeef0",
  textSecondary: "#cc7888",
  textMuted: "#7a3040",
  textInverse: "#0e0208",
  accent: "#dd002a",
  accentLight: "#ff4d68",
  accentDark: "#a80020",
  like: "#dd002a",
  likeFilled: "#bb001e",
  bookmark: "#f5e090",
  bookmarkFilled: "#d4be50",
  superLike: "#ff4d68",
  tagGeneral: "#dd002a",
  tagCopyright: "#cc0090",
  tagCharacter: "#88ee44",
  tagArtist: "#ff6060",
  tagMeta: "#f5e090",
  border: "#3d0812",
  borderLight: "#55101e",
  danger: "#ff2020",
  success: "#50cc70",
  overlay: "rgba(14,2,8,0.90)",
  transparent: "transparent",
};

export const THEMES: Record<ThemeName, { label: string; description: string; colors: ThemeColors }> = {
  midnight: { label: "Midnight", description: "Deep purple dark theme", colors: midnightColors },
  ocean: { label: "Ocean", description: "Teal & blue cyberpunk theme", colors: oceanColors },
  sakura: { label: "Sakura", description: "Pink & rose elegant theme", colors: sakuraColors },
  lucario: { label: "Lucario", description: "Steel-blue aura & golden energy", colors: lucarioColors },
  floragato: { label: "Floragato", description: "Forest green & hot-pink blossom", colors: floragatoColors },
  braixen: { label: "Braixen", description: "Blazing amber fire & warm cream", colors: braixenColors },
  salazzle: { label: "Salazzle", description: "Toxic neon pink & pure black", colors: salazzleColors },
  tsareena: { label: "Tsareena", description: "Royal crimson & ivory crown", colors: tsareenaColors },
  auto: { label: "Auto", description: "Follows system appearance", colors: midnightColors }, // Default to midnight
};

// ── Storage ─────────────────────────────────────────────────────────

const THEME_KEY = "app_theme";
const ACCENT_KEY = "app_accent";

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
  accentColor: AccentColor;
  setTheme: (name: ThemeName) => void;
  setAccent: (color: AccentColor) => void;
}

const ThemeContext = createContext<ThemeState>({
  themeName: "midnight",
  colors: midnightColors,
  accentColor: "purple",
  setTheme: () => {},
  setAccent: () => {},
});

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>("midnight");
  const [accentColor, setAccentColor] = useState<AccentColor>("purple");

  useEffect(() => {
    storage.getItem(THEME_KEY).then((val) => {
      if (val && val in THEMES) setThemeName(val as ThemeName);
    }).catch(() => {});
    storage.getItem(ACCENT_KEY).then((val) => {
      if (val && val in ACCENT_COLORS) setAccentColor(val as AccentColor);
    }).catch(() => {});
  }, []);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name);
    storage.setItem(THEME_KEY, name).catch(() => {});
  }, []);

  const setAccent = useCallback((color: AccentColor) => {
    setAccentColor(color);
    storage.setItem(ACCENT_KEY, color).catch(() => {});
  }, []);

  // Auto theme detection
  useEffect(() => {
    if (themeName === "auto") {
      const colorScheme = Appearance.getColorScheme();
      const autoTheme: ThemeName = colorScheme === "dark" ? "midnight" : "ocean";
      setThemeName(autoTheme);
      storage.setItem(THEME_KEY, autoTheme).catch(() => {});
    }
  }, []);

  // Apply accent color to theme
  const colors = useMemo(() => {
    const baseTheme = themeName === "auto" 
      ? (Appearance.getColorScheme() === "dark" ? midnightColors : oceanColors)
      : THEMES[themeName].colors;
    
    const accent = ACCENT_COLORS[accentColor];
    return {
      ...baseTheme,
      accent: accent.color,
      accentLight: accent.light,
      accentDark: accent.color + "cc",
    };
  }, [themeName, accentColor]);

  return (
    <ThemeContext.Provider value={{ themeName, colors, accentColor, setTheme, setAccent }}>
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

