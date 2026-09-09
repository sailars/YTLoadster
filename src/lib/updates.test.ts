import { beforeEach, describe, expect, it } from "vitest";
import {
  automaticUpdateCheckIntervalMs,
  automaticUpdateChecksStorageKey,
  dismissUpdateNotice,
  dismissedUpdateStorageKey,
  isCachedUpdateCheckFresh,
  isUpdateNoticeDismissed,
  loadCachedUpdateCheck,
  getInitialAutomaticUpdateChecksEnabled,
  saveCachedUpdateCheck,
  saveAutomaticUpdateChecksEnabled,
  updateCheckStorageKey,
  updateStateFromResult,
} from "./updates";

const result = {
  currentVersion: "0.1.0",
  latestVersion: "0.1.1",
  updateAvailable: true,
  releaseUrl: "https://github.com/sailars/YTLoadster/releases/latest",
};

describe("update checks", () => {
  beforeEach(() => window.localStorage.clear());

  it("caches a trusted result for the current application version", () => {
    saveCachedUpdateCheck(result, 1_000);

    expect(loadCachedUpdateCheck("0.1.0")).toEqual({ ...result, checkedAt: 1_000 });
    expect(loadCachedUpdateCheck("0.1.1")).toBeNull();
  });

  it("rejects a cached release link outside the official repository", () => {
    window.localStorage.setItem(
      updateCheckStorageKey,
      JSON.stringify({
        ...result,
        releaseUrl: "https://example.com/download",
        checkedAt: 1_000,
      }),
    );

    expect(loadCachedUpdateCheck("0.1.0")).toBeNull();
  });

  it("checks cached result age before skipping an automatic request", () => {
    const cached = { ...result, checkedAt: 1_000 };

    expect(isCachedUpdateCheckFresh(cached, 1_000 + automaticUpdateCheckIntervalMs - 1)).toBe(true);
    expect(isCachedUpdateCheckFresh(cached, 1_000 + automaticUpdateCheckIntervalMs)).toBe(false);
    expect(isCachedUpdateCheckFresh(cached, 999)).toBe(false);
  });

  it("dismisses only the notification for the selected release", () => {
    dismissUpdateNotice("0.1.1");

    expect(window.localStorage.getItem(dismissedUpdateStorageKey)).toBe("0.1.1");
    expect(isUpdateNoticeDismissed("0.1.1")).toBe(true);
    expect(isUpdateNoticeDismissed("0.1.2")).toBe(false);
  });

  it("enables automatic checks by default and persists the user's choice", () => {
    expect(getInitialAutomaticUpdateChecksEnabled()).toBe(true);

    saveAutomaticUpdateChecksEnabled(false);
    expect(window.localStorage.getItem(automaticUpdateChecksStorageKey)).toBe("false");
    expect(getInitialAutomaticUpdateChecksEnabled()).toBe(false);

    saveAutomaticUpdateChecksEnabled(true);
    expect(getInitialAutomaticUpdateChecksEnabled()).toBe(true);
  });

  it("maps backend results to visible states", () => {
    expect(updateStateFromResult(result).status).toBe("available");
    expect(updateStateFromResult({ ...result, updateAvailable: false }).status).toBe("upToDate");
  });
});
