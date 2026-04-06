import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";
import { Platform } from "react-native";
import { setActiveSiteForApi } from "../api";

export type SiteName = "r34vault" | "e621";

const SITE_KEY = "active_site";

const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    const SecureStore = require("expo-secure-store");
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        localStorage.setItem(key, value);
      } catch {}
      return;
    }
    const SecureStore = require("expo-secure-store");
    return SecureStore.setItemAsync(key, value);
  },
};

interface SiteState {
  activeSite: SiteName;
  setActiveSite: (site: SiteName) => void;
  isE621: boolean;
  isR34Vault: boolean;
  siteReady: boolean;
}

const SiteContext = createContext<SiteState>({
  activeSite: "r34vault",
  setActiveSite: () => {},
  isE621: false,
  isR34Vault: true,
  siteReady: false,
});

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const [activeSite, setActiveSiteState] = useState<SiteName>("r34vault");
  const [siteReady, setSiteReady] = useState(false);

  useEffect(() => {
    storage
      .getItem(SITE_KEY)
      .then((val) => {
        if (val === "e621" || val === "r34vault") {
          // Sync API module BEFORE state update so child effects see the correct API
          setActiveSiteForApi(val);
          setActiveSiteState(val);
        }
      })
      .catch(() => {})
      .finally(() => setSiteReady(true));
  }, []);

  const setActiveSite = useCallback((site: SiteName) => {
    console.log("[SiteContext] setActiveSite called with:", site);
    // Sync API module BEFORE React state update — ensures getActiveApi() returns
    // the correct site immediately when child useEffect hooks fire (effects run
    // child-before-parent, so SiteApiSync's effect would otherwise be too late).
    setActiveSiteForApi(site);
    setActiveSiteState(site);
    storage.setItem(SITE_KEY, site).catch((e) => {
      console.warn("[SiteContext] Failed to persist active site:", e);
    });
  }, []);

  return (
    <SiteContext.Provider
      value={{
        activeSite,
        setActiveSite,
        isE621: activeSite === "e621",
        isR34Vault: activeSite === "r34vault",
        siteReady,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}

export function useSite() {
  return useContext(SiteContext);
}
