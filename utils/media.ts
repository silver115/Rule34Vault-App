/**
 * Site-aware media URL helper.
 * For R34V posts: uses CDN bucket pattern.
 * For e621 posts: uses URLs embedded in the post object by the adapter.
 */
import { getActiveSite } from "../api";
import { getE621MediaUrl } from "../api/e621";
import { Post, getMediaUrl as r34GetMediaUrl } from "../api/rule34vault";

export function getSiteMediaUrl(
  post: Post,
  variant: "full" | "thumb" | "sample" = "full",
  useCdn = true,
): string {
  if (getActiveSite() === "e621") {
    return getE621MediaUrl(post, variant);
  }
  // R34V doesn't have a "sample" variant — fall back to "full"
  const r34Variant = variant === "sample" ? "full" : variant;
  return r34GetMediaUrl(post, r34Variant, useCdn);
}
