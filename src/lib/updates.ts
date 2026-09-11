import type { UpdateCheckResult, UpdateCheckState } from "./types";

export const updateCheckStorageKey = "ytloadster.update-check";
export const dismissedUpdateStorageKey = "ytloadster.dismissed-update";
export const automaticUpdateChecksStorageKey = "ytloadster.automatic-update-checks";
export const automaticUpdateCheckIntervalMs = 24 * 60 * 60 * 1_000;

export type CachedUpdateCheck = UpdateCheckResult & {
  checkedAt: number;
};

export function loadCachedUpdateCheck(currentVersion: string): CachedUpdateCheck | null {
  try {
    const raw = window.localStorage.getItem(updateCheckStorageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CachedUpdateCheck>;
    if (
      value.currentVersion !== currentVersion ||
      typeof value.latestVersion !== "string" ||
      typeof value.updateAvailable !== "boolean" ||
      !isOfficialReleaseUrl(value.releaseUrl) ||
      typeof value.checkedAt !== "number" ||
      !Number.isFinite(value.checkedAt)
    ) {
      return null;
    }
    return value as CachedUpdateCheck;
  } catch {
    return null;
  }
}

export function saveCachedUpdateCheck(result: UpdateCheckResult, checkedAt = Date.now()) {
  try {
    window.localStorage.setItem(
      updateCheckStorageKey,
      JSON.stringify({ ...result, checkedAt } satisfies CachedUpdateCheck),
    );
  } catch {
    // The result remains available for the current session.
  }
}

export function isCachedUpdateCheckFresh(
  cached: CachedUpdateCheck,
  now = Date.now(),
) {
  return cached.checkedAt <= now && now - cached.checkedAt < automaticUpdateCheckIntervalMs;
}

export function updateStateFromResult(result: UpdateCheckResult): UpdateCheckState {
  return {
    status: result.updateAvailable ? "available" : "upToDate",
    result,
  };
}

export function getInitialAutomaticUpdateChecksEnabled() {
  try {
    return window.localStorage.getItem(automaticUpdateChecksStorageKey) !== "false";
  } catch {
    return true;
  }
}

export function saveAutomaticUpdateChecksEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(automaticUpdateChecksStorageKey, String(enabled));
  } catch {
    // The preference remains available for the current session.
  }
}

export function isUpdateNoticeDismissed(version: string) {
  try {
    return window.localStorage.getItem(dismissedUpdateStorageKey) === version;
  } catch {
    return false;
  }
}

export function dismissUpdateNotice(version: string) {
  try {
    window.localStorage.setItem(dismissedUpdateStorageKey, version);
  } catch {
    // Dismissal remains available for the current session.
  }
}

function isOfficialReleaseUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith("/sailars/YTLoadster/releases/")
    );
  } catch {
    return false;
  }
}
