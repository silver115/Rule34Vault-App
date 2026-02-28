import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { Platform, Alert } from "react-native";

const ALBUM_NAME = "Rule34Vault";

// Cache permission status so we only ask the OS once per session
let _permissionGranted = false;

async function ensurePermission(): Promise<boolean> {
  if (_permissionGranted) return true;
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status === "granted") {
    _permissionGranted = true;
    return true;
  }
  Alert.alert(
    "Permission Required",
    "Please grant media library access to save downloads."
  );
  return false;
}

/**
 * Download a media file and save it to the device's Rule34Vault album.
 * On web, triggers a browser download via blob + anchor tag.
 */
export async function downloadMedia(url: string, filename: string): Promise<boolean> {
  if (Platform.OS === "web") {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      return true;
    } catch (e) {
      console.error("Download failed:", e);
      return false;
    }
  }

  try {
    if (!(await ensurePermission())) return false;

    // Download to cache using legacy FileSystem API (reliable)
    const fileUri = `${FileSystem.cacheDirectory}${filename}`;
    const download = await FileSystem.downloadAsync(url, fileUri);

    if (download.status !== 200) {
      Alert.alert("Download failed", `Server returned status ${download.status}`);
      return false;
    }

    // saveToLibraryAsync avoids the secondary "modify photo" dialog on Android 10+
    await MediaLibrary.saveToLibraryAsync(download.uri);

    // Clean up temp file
    try { await FileSystem.deleteAsync(fileUri, { idempotent: true }); } catch {}

    return true;
  } catch (e: any) {
    console.error("Download failed:", e);
    Alert.alert("Download failed", e?.message || "An error occurred.");
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
