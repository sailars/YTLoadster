import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { isYoutubeMusicUrl, musicSourceKind } from "../lib/sourceUrl";
import { makeCookieSource } from "../lib/playlistModel";
import type { BrowserAuthSettings, DownloadRequest, Job, PlaylistFormatSelectionMode } from "../lib/types";
import { Downloader } from "./Downloader";
import { Playlist } from "./Playlist";
import type { Workspace, WorkspaceKey, WorkspaceView } from "../lib/workspace";

type Props = {
  initialWorkspace?: Workspace | null;
  workspacePersistenceEnabled?: boolean;
  onWorkspaceChange?: (key: WorkspaceKey, view: WorkspaceView) => void;
  settingsResetVersion?: number;
  active: boolean; url: string; authSettings: BrowserAuthSettings; authenticated: boolean;
  defaultDestinationDir: string | null; formatSelectionMode: PlaylistFormatSelectionMode; showThumbnails: boolean;
  jobs: Job[]; downloadedHistoryKeys: Set<string>; repeatDraft?: { id: string; request?: DownloadRequest | null } | null;
  onUrlChange: (url: string) => void; onOpenQueue: () => void; onOpenAuth: () => void;
  onJobsCreated: (jobs: Job[]) => void; onRepeatConsumed: () => void;
  musicAlbumFolder?: boolean; onMusicAlbumFolderChange?: (enabled: boolean) => Promise<boolean>;
};

export function YouTubeMusic(props: Props) {
  const { t } = useI18n();
  const [encoders, setEncoders] = useState<string[] | null>(null);
  useEffect(() => {
    if (!props.active) return;
    let current = true;
    void api.getAudioEncoders().then((value) => { if (current) setEncoders(value); }).catch(() => { if (current) setEncoders([]); });
    return () => { current = false; };
  }, [props.active]);
  const kind = musicSourceKind(props.url);
  const cookieSource = makeCookieSource(props.authSettings);
  const needsAuth = isYoutubeMusicUrl(props.url) && new URL(props.url).searchParams.get("list") === "LM" && (!cookieSource || cookieSource.kind === "youtubeSession" && !props.authenticated);
  const collection = kind === "playlist" && !needsAuth;
  const single = kind === "video";
  const unsupportedMessage = kind === "channel" ? t("music.channelUnsupported")
    : kind === "radio" ? t("music.radioUnsupported")
      : kind === "unsupported" ? t("music.unsupported") : null;
  const likedAction = <button type="button" className="secondary" onClick={() => props.onUrlChange("https://music.youtube.com/playlist?list=LM")}>{t("music.liked")}</button>;
  return <section className="music-section" aria-label={t("nav.music")}>
    {needsAuth ? <div className="inline-notice warning-notice"><span>{t("music.signIn")}</span><button type="button" className="secondary" onClick={props.onOpenAuth}>{t("music.openAuth")}</button></div> : null}
    {unsupportedMessage ? <p className="error" role="alert">{unsupportedMessage}</p> : null}
    <div hidden={collection}><Downloader initialWorkspace={props.initialWorkspace?.views.musicSingle?.kind === "single" ? props.initialWorkspace.views.musicSingle : undefined} workspacePersistenceEnabled={props.workspacePersistenceEnabled} workspaceKey="musicSingle" onWorkspaceChange={props.onWorkspaceChange} settingsResetVersion={props.settingsResetVersion} musicMode sourceHeaderAction={likedAction} audioEncoders={encoders} authSettings={props.authSettings} defaultDestinationDir={props.defaultDestinationDir} includeVideoTechnicalDetailsInFilename={false} url={props.url} sourceIsVideo={single} repeatDraft={props.repeatDraft} onUrlChange={props.onUrlChange} onOpenQueue={props.onOpenQueue} onRepeatConsumed={props.onRepeatConsumed} onJobCreated={(job) => props.onJobsCreated([job])} /></div>
    <div hidden={!collection}><Playlist initialWorkspace={props.initialWorkspace?.views.musicCollection?.kind === "collection" ? props.initialWorkspace.views.musicCollection : undefined} workspacePersistenceEnabled={props.workspacePersistenceEnabled} workspaceKey="musicCollection" onWorkspaceChange={props.onWorkspaceChange} settingsResetVersion={props.settingsResetVersion} musicMode musicAlbumFolder={props.musicAlbumFolder} onMusicAlbumFolderChange={props.onMusicAlbumFolderChange} sourceHeaderAction={likedAction} audioEncoders={encoders} url={props.url} sourceIsPlaylist={collection} defaultDestinationDir={props.defaultDestinationDir} authSettings={props.authSettings} authenticated={props.authenticated} includeVideoTechnicalDetailsInFilename={false} formatSelectionMode={props.formatSelectionMode} showThumbnails={props.showThumbnails} jobs={props.jobs} downloadedHistoryKeys={props.downloadedHistoryKeys} onUrlChange={props.onUrlChange} onJobsCreated={props.onJobsCreated} onOpenQueue={props.onOpenQueue} /></div>
  </section>;
}
