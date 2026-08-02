# YTLoadster

YTLoadster is a desktop application for downloading video, audio, and subtitles from supported websites.

> This is the first public `0.1.0` release for Windows and macOS. Use the application in accordance with website terms, applicable laws, and copyright holders' rights.

## Features

- Automatic link analysis and selection of available quality options.
- Video, audio, and subtitle downloads.
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

### First-launch warnings

Release `0.1.0` does not yet have commercial Windows code signing or Apple notarization:

- **Windows SmartScreen:** if you obtained the archive from the official repository's Releases page, click "More info" in the warning dialog, verify that the application name is `YTLoadster`, and select "Run anyway."
- **macOS Gatekeeper:** move the application from the DMG to `Applications`. If macOS blocks the first launch, open System Settings -> Privacy & Security, find the message about YTLoadster, and click "Open Anyway."

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
