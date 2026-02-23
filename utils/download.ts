import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { Platform, Alert } from "react-native";
import * as Linking from "expo-linking";

/**
 * Download a media file and save it to the device's gallery.
 * Falls back to opening the URL in browser on web.
 */
export async function downloadMedia(url: string, filename: string): Promise<boolean> {
  if (Platform.OS === "web") {
    Linking.openURL(url);
    return true;
  }

  try {
    // Request permissions
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Please grant media library access to save downloads."
      );
      return false;
    }

    // Download to cache
    const fileUri = `${FileSystem.cacheDirectory}${filename}`;
    const download = await FileSystem.downloadAsync(url, fileUri);

    if (download.status !== 200) {
      return false;
    }

    // Save to gallery
    await MediaLibrary.saveToLibraryAsync(download.uri);
    return true;
  } catch (e) {
    console.error("Download failed:", e);
    return false;
  }
}

/**
 * Check if a URL returns a valid response (not 404).
 * Uses HEAD request to minimize bandwidth.
 */
export async function checkUrlExists(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { method: "HEAD" });
    return resp.ok;
  } catch {
    return false;
  }
}
