# YTLoadster

[Русский](README.md)

YTLoadster is a desktop application for downloading video, audio, and subtitles from YouTube.

> The current release is `0.1.1` for Windows and macOS. Use the application in accordance with website terms, applicable laws, and copyright holders' rights.

<img width="1232" height="710" alt="YTLoadster main window" src="https://github.com/user-attachments/assets/55b230c8-b4d4-4181-a1e4-0e7f889e3589" />

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

## Settings in the v0.1.2 branch

Settings open as a section in the sidebar. General contains language, completion sound, sleep prevention, close-to-tray, and automatic update checks. Downloads lets you choose a default folder for new single downloads and playlists, a filename template, what to do when a name exists (rename or replace), concurrent downloads and fragments, playlist format matching, and retry counts. You can still choose a different folder for an individual download before adding it to the queue.

Network offers system proxy, no proxy, and manual HTTP, HTTPS, or SOCKS5 with username and password, as well as a custom User-Agent. System proxy and no proxy apply immediately; enter the details and press "Save" for a manual proxy. No proxy means that the application adds no proxy of its own; it does not disable system routing, VPNs, or system proxy clients. Proxy passwords are protected by Windows DPAPI or the macOS Keychain. Authorization contains the existing sign-in options. Appearance offers theme, accent color, and thumbnails in Playlist, Queue, and History. The queue is not restored after an app restart yet.

## Platforms and releases

- **Windows 10/11 x64** - distributed as a portable archive.
- **macOS 12+** - distributed as separate DMG files for Apple Silicon (`arm64`) and Intel (`x64`).

## Installation

### Windows

Extract the entire ZIP archive and run `YTLoadster.exe`. Do not move the EXE away from the `tools` directory.

This build is not digitally signed yet. If the archive came from the Releases page of the official repository, select "More info" in the SmartScreen dialog, verify the `YTLoadster` application name, and choose "Run anyway." Do not run a copy obtained from another source.

### macOS

Open the DMG and drag YTLoadster to `Applications`.

This build uses an ad-hoc signature and is not notarized by Apple yet. If Gatekeeper blocks the first launch, open System Settings -> Privacy & Security, find the YTLoadster message, and choose "Open Anyway."

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

On Windows, Rust build output and its cache use `G:\ytloadster_dev`. The launch command sets this path regardless of the inherited `CARGO_TARGET_DIR`; drive G must be available. Run Rust checks with `npm.cmd run cargo -- test --manifest-path src-tauri/Cargo.toml`, adding a test filter when needed.

## Privacy and YouTube sign-in

For the "Sign in to YouTube" flow, the application opens an isolated profile in the selected installed Chromium-based browser. After sign-in, only YouTube cookies are stored: they are protected by DPAPI on Windows and by the system Keychain on macOS. The application does not receive the user's password and does not modify the regular browser profile or any already open browser windows.

After signing in, wait for YouTube to open and for YTLoadster to confirm sign-in. The session is detected automatically on Windows and macOS, and you can immediately analyze links and download videos. You can leave the window open: the app refreshes cookies in the background and reads a fresh snapshot before analyzing a link or starting a queued job. After closing the separate window, including with Cmd+Q on macOS, the last protected session remains available while it is valid; the temporary profile is removed. Signing out in the separate window removes the saved session until you sign in again. macOS may show a second browser icon in the Dock during sign-in.

Reading cookies from a regular browser is intended for occasional use. macOS may request access to Chrome's Keychain entry; Safari may restrict access to its own cookie storage.

## Third-party components

Release builds use `yt-dlp`, Deno, FFmpeg, and FFprobe; the macOS FFmpeg build also uses LAME for MP3 support. All tools are included in the application package. Their distribution terms are described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The approved frontend and Rust dependency graph is recorded in [licenses/DEPENDENCIES.md](licenses/DEPENDENCIES.md); notices for frontend components are available in [licenses/FRONTEND_LICENSES.txt](licenses/FRONTEND_LICENSES.txt), and the complete report with Rust component license texts is available in [licenses/DEPENDENCY_LICENSES.html](licenses/DEPENDENCY_LICENSES.html).

The "Settings" → "About" section has a separate component update check. After checking, you can install available `yt-dlp`, Deno, and FFmpeg/FFprobe updates without updating YTLoadster. On Windows, FFmpeg comes from BtbN's LGPL shared builds. On macOS, FFmpeg/FFprobe and LAME update together from a verified YTLoadster component release when one is published. If there is no compatible release, the app compares the installed FFmpeg version with official releases. A confirmed up-to-date version is shown as the latest version; a newer official version without an application package is shown with a release link and no install button.

Downloads are verified against the SHA-256 digest from GitHub Releases and launched to check their versions. On Windows, an update replaces the original components in the portable application folder; FFmpeg, FFprobe, and the DLLs are replaced together. The application folder must be writable. On macOS, updates are stored in the user's application data directory to leave the `.app` unchanged. Running jobs finish with their already started components; new jobs use the installed version. Component checks run only when you press the button.

## License

YTLoadster's original source code is distributed under the [MIT License](LICENSE).

The MIT License does not replace the licenses of third-party software and libraries distributed with the application. In particular, the standalone `yt-dlp` build is distributed under GPL-3.0-or-later, FFmpeg/FFprobe and LAME under the applicable LGPL variants, and Deno under the MIT License.
