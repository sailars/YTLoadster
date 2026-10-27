# YTLoadster

[Русский](README.md)

YTLoadster is a desktop application for downloading video, audio, and subtitles from YouTube.

<img width="1320" height="765" alt="YTLoadster main window" src="https://github.com/user-attachments/assets/fbf5a8a6-76a3-4944-af21-2c9e673c9700" />

## Features

- Automatic YouTube link analysis and selection of available quality options.
- Video, audio, and subtitle downloads from YouTube.
- Downloads of selected videos, audio, and subtitles from YouTube playlists.
- Exact quality selection or automatic matching to the closest available option for playlists.
- Ready-made video profiles for phones, tablets, Smart TVs, and compatible MP4 playback.
- Download queue controls: pause, resume, cancel, and retry downloads.
- History of successfully downloaded files.
- Configurable numbers of parallel downloads and connections (fragments) per video.
- Custom User-Agent support for analysis and downloads.
- Sleep prevention during active downloads.
- Dark theme.
- Authentication using browser cookies.
- YouTube sign-in through an isolated browser profile that does not affect the user's regular profile.
- Proxy configuration: system, HTTP, HTTPS, and SOCKS5.
- Checking for updates and updating core components.
- Multiple color themes.

To restore defaults, open "Settings → General → Reset all settings" and confirm. Download, network and interface preferences, including language and appearance, are reset. History, downloaded files, the queue and your saved YouTube sign-in remain.

## YouTube Music in branch 0.1.3

In Playlist and YouTube Music, use "Download ready" while the remaining selected items are still being analyzed. Only ready items enter the queue; analysis continues and other selections remain.

Search above the Playlist and YouTube Music tables by title and artist. Enter multiple words from either field; matching ignores case and accents. Search preserves selections and analysis order. The header checkbox and drag selection affect visible rows while retaining hidden selections. Clear the field using its button or Esc to show the whole list again.

Enable "Restore open sections" in "Settings → General" to restore links, selections, options and confirmed metadata edits in New download, Playlist and YouTube Music on the next launch. It is off by default. Downloads and bulk analysis do not resume automatically. Turning it off removes the saved workspace.

Click a YouTube Music song or album cover to view it larger. Close it using the close button, backdrop or Esc. This does not replace the file's cover art.

Repeat-download warnings use saved History and work after restarting in every section. They recognize the same video, audio, or subtitle track across URL variants and changes to quality, format, or tags. Audio and video are tracked separately; subtitle languages and manual/automatic tracks are distinct. Removing a record or clearing History removes its warning and Downloaded marker while keeping the files.

In a YouTube Music album, turn off "Create album folder" below Metadata to save selected songs and videos directly to the chosen folder. The destination path appears below the checkbox. The preference is remembered; tags and track numbers are preserved.

New download, Playlist, and YouTube Music start with a URL field and an empty preview card. Download options and the final download summary appear after successful automatic analysis. Clearing the URL restores the initial view. The placeholder describes the URLs supported by each section.

Music collections use a table showing track and artist, duration, estimated size, and analysis or download status. The header checkbox selects or clears the rows. Album track numbers and individual playlist covers are preserved; edit a song's tags using the button in its row.

Click a column heading in Playlist or YouTube Music to sort by title, duration, size, or status. A second click reverses the direction; a third restores the source order. Titles use alphabetical ordering, duration and size use numeric ordering, and unknown values stay last. Positive status order starts with downloaded and available entries and ends with errors and unavailable entries. Sorting preserves row selections and track numbers without changing analysis or download queue order.

In regular Playlist, the individual analysis button sits below the status of an unfinished or failed entry. It checks only that entry without resuming paused bulk analysis. Hover over the button for the error reason; status placement and row height are preserved.

Builds from this branch include a dedicated YouTube Music section. Pasting a `music.youtube.com` URL into New download or Playlist opens that section automatically. Download a single song, selected album or playlist songs, or Liked songs after signing in to YouTube in Authorization settings.

Track saves audio from the supplied entry; Video saves video with sound when that same URL provides it. The app does not automatically search for another song or video version. Automatic radio and lyrics are not supported yet.

Analyze an unfinished music collection entry separately using the circular-arrow button below its status. Only that row and the analysis count update; selections and edited tags are preserved, and paused bulk analysis stays paused. Once data is available, a tag-editing pencil appears beside the title. Temporary errors allow another attempt.

In the Metadata dialog, Done saves your edits and Cancel closes the dialog without applying them. Cancel also discards a field reset performed in that dialog.

