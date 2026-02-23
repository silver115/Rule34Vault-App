import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Platform } from "react-native";

// ── Preview Quality Definitions ─────────────────────────────────────
// Controls how images are loaded in the grid and detail views.
//   low    — thumbnails everywhere, videos show poster only until tapped
//   medium — thumbnails in grid, full images in detail view (default)
//   high   — full images in grid + detail view

export type PreviewQuality = "low" | "medium" | "high";

export interface QualityOption {
  key: PreviewQuality;
  label: string;
  description: string;
  gridVariant: "thumb" | "full";
  detailVariant: "thumb" | "full";
  videoAutoplay: boolean;
}

export const QUALITY_OPTIONS: Record<PreviewQuality, QualityOption> = {
  low: {
    key: "low",
    label: "Low",
    description: "Thumbnails only — saves the most data",
    gridVariant: "thumb",
    detailVariant: "thumb",
    videoAutoplay: false,
  },
  medium: {
    key: "medium",
    label: "Medium",
    description: "Thumbnails in grid, full quality in detail view",
    gridVariant: "thumb",
    detailVariant: "full",
    videoAutoplay: true,
  },
  high: {
    key: "high",
    label: "High",
    description: "Full quality everywhere",
    gridVariant: "full",
    detailVariant: "full",
    videoAutoplay: true,
  },
};

// ── Storage ─────────────────────────────────────────────────────────

const QUALITY_KEY = "preview_quality";

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

interface SettingsState {
  previewQuality: PreviewQuality;
  qualityOption: QualityOption;
  setPreviewQuality: (q: PreviewQuality) => void;
}

const SettingsContext = createContext<SettingsState>({
  previewQuality: "medium",
  qualityOption: QUALITY_OPTIONS.medium,
  setPreviewQuality: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [quality, setQuality] = useState<PreviewQuality>("medium");

  useEffect(() => {
    storage.getItem(QUALITY_KEY).then((val) => {
      if (val && val in QUALITY_OPTIONS) setQuality(val as PreviewQuality);
    }).catch(() => {});
  }, []);

  const setPreviewQuality = useCallback((q: PreviewQuality) => {
    setQuality(q);
    storage.setItem(QUALITY_KEY, q).catch(() => {});
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        previewQuality: quality,
        qualityOption: QUALITY_OPTIONS[quality],
        setPreviewQuality,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
