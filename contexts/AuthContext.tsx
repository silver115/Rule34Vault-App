import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import api, { UserProfile } from "../api/rule34vault";

// Storage abstraction: SecureStore on native, localStorage on web
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
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try { localStorage.removeItem(key); } catch {}
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
  login: (email: string, password: string) => Promise<void>;
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
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  async function loadStoredAuth() {
    try {
      const storedToken = await storage.getItem("r34v_token");
      const storedUser = await storage.getItem("r34v_user");
      if (storedToken && storedUser) {
        const parsed = JSON.parse(storedUser) as UserProfile;
        api.setAuth(storedToken, parsed);
        setToken(storedToken);
        setUser(parsed);
        console.log('JWT:', storedToken);
        // Refresh profile data in background
        try {
          const fresh = await api.getMe();
          setUser(fresh);
          api.setAuth(storedToken, fresh);
          await storage.setItem("r34v_user", JSON.stringify(fresh));
        } catch {}
      }
    } catch (e) {
      console.warn("Failed to load stored auth:", e);
    } finally {
      setIsLoading(false);
    }
  }

  const login = useCallback(async (email: string, password: string) => {
    const resp = await api.login(email, password);
    setToken(resp.jwt);
    setUser(resp.user);
    await storage.setItem("r34v_token", resp.jwt);
    await storage.setItem("r34v_user", JSON.stringify(resp.user));
    // Fetch full profile with stats
    try {
      const fullUser = await api.getMe();
      setUser(fullUser);
      await storage.setItem("r34v_user", JSON.stringify(fullUser));
    } catch {}
  }, []);

  const logout = useCallback(async () => {
    api.logout();
    setToken(null);
    setUser(null);
    await storage.removeItem("r34v_token");
    await storage.removeItem("r34v_user");
  }, []);

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