Audio options include the original format, MP3, M4A, Opus, and FLAC. Choose the source quality and, for MP3, the output bitrate. Conversion availability depends on the installed FFmpeg. FLAC does not improve a compressed source, and its size is not estimated in advance. Only streams available to the current YouTube session are used.

Embed tags and cover art, and edit the title, artist, album, and year before downloading. Albums have shared fields and retain original track numbers. The album artist does not replace individual song artists. Downloads use the existing queue, pause, cancel, and History controls.

Example inside the selected `Music` folder:

```text
Music/
  Artist - Song.opus
  Artist - Album/
    01 - First Song.flac
    07 - Seventh Song.flac
  Evening Playlist/
    Artist - Song.mp3
    Other Artist - Another Song.mp3
```

Existing filenames follow the rename or replace policy selected in settings. Album numbering is preserved when only some songs are selected. This feature is in development and is not included in the published 0.1.2 release.

During a network retry, Queue shows "No connection" and a "Reconnecting" line below progress, with the current attempt and the configured retry limit. Speed and ETA stay hidden until data transfer resumes, while the percentage is preserved. The indicator follows an actual downloader retry message, rather than a temporary lack of speed. Resuming stopped collection analysis checks unfinished entries while preserving completed results and edits.

## Platforms and releases

- **Windows 10/11 x64** - distributed as a portable archive.
- **macOS 12+** - distributed as separate DMG files for Apple Silicon (`arm64`) and Intel (`x64`).

## Installation

### Windows

Extract the entire ZIP archive and run `YTLoadster.exe`. Do not move the EXE away from the `tools` directory.

This build is not digitally signed yet. If the archive came from the Releases page of the official repository, select "More info" in the SmartScreen dialog, verify the `YTLoadster` application name, and choose "Run anyway". Do not run a copy obtained from another source.

### macOS

Open the DMG and drag YTLoadster to `Applications`.

This build uses an ad-hoc signature and is not notarized by Apple yet. If Gatekeeper blocks the first launch, open "System Settings" → "Privacy & Security", find the YTLoadster message, and choose "Open Anyway".

If that option is unavailable, remove the quarantine attribute in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/YTLoadster.app"
```

After running the command, open YTLoadster again from `Applications`.

## Important

Use the application only for content you are legally allowed to download. You are responsible for complying with website terms, copyright law, and the laws of your jurisdiction.

## Running from source

You need Node.js 22+, Rust, and the Tauri system dependencies for your platform.

```powershell
npm.cmd install
npm.cmd run tauri -- dev
```

Run these commands from the repository root. On macOS and Linux, use `npm` instead of `npm.cmd`.

## Privacy and YouTube sign-in

For the "Sign in to YouTube" flow, the application opens an isolated profile in the selected installed Chromium-based browser. After sign-in, only YouTube cookies are stored: they are protected by DPAPI on Windows and by the system Keychain on macOS. The application does not receive the user's password and does not modify the regular browser profile or any already open browser windows.

## Third-party components

The packaged application keeps `LICENSE.txt` and `THIRD_PARTY_NOTICES.md` at the top level. Additional licenses, dependency inventories, and the `COMPONENTS.txt` version manifest are grouped in the `LICENSE/` folder. On macOS, this layout is inside `YTLoadster.app/Contents/Resources/`.

The baseline `yt-dlp` version for local development and new Windows/macOS builds is `2026.10.21`. Windows portable packaging uses the local `tools/windows/x64/yt-dlp.exe`; macOS packaging downloads the version pinned with its SHA-256 in `scripts/prepare-macos-tools.sh`. Component updates in installed applications work independently of this baseline.

Release builds use `yt-dlp`, Deno, FFmpeg, and FFprobe; the macOS FFmpeg build also uses LAME for MP3 support. All tools are included in the application package. Their distribution terms are described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The approved frontend and Rust dependency graph is recorded in [licenses/DEPENDENCIES.md](licenses/DEPENDENCIES.md); notices for frontend components are available in [licenses/FRONTEND_LICENSES.txt](licenses/FRONTEND_LICENSES.txt), and the complete report with Rust component license texts is available in [licenses/DEPENDENCY_LICENSES.html](licenses/DEPENDENCY_LICENSES.html).

## License

YTLoadster's original source code is distributed under the [MIT License](LICENSE).

The MIT License does not replace the licenses of third-party software and libraries distributed with the application. In particular, the standalone `yt-dlp` build is distributed under GPL-3.0-or-later, FFmpeg/FFprobe and LAME under the applicable LGPL variants, and Deno under the MIT License.
