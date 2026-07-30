# Сторонние компоненты

Release-сборки YTLoadster включают следующие сторонние исполняемые компоненты.

## yt-dlp

- Проект: https://github.com/yt-dlp/yt-dlp
- Исходный код основного проекта: The Unlicense.
- Официальный standalone-файл `yt-dlp.exe` также содержит Python, PyInstaller и сторонние пакеты. Совокупный Windows executable распространяется по GNU General Public License, version 3 or later; дополнительные уведомления встроены в executable.

## Deno

- Проект: https://github.com/denoland/deno
- Лицензия: MIT License.
- Deno используется как JavaScript runtime для современного механизма извлечения данных YouTube.

## FFmpeg и FFprobe

- Проект: https://ffmpeg.org/
- Сборка: BtbN FFmpeg Builds, Windows x64 shared LGPL build — https://github.com/BtbN/FFmpeg-Builds
- Лицензия выбранной сборки: GNU Lesser General Public License, version 3 or later.
- В portable входят `ffmpeg.exe`, `ffprobe.exe` и необходимые динамические библиотеки; `ffplay.exe` не включается.

Текст LGPL v3 находится в файле `LGPL-3.0.txt` рядом с этим документом. Версии и SHA-256 включённых исполняемых файлов записаны в `COMPONENTS.txt`. Исходный код и сведения о сборке доступны по ссылкам выше.

## macOS: FFmpeg, FFprobe и LAME

- macOS DMG не использует локальные или Homebrew-бинарники пользователя. GitHub Actions скачивает исходники FFmpeg и LAME по закреплённым URL с проверкой SHA-256, собирает `ffmpeg`/`ffprobe` с `--disable-autodetect --enable-zlib --enable-libmp3lame` и кладёт их вместе с динамической `libmp3lame.0.dylib` в `YTLoadster.app/Contents/Resources/tools/`.
- `libmp3lame` нужен именно для конвертации в MP3: это кодер, который вызывает `yt-dlp`.
- `zlib` включён явно для PNG-кодировщика FFmpeg, который нужен `yt-dlp` при преобразовании и встраивании обложек в аудиофайлы. Используется системная библиотека macOS.
- FFmpeg собирается в LGPL-конфигурации (`--disable-gpl --disable-nonfree`); текст его лицензии находится в DMG как `FFMPEG_LGPL-2.1.txt`.
- LAME распространяется на условиях LGPL; текст лицензии находится в DMG как `LAME_LGPL-2.0.txt`.
- Точные версии, URL исходников, SHA-256 исходников и собранных файлов фиксируются в `COMPONENTS.txt` внутри соответствующего DMG.
- Workflow отклоняет FFmpeg/FFprobe с абсолютными зависимостями Homebrew или runner и перед публикацией проверяет реальную конвертацию в MP3 и встраивание PNG-обложки.
