import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { AppState } from "react-native";
import api from "../api/rule34vault";
import { useAuth } from "./AuthContext";
import { getNotificationPref, sendLocalNotification } from "../utils/notifications";

const POLL_INTERVAL = 60_000; // check every 60 seconds

interface FeedCountState {
  count: number;
  setCount: (n: number) => void;
  refresh: () => void;
}

const FeedCountContext = createContext<FeedCountState>({
  count: 0,
  setCount: () => {},
  refresh: () => {},
});

export function FeedCountProvider({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuth();
  const [count, setCount] = useState(0);
  const prevCountRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!isLoggedIn) { setCount(0); return; }
    try {
      const n = await api.getFeedCount();
      // Local notifications removed — the push server handles remote notifications
      // when the user has push enabled, avoiding duplicate alerts.
      prevCountRef.current = n;
      setCount(n);
    } catch {
      setCount(0);
    }
  }, [isLoggedIn]);

  // Initial fetch + periodic polling
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  // Refresh when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return (
    <FeedCountContext.Provider value={{ count, setCount, refresh }}>
      {children}
    </FeedCountContext.Provider>
  );
}

export function useFeedCount() {
  return useContext(FeedCountContext);
}
