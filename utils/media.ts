/**
 * Site-aware media URL helper.
 * For R34V posts: uses CDN bucket pattern.
 * For e621 posts: uses URLs embedded in the post object by the adapter.
 */
import { Post, getMediaUrl as r34GetMediaUrl } from "../api/rule34vault";
import { getE621MediaUrl } from "../api/e621";
import { getActiveSite } from "../api";

export function getSiteMediaUrl(
  post: Post,
  variant: "full" | "thumb" = "full",
  useCdn = true
): string {
  if (getActiveSite() === "e621") {
    return getE621MediaUrl(post, variant);
  }
  return r34GetMediaUrl(post, variant, useCdn);
}
