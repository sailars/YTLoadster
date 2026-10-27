export type PlaylistSortColumn = "title" | "duration" | "size" | "status";
export type PlaylistSort = { column: PlaylistSortColumn; direction: "ascending" | "descending" } | null;
export type PlaylistRowStatus = "pendingAnalysis" | "analyzing" | "available" | "availableWithFallback" | "requiresAuth" | "unavailable" | "temporaryError" | "analysisError" | "queued" | "downloading" | "paused" | "downloadFailed" | "cancelled" | "downloaded";

export function matchesPlaylistSearch(query: string, title: string, artist: string): boolean {
  const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const text = normalize(`${title} ${artist}`);
  return words.every((word) => text.includes(word));
}

type SortValues = { title: string; duration: number | null | undefined; size: number | null | undefined; status: PlaylistRowStatus };

const statusRank: Record<PlaylistRowStatus, number> = {
  downloaded: 0, available: 1, availableWithFallback: 2, downloading: 3,
  queued: 4, paused: 5, analyzing: 6, pendingAnalysis: 7, requiresAuth: 8,
  cancelled: 9, temporaryError: 10, analysisError: 11, downloadFailed: 11, unavailable: 12,
};

export function sortPlaylistRows<T>(rows: readonly T[], sort: PlaylistSort, read: (row: T) => SortValues, locale: "ru" | "en"): T[] {
  if (!sort) return [...rows];
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const direction = sort.direction === "ascending" ? 1 : -1;
  return rows.map((row, index) => ({ row, index, value: read(row) }))
    .sort((left, right) => {
      let comparison: number;
      if (sort.column === "title") comparison = direction * collator.compare(left.value.title, right.value.title);
      else if (sort.column === "status") comparison = direction * (statusRank[left.value.status] - statusRank[right.value.status]);
      else {
        const a = left.value[sort.column];
        const b = right.value[sort.column];
        const aKnown = typeof a === "number" && Number.isFinite(a);
        const bKnown = typeof b === "number" && Number.isFinite(b);
        // Неизвестные значения остаются после известных в обоих направлениях.
        comparison = aKnown && bKnown ? direction * (a - b) : aKnown ? -1 : bKnown ? 1 : 0;
      }
      return comparison || left.index - right.index;
    })
    .map(({ row }) => row);
}
