import { describe, expect, it } from "vitest";
import { matchesPlaylistSearch, sortPlaylistRows, type PlaylistRowStatus } from "./playlistSorting";

const values = (title = "", duration?: number | null, size?: number | null, status: PlaylistRowStatus = "available") => ({ title, duration, size, status });

describe("playlist row sorting", () => {
  it("searches title and artist together, ignoring case, accents and extra spaces", () => {
    expect(matchesPlaylistSearch("  ELARA   свет ", "Белый свет", "Lumi Elara")).toBe(true);
    expect(matchesPlaylistSearch("елка", "Ёлка", "Исполнитель")).toBe(true);
    expect(matchesPlaylistSearch("beyonce", "Night", "Beyoncé")).toBe(true);
    expect(matchesPlaylistSearch("   ", "Anything", "Anyone")).toBe(true);
    expect(matchesPlaylistSearch("elara ночь", "Белый свет", "Lumi Elara")).toBe(false);
  });
  it("sorts Russian titles both ways, preserving the source order of equal titles", () => {
    const rows = [values("Яблоко"), values("банан"), values("Альбом"), values("Банан")];
    expect(sortPlaylistRows(rows, { column: "title", direction: "ascending" }, (row) => row, "ru")).toEqual([rows[2], rows[1], rows[3], rows[0]]);
    expect(sortPlaylistRows(rows, { column: "title", direction: "descending" }, (row) => row, "ru")).toEqual([rows[0], rows[1], rows[3], rows[2]]);
    expect(rows.map((row) => row.title)).toEqual(["Яблоко", "банан", "Альбом", "Банан"]);
  });

  it("uses natural numbers and case-insensitive English titles", () => {
    const rows = [values("Track 10"), values("track 2"), values("Aria")];
    expect(sortPlaylistRows(rows, { column: "title", direction: "ascending" }, (row) => row, "en").map((row) => row.title)).toEqual(["Aria", "track 2", "Track 10"]);
  });

  it.each(["duration", "size"] as const)("sorts numeric %s while unknown values stay last in both directions", (column) => {
    const rows = [undefined, 10, 5, 10, null, NaN].map((value) => ({ ...values(), [column]: value }));
    expect(sortPlaylistRows(rows, { column, direction: "ascending" }, (row) => row, "ru")).toEqual([rows[2], rows[1], rows[3], rows[0], rows[4], rows[5]]);
    expect(sortPlaylistRows(rows, { column, direction: "descending" }, (row) => row, "ru")).toEqual([rows[1], rows[3], rows[2], rows[0], rows[4], rows[5]]);
  });

  it("orders every visible status, including all six queue states, by the agreed priority", () => {
    const positive: PlaylistRowStatus[] = ["downloaded", "available", "availableWithFallback", "downloading", "queued", "paused", "analyzing", "pendingAnalysis", "requiresAuth", "cancelled", "temporaryError", "analysisError", "downloadFailed", "unavailable"];
    const rows = positive.map((status) => values("", null, null, status));
    expect(sortPlaylistRows(rows, { column: "status", direction: "ascending" }, (row) => row, "ru")).toEqual(rows);
    expect(sortPlaylistRows(rows, { column: "status", direction: "descending" }, (row) => row, "en").map((row) => row.status)).toEqual(["unavailable", "analysisError", "downloadFailed", "temporaryError", "cancelled", "requiresAuth", "pendingAnalysis", "analyzing", "paused", "queued", "downloading", "availableWithFallback", "available", "downloaded"]);
  });

  it("restores the source order when sorting is cleared", () => {
    const rows = [values("Z"), values("A")];
    expect(sortPlaylistRows(rows, null, (row) => row, "en")).toEqual(rows);
  });
});
