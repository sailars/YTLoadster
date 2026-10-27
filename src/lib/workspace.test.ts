import { beforeEach, describe, expect, it } from "vitest";
import { defaultPlaylistParameters } from "./playlistModel";
import { clearWorkspace, emptyWorkspace, loadWorkspace, saveWorkspace, workspaceStorageKey, type CollectionWorkspace } from "./workspace";

describe("workspace persistence", () => {
  beforeEach(() => window.localStorage.clear());
  it("restores collection selection and confirmed edits without reviving active work", () => {
    const workspace = emptyWorkspace();
    workspace.urls.playlist = "https://youtube.com/playlist?list=PL-test";
    workspace.activeSection = "playlist";
    const entry = { id: "song", title: "Song", url: "https://youtu.be/song", index: 1 };
    workspace.views.playlist = {
      kind: "collection", url: workspace.urls.playlist, playlist: { id: "PL-test", title: "Saved", entries: [entry] },
      rows: [{ entry, selected: false, analysisState: "analyzing", media: null }],
      params: { ...defaultPlaylistParameters, destinationDir: "saved-folder" },
      musicEdits: { song: { title: "Confirmed edit" } }, albumEdits: { album: "Saved album" },
      createAlbumFolder: false, layout: "stacked",
    };
    expect(saveWorkspace(workspace)).toBe(true);
    const restored = loadWorkspace()!;
    expect(restored.activeSection).toBe("playlist");
    expect(restored.views.playlist).toMatchObject({
      rows: [{ selected: false, analysisState: "pending" }], musicEdits: { song: { title: "Confirmed edit" } },
      albumEdits: { album: "Saved album" }, params: { destinationDir: "saved-folder" },
    });
    expect(JSON.stringify(restored)).not.toMatch(/jobId|cookieSource|password/);
  });
  it("ignores broken, incompatible and stale views", () => {
    window.localStorage.setItem(workspaceStorageKey, "broken");
    expect(loadWorkspace()).toBeNull();
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify({ ...emptyWorkspace(), version: 2 }));
    expect(loadWorkspace()).toBeNull();
    const workspace = emptyWorkspace();
    workspace.views.playlist = { kind: "collection", url: "old-url", params: { mode: "video" } } as CollectionWorkspace;
    saveWorkspace(workspace);
    expect(loadWorkspace()?.views).toEqual({});
  });
  it("restores an unchecked pending album entry and album edits with a numeric clip resolution", () => {
    const workspace = emptyWorkspace();
    workspace.urls.music = "https://music.youtube.com/playlist?list=OLAK5uy_test";
    const entry = { id: "track", index: 1, title: "Pending song", url: "https://youtu.be/track" };
    workspace.views.musicCollection = {
      kind: "collection", url: workspace.urls.music, playlist: { id: "OLAK5uy_test", title: "Album", musicKind: "album", entries: [entry] },
      rows: [{ entry, selected: false, analysisState: "pending", media: null }],
      params: { ...defaultPlaylistParameters, mode: "video", videoProfile: "custom", resolution: 1080, fps: 60, destinationDir: "saved-folder" },
      musicEdits: {}, albumEdits: { album: "Edited album", albumArtist: "Edited artist", year: "2026" },
      createAlbumFolder: false, layout: "wide",
    };
    saveWorkspace(workspace);
    expect(loadWorkspace()?.views.musicCollection).toMatchObject({
      rows: [{ selected: false, analysisState: "pending" }],
      params: { videoProfile: "custom", resolution: 1080, fps: 60 },
      albumEdits: { album: "Edited album", albumArtist: "Edited artist", year: "2026" },
    });
  });
  it("clears only the saved workspace", () => {
    saveWorkspace(emptyWorkspace());
    window.localStorage.setItem("other", "keep");
    clearWorkspace();
    expect(loadWorkspace()).toBeNull();
    expect(window.localStorage.getItem("other")).toBe("keep");
  });
});
