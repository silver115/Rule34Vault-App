export const Colors = {
  // Background
  bg: "#0a0a0f",
  bgSecondary: "#12121a",
  bgTertiary: "#1a1a28",
  bgCard: "#15151f",
  bgElevated: "#1e1e2e",

  // Surface
  surface: "#1a1a28",
  surfaceHover: "#22223a",

  // Text
  text: "#e8e8f0",
  textSecondary: "#8888a8",
  textMuted: "#555570",
  textInverse: "#0a0a0f",

  // Accent
  accent: "#6c5ce7",
  accentLight: "#a29bfe",
  accentDark: "#4a3fb5",

  // Semantic
  like: "#ff6b81",
  likeFilled: "#ff4757",
  bookmark: "#ffa502",
  bookmarkFilled: "#e67e22",
  superLike: "#ff69b4",

  // Tags
  tagGeneral: "#6c5ce7",
  tagCopyright: "#a855f7",
  tagCharacter: "#22c55e",
  tagArtist: "#ef4444",
  tagMeta: "#facc15",

  // Misc
  border: "#2a2a40",
  borderLight: "#333355",
  danger: "#ff4757",
  success: "#2ed573",
  overlay: "rgba(0,0,0,0.7)",
  transparent: "transparent",
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 999,
};

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  title: 34,
};

export function getTagColor(tagType: number): string {
  switch (tagType) {
    case 1:
      return Colors.tagGeneral;
    case 2:
      return Colors.tagCopyright;
    case 4:
      return Colors.tagCharacter;
    case 8:
      return Colors.tagArtist;
    case 32:
      return Colors.tagMeta;
    default:
      return Colors.textSecondary;
  }
}
