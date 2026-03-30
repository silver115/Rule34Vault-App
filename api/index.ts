/**
 * API Router — returns the active API client based on the current site.
 *
 * Usage in components: import { useApi } from "../api";
 * Usage outside React: import { getActiveApi } from "../api";
 */
import type { SiteName } from "../contexts/SiteContext";
import e621Api from "./e621";
import r34Api, { _setApiSiteOverride } from "./rule34vault";

// Module-level site tracker (set by SiteContext on change)
let _activeSite: SiteName = "r34vault";

export function setActiveSiteForApi(site: SiteName) {
  _activeSite = site;
  // Also update the Proxy-based api default export so all existing
  // `import api from "../api/rule34vault"` calls become site-aware
  _setApiSiteOverride(site);
}

export function getActiveSite(): SiteName {
  return _activeSite;
}

/**
 * Get the currently active API client instance.
 * Works outside of React component trees.
 */
export function getActiveApi() {
  return _activeSite === "e621" ? e621Api : r34Api;
}

// Re-export types and helpers from rule34vault (canonical type definitions)
export type {
    AuthResponse, PaginatedResponse, Playlist, Post, PostActionState, PostComment, SearchFilters, Tag,
    UserProfile
} from "./rule34vault";

export { getE621MediaUrl } from "./e621";
export {
    clearPostCache, getAvatarUrl,
    getBannerUrl, getCacheStats, getMediaUrl,
    getMediaUrlDirect, POST_TYPE,
    TAG_TYPE
} from "./rule34vault";

