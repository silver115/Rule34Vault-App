import Constants from "expo-constants";
import { Post, Tag } from "../api/rule34vault";

function resolveRecServerUrl(): string {
  const extraSources = [
    Constants.expoConfig?.extra,
    (Constants as any).manifest?.extra,
    (Constants as any).manifest2?.extra,
    (Constants as any).nativeAppConfig?.extra,
  ].filter(Boolean);
  const envValue =
    process.env.EXPO_PUBLIC_REC_SERVER_URL || process.env.REC_SERVER_URL;
  const fromExtra = extraSources.find((extra) => extra?.recServerUrl)?.recServerUrl;
  return (envValue || fromExtra || "").trim();
}

export const REC_SERVER_URL: string = resolveRecServerUrl() || process.env.EXPO_PUBLIC_REC_SERVER_URL || process.env.REC_SERVER_URL || "https://rec.lucario.click";
let warnedMissingUrl = false;

// Debug: log resolved URL once
console.log("[rec] Resolved REC_SERVER_URL:", REC_SERVER_URL || "(empty)");

export type RecSignal = "like" | "bookmark" | "super_like" | "complete" | "skip" | "view_duration";

export interface RecResult {
  posts: Post[];
  topTags: string[];
}

async function recFetch(
  path: string,
  jwt: string,
  body: Record<string, unknown>
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    return await fetch(`${REC_SERVER_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Returns true if a rec server URL is configured in the app's extra config.
 */
export function hasRecServer(): boolean {
  return !!REC_SERVER_URL;
}

/**
 * Fetch personalised recommendations from the rec server.
 * Returns null if the server is unavailable or not configured.
 */
export async function fetchRecommendations(
  jwt: string,
  take = 30
): Promise<RecResult | null> {
  if (!REC_SERVER_URL) return null;
  console.log("[rec] Fetching recommendations from", REC_SERVER_URL);
  try {
    const res = await recFetch("/api/recommendations", jwt, { take });
    if (!res.ok) {
      console.warn("[rec] Server returned", res.status);
      return null;
    }
    const data = await res.json();
    return {
      posts: data.posts ?? [],
      topTags: data.topTags ?? [],
    };
  } catch (e: any) {
    console.warn("[rec] Unavailable:", e?.message);
    return null;
  }
}

/**
 * Send an engagement signal to the rec server to update the user's
 * interest profile in real-time.
 * Fire-and-forget — never throws.
 */
export async function sendRecSignal(
  jwt: string,
  postId: number,
  signal: RecSignal,
  tags?: Tag[],
  duration?: number
): Promise<void> {
  if (!REC_SERVER_URL) return;
  console.log("[rec] Sending signal", signal, "for post", postId, "to", REC_SERVER_URL);
  try {
    const body: Record<string, unknown> = { postId, signal, tags: tags ?? [] };
    if (duration != null) body.duration = duration;
    await recFetch("/api/signal", jwt, body);
    console.log("[rec] Signal sent successfully");
  } catch (e: any) {
    console.warn("[rec] Signal failed:", e?.message);
  }
}

/**
 * Send view duration signal. Call when user leaves a post detail view.
 * Duration in seconds. Tags from the viewed post.
 */
export async function sendViewDuration(
  jwt: string,
  postId: number,
  durationSec: number,
  tags?: Tag[]
): Promise<void> {
  if (!REC_SERVER_URL || durationSec < 1) return;
  return sendRecSignal(jwt, postId, "view_duration", tags, durationSec);
}

/**
 * Force the rec server to rebuild the user's interest profile from
 * their current liked/bookmarked history.
 */
export async function refreshRecProfile(jwt: string): Promise<string[]> {
  if (!REC_SERVER_URL) return [];
  try {
    const res = await recFetch("/api/profile/refresh", jwt, {});
    if (!res.ok) return [];
    const data = await res.json();
    return data.topTags ?? [];
  } catch {
    return [];
  }
}

/**
 * Reset seen posts + profile on the rec server (fresh start).
 */
export async function resetRecProfile(jwt: string): Promise<boolean> {
  if (!REC_SERVER_URL) return false;
  try {
    const res = await recFetch("/api/profile/reset", jwt, {});
    return res.ok;
  } catch {
    return false;
  }
}
