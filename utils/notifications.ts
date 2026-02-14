import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

const NOTIF_PREF_KEY = "push_notifications_enabled";
const PUSH_SERVER_URL = Constants.expoConfig?.extra?.pushServerUrl || "";

// Configure how notifications appear when the app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Get the stored notification preference (on/off).
 */
export async function getNotificationPref(): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      return localStorage.getItem(NOTIF_PREF_KEY) === "true";
    }
    const val = await SecureStore.getItemAsync(NOTIF_PREF_KEY);
    return val === "true";
  } catch {
    return false;
  }
}

/**
 * Save the notification preference.
 */
export async function setNotificationPref(enabled: boolean): Promise<void> {
  try {
    if (Platform.OS === "web") {
      localStorage.setItem(NOTIF_PREF_KEY, String(enabled));
    } else {
      await SecureStore.setItemAsync(NOTIF_PREF_KEY, String(enabled));
    }
  } catch {}
}

/**
 * Request push notification permissions and return the Expo push token.
 * Returns null if permissions denied or not on a physical device.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications only work on physical devices
  if (Platform.OS !== "web" && !Device.isDevice) {
    console.warn("Push notifications require a physical device");
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request if not already granted
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  // Android notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("feed", {
      name: "Feed Updates",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#7c3aed",
    });
  }

  try {
    // Get native FCM device token (bypasses Expo push service)
    const tokenData = await Notifications.getDevicePushTokenAsync();
    console.log("[push] Got native FCM token:", tokenData.data);
    return tokenData.data as string;
  } catch (e: any) {
    console.error("[push] Failed to get push token:", e?.message || e);
    return null;
  }
}

/**
 * Schedule a local notification (used for feed updates when polling).
 */
export async function sendLocalNotification(title: string, body: string, data?: Record<string, unknown>) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: "default",
    },
    trigger: null, // Immediate
  });
}

/**
 * Register push token with the push server.
 * Called when user enables push notifications.
 * Uses the user's JWT for authentication — no shared secret needed.
 */
export async function registerWithPushServer(
  pushToken: string,
  authToken: string
): Promise<boolean> {
  try {
    const resp = await fetch(`${PUSH_SERVER_URL}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ pushToken }),
    });
    const data = await resp.json();
    return data.ok === true;
  } catch (e) {
    console.error("Failed to register with push server:", e);
    return false;
  }
}

/**
 * Unregister from push server. Called when user disables push notifications.
 * Uses the user's JWT for authentication.
 */
export async function unregisterFromPushServer(
  authToken: string
): Promise<boolean> {
  try {
    const resp = await fetch(`${PUSH_SERVER_URL}/api/unregister`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({}),
    });
    const data = await resp.json();
    return data.ok === true;
  } catch (e) {
    console.error("Failed to unregister from push server:", e);
    return false;
  }
}
