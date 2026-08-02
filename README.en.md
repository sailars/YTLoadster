# YTLoadster

[Русский](README.md)

YTLoadster is a desktop application for downloading video, audio, and subtitles from YouTube.

> This is the first public `0.1.0` release for Windows and macOS. Use the application in accordance with website terms, applicable laws, and copyright holders' rights.

<img width="1232" height="710" alt="YTLoadster main window" src="https://github.com/user-attachments/assets/55b230c8-b4d4-4181-a1e4-0e7f889e3589" />

## Features

- Automatic analysis of YouTube links and selection of available quality options.
- Video, audio, and subtitle downloads from YouTube.
- Ready-made video profiles for phones, tablets, Smart TVs, and compatible MP4 playback.
- Manual selection of resolution, FPS, container, and codec.
- Pause, resume, and cancel downloads.
- Configurable numbers of parallel downloads and network fragments.
- Dark and light themes.
- Separate YouTube sign-in for restricted videos: the application creates an isolated browser profile and does not affect the user's regular profile.
- Downloading videos that require authentication using cookies.

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

## Privacy and YouTube sign-in

For the "Sign in to YouTube" flow, the application opens an isolated profile in the default installed Chromium-based browser. After sign-in, only YouTube cookies are stored: they are protected by DPAPI on Windows and by the system Keychain on macOS. The application does not receive the user's password and does not modify the regular browser profile or any already open browser windows.

Reading cookies from a regular browser is intended for occasional use. macOS may request access to Chrome's Keychain entry; Safari may restrict access to its own cookie storage.

## Third-party components

Release builds use `yt-dlp`, Deno, FFmpeg, and FFprobe; the macOS FFmpeg build also uses LAME for MP3 support. All tools are included in the application package. Their distribution terms are described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The approved frontend and Rust dependency graph is recorded in [licenses/DEPENDENCIES.md](licenses/DEPENDENCIES.md); notices for frontend components are available in [licenses/FRONTEND_LICENSES.txt](licenses/FRONTEND_LICENSES.txt), and the complete report with Rust component license texts is available in [licenses/DEPENDENCY_LICENSES.html](licenses/DEPENDENCY_LICENSES.html).

## License

YTLoadster's original source code is distributed under the [MIT License](LICENSE).

The MIT License does not replace the licenses of third-party software and libraries distributed with the application. In particular, the standalone `yt-dlp` build is distributed under GPL-3.0-or-later, FFmpeg/FFprobe and LAME under the applicable LGPL variants, and Deno under the MIT License.
