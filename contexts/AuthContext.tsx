import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";
import { Platform } from "react-native";
import e621Api from "../api/e621";
import { r34vaultApi as r34Api, UserProfile } from "../api/rule34vault";
import { useSite } from "./SiteContext";

// Storage abstraction: SecureStore on native, localStorage on web
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
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        localStorage.removeItem(key);
      } catch {}
      return;
    }
    const SecureStore = require("expo-secure-store");
    return SecureStore.deleteItemAsync(key);
  },
};

interface AuthState {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  login: (emailOrUsername: string, passwordOrApiKey: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  token: null,
  isLoading: true,
  isLoggedIn: false,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { activeSite, isE621, siteReady } = useSite();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Reload auth whenever site changes
  useEffect(() => {
    if (siteReady) {
      console.log("[AuthContext] siteReady, loadStoredAuth for", activeSite);
      loadStoredAuth();
    }
  }, [activeSite, siteReady]);

  async function loadStoredAuth() {
    console.log("[AuthContext] loadStoredAuth start");
    setIsLoading(true);
    try {
      if (isE621) {
        // e621: username + API key stored separately
        const storedUsername = await storage.getItem("e621_username");
        const storedKey = await storage.getItem("e621_apikey");
        if (storedUsername && storedKey) {
          const token = btoa(`${storedUsername}:${storedKey}`);
          e621Api.setAuth(storedUsername, storedKey);

          // Try to restore user from cache for instant display
          let cachedUser: UserProfile | null = null;
          const storedUser = await storage.getItem("e621_user");
          if (storedUser) {
            try {
              cachedUser = JSON.parse(storedUser) as UserProfile;
              e621Api.setAuth(storedUsername, storedKey, cachedUser);
            } catch (parseErr) {
              console.warn("[AuthContext] e621 cached user corrupt:", parseErr);
            }
          }

          if (cachedUser) {
            // Show cached profile immediately, refresh in true background
            setToken(token);
            setUser(cachedUser);
            e621Api
              .getMe()
              .then(async (fresh) => {
                setUser(fresh);
                await storage.setItem("e621_user", JSON.stringify(fresh));
              })
              .catch((err) => {
                console.warn(
                  "[AuthContext] e621 background refresh failed:",
                  err,
                );
              });
          } else {
            // No cache — must fetch synchronously to get anything to show
            console.log(
              "[AuthContext] e621 no cached user, fetching fresh profile",
            );
            setToken(token); // Set token now so isLoggedIn is true during fetch
            try {
              const fresh = await e621Api.getMe();
              e621Api.setAuth(storedUsername, storedKey, fresh);
              setUser(fresh);
              await storage.setItem("e621_user", JSON.stringify(fresh));
            } catch (err) {
              console.warn(
                "[AuthContext] e621 fresh profile fetch failed:",
                err,
              );
              // Credentials likely invalid — clear them
              setToken(null);
              setUser(null);
              await storage.removeItem("e621_username");
              await storage.removeItem("e621_apikey");
              await storage.removeItem("e621_user");
            }
          }
        } else {
          setToken(null);
          setUser(null);
        }
      } else {
        // Rule34Vault: JWT token
        const storedToken = await storage.getItem("r34v_token");
        const storedUser = await storage.getItem("r34v_user");
        if (storedToken && storedUser) {
          const parsed = JSON.parse(storedUser) as UserProfile;
          r34Api.setAuth(storedToken, parsed);
          setToken(storedToken);
          setUser(parsed);
          // Refresh profile in background
          try {
            const fresh = await r34Api.getMe();
            setUser(fresh);
            r34Api.setAuth(storedToken, fresh);
            await storage.setItem("r34v_user", JSON.stringify(fresh));
          } catch {}
        } else {
          setToken(null);
          setUser(null);
        }
      }
    } catch (e) {
      console.warn("Failed to load stored auth:", e);
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  const login = useCallback(
    async (emailOrUsername: string, passwordOrApiKey: string) => {
      if (isE621) {
        // e621: username + API key → Basic Auth
        const resp = await e621Api.login(emailOrUsername, passwordOrApiKey);
        setToken(resp.jwt); // synthetic base64 token
        setUser(resp.user);
        await storage.setItem("e621_username", emailOrUsername);
        await storage.setItem("e621_apikey", passwordOrApiKey);
        await storage.setItem("e621_user", JSON.stringify(resp.user));
      } else {
        // R34V: email + password → JWT
        const resp = await r34Api.login(emailOrUsername, passwordOrApiKey);
        setToken(resp.jwt);
        setUser(resp.user);
        await storage.setItem("r34v_token", resp.jwt);
        await storage.setItem("r34v_user", JSON.stringify(resp.user));
        // Fetch full profile with stats
        try {
          const fullUser = await r34Api.getMe();
          setUser(fullUser);
          await storage.setItem("r34v_user", JSON.stringify(fullUser));
        } catch {}
      }
    },
    [isE621],
  );

  const logout = useCallback(async () => {
    if (isE621) {
      e621Api.clearAuth();
      await storage.removeItem("e621_username");
      await storage.removeItem("e621_apikey");
      await storage.removeItem("e621_user");
    } else {
      r34Api.logout();
      await storage.removeItem("r34v_token");
      await storage.removeItem("r34v_user");
    }
    setToken(null);
    setUser(null);
  }, [isE621]);

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, isLoggedIn: !!token, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
