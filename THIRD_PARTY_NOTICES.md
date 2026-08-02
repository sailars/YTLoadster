# Сторонние компоненты

Собственный код YTLoadster распространяется по MIT License. Release-пакеты
также содержат самостоятельные сторонние исполняемые файлы и библиотеки,
которые сохраняют собственные лицензии. MIT License проекта на них не
распространяется.

## yt-dlp

- Проект: https://github.com/yt-dlp/yt-dlp
- Исходный код самого yt-dlp: The Unlicense.
- Официальные PyInstaller standalone-файлы для Windows и macOS содержат Python и сторонние пакеты. Совокупный executable распространяется по GPL-3.0-or-later.
- Дополнительные уведомления встроены в официальный executable. Полный текст GPL v3 также включается в release-пакет как `YTDLP_GPL-3.0.txt`.
- Версия и ссылка на соответствующий официальный релиз фиксируются в `COMPONENTS.txt`.

## Deno

- Проект: https://github.com/denoland/deno
- Лицензия: MIT License; полный текст включается как `DENO_MIT.txt`.

## Windows: FFmpeg и FFprobe

- Проект: https://ffmpeg.org/
- Сборка: BtbN FFmpeg Builds, Windows x64 shared LGPL build — https://github.com/BtbN/FFmpeg-Builds
- Выбранная сборка не использует `--enable-gpl` или `--enable-nonfree` и распространяется по LGPL-3.0-or-later.
- В portable входят `ffmpeg.exe`, `ffprobe.exe` и необходимые динамические библиотеки; `ffplay.exe` не включается.

Текст LGPL v3 находится в файле `FFMPEG_LGPL-3.0.txt`. Версии, исходный код и сведения о сборке указаны в `COMPONENTS.txt`.

## macOS: FFmpeg, FFprobe и LAME

- macOS-сборка включает FFmpeg, FFprobe и LAME.
- FFmpeg и FFprobe распространяются по LGPL-2.1-or-later.
- LAME распространяется по LGPL-2.0.
- Полные тексты лицензий входят в приложение.
- Версии компонентов и ссылки на исходный код указаны в `COMPONENTS.txt`.

## Tauri, React и зависимости

Приложение использует Tauri, React и сторонние зависимости,
распространяемые по совместимым открытым лицензиям.

Перечень компонентов, правообладателей и применимые тексты лицензий
находятся в `DEPENDENCIES.md`, `FRONTEND_LICENSES.txt` и
`DEPENDENCY_LICENSES.html`.

Названия проектов и товарные знаки принадлежат их владельцам. Этот документ
носит информационный характер и не изменяет условий исходных лицензий.
