use crate::ytdlp::MusicDownloadContext;
use std::path::{Path, PathBuf};

pub fn safe_component(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let mut result = String::new();
    for c in trimmed.chars() {
        if result.len() + c.len_utf8() > 180 {
            break;
        }
        result.push(c);
    }
    let result = result.trim_end_matches([' ', '.']);
    if result.is_empty() {
        return "_".to_string();
    }
    let prefix = result
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(prefix.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (prefix.len() == 4
            && (prefix.starts_with("COM") || prefix.starts_with("LPT"))
            && matches!(prefix.as_bytes()[3], b'1'..=b'9'));
    if reserved {
        format!("_{result}")
    } else {
        result.to_string()
    }
}

fn joined(artist: &str, title: &str) -> String {
    if artist.trim().is_empty() {
        title.to_string()
    } else {
        format!("{} - {title}", artist.trim())
    }
}

pub fn destination_dir(base: &Path, music: Option<&MusicDownloadContext>) -> PathBuf {
    let Some(music) = music else {
        return base.to_path_buf();
    };
    if music.collection_kind == "album" {
        return album_destination_dir(base, &music.metadata.album_artist,
            music.collection_title.as_deref().unwrap_or(&music.metadata.album), music.create_album_folder);
    }
    let title = match music.collection_kind.as_str() {
        "playlist" | "liked" => music.collection_title.clone(),
        _ => None,
    };
    title.filter(|title| !title.trim().is_empty()).map_or_else(
        || base.to_path_buf(),
        |title| base.join(safe_component(&title)),
    )
}

#[tauri::command]
pub fn preview_album_destination(
    base_dir: PathBuf,
    album_artist: String,
    album: String,
    create_album_folder: bool,
) -> String {
    album_destination_dir(&base_dir, &album_artist, &album, create_album_folder)
        .to_string_lossy().into_owned()
}

fn album_destination_dir(base: &Path, artist: &str, album: &str, enabled: bool) -> PathBuf {
    let name = joined(artist, album);
    if enabled && !name.trim().is_empty() {
        base.join(safe_component(&name))
    } else {
        base.to_path_buf()
    }
}

pub fn file_stem(music: &MusicDownloadContext) -> String {
    let value = if music.collection_kind == "album" {
        music.metadata.track_number.map_or_else(
            || music.metadata.title.clone(),
            |number| format!("{number:02} - {}", music.metadata.title),
        )
    } else {
        joined(&music.metadata.artist, &music.metadata.title)
    };
    safe_component(&value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ytdlp::MusicMetadata;
    fn context(kind: &str) -> MusicDownloadContext {
        MusicDownloadContext {
            collection_kind: kind.to_string(),
            collection_title: Some("Album".to_string()),
            source_codec: None,
            source_quality: None,
            create_album_folder: true,
            metadata: MusicMetadata {
                title: "Song".to_string(),
                artist: "Artist, Guest".to_string(),
                album_artist: "Artist".to_string(),
                album: "Album".to_string(),
                year: "2026".to_string(),
                track_number: Some(3),
            },
        }
    }
    #[test]
    fn music_paths_keep_album_positions_and_individual_artists() {
        let base = Path::new("downloads");
        assert_eq!(
            destination_dir(base, Some(&context("album"))),
            base.join("Artist - Album")
        );
        assert_eq!(file_stem(&context("album")), "03 - Song");
        assert_eq!(
            destination_dir(base, Some(&context("playlist"))),
            base.join("Album")
        );
        assert_eq!(file_stem(&context("playlist")), "Artist, Guest - Song");
        assert_eq!(destination_dir(base, Some(&context("single"))), base);
    }
    #[test]
    fn album_folder_choice_preserves_metadata_and_matches_preview() {
        let base = Path::new("downloads");
        let mut album = context("album");
        let metadata = album.metadata.clone();
        for enabled in [true, false] {
            album.create_album_folder = enabled;
            let path = destination_dir(base, Some(&album));
            assert_eq!(path, if enabled { base.join("Artist - Album") } else { base.to_path_buf() });
            assert_eq!(preview_album_destination(base.into(), "Artist".into(), "Album".into(), enabled), path.to_string_lossy());
            assert_eq!(file_stem(&album), "03 - Song");
            assert_eq!(album.metadata, metadata);
            let saved = serde_json::to_string(&album).unwrap();
            assert_eq!(serde_json::from_str::<MusicDownloadContext>(&saved).unwrap(), album);
        }
        let mut playlist = context("playlist");
        playlist.create_album_folder = false;
        assert_eq!(destination_dir(base, Some(&playlist)), base.join("Album"));
        let mut legacy = serde_json::to_value(context("album")).unwrap();
        legacy.as_object_mut().unwrap().remove("createAlbumFolder");
        let restored: MusicDownloadContext = serde_json::from_value(legacy).unwrap();
        assert!(restored.create_album_folder);
        assert_eq!(destination_dir(base, Some(&restored)), base.join("Artist - Album"));
        assert_eq!(preview_album_destination(base.into(), "".into(), "".into(), true), base.to_string_lossy());
        assert_eq!(preview_album_destination(base.into(), "Artist".into(), "../Album".into(), true), destination_dir(base, Some(&MusicDownloadContext { collection_title: Some("../Album".into()), ..context("album") })).to_string_lossy());
    }

    #[test]
    fn untrusted_names_cannot_escape_destination_or_use_reserved_names() {
        assert_eq!(safe_component("../CON/../../file"), "_CON_.._.._file");
        assert_eq!(safe_component("CON.txt"), "_CON.txt");
        assert_eq!(safe_component("..."), "_");
        assert!(safe_component(&"音".repeat(100)).len() <= 180);
        let mut music = context("playlist");
        music.collection_title = Some("../../outside".to_string());
        assert_eq!(
            destination_dir(Path::new("downloads"), Some(&music))
                .components()
                .count(),
            2
        );
    }

    #[test]
    fn reads_music_tags_without_using_the_upload_year() {
        let media = crate::ytdlp::parse_media_info(r#"{"title":"Video title","track":"Song","artists":["Artist","Guest"],"album":"Album","release_date":"20250501","release_year":2024,"upload_date":"20260101","thumbnails":[{"url":"wide","width":1280,"height":720},{"url":"square","width":600,"height":600}]}"#).unwrap();
        let tags = media.music.unwrap();
        assert_eq!(tags.title, "Song");
        assert_eq!(tags.artist, "Artist, Guest");
        assert_eq!(tags.year, "2025");
        assert_eq!(media.thumbnail.as_deref(), Some("square"));
        let ordinary =
            crate::ytdlp::parse_media_info(r#"{"title":"Video","upload_date":"20260101","thumbnail":"original","thumbnails":[{"url":"square","width":600,"height":600}]}"#)
                .unwrap();
        assert!(ordinary.music.is_none());
        assert_eq!(ordinary.thumbnail.as_deref(), Some("original"));
        let clip = crate::ytdlp::parse_media_info(r#"{"title":"Clip","formats":[{"format_id":"18","height":360,"vcodec":"avc1","acodec":"mp4a.40.2","ext":"mp4"},{"format_id":"137","height":1080,"vcodec":"avc1","acodec":"none","ext":"mp4"}]}"#).unwrap();
        assert!(
            clip.video_formats
                .iter()
                .find(|format| format.format_id == "18")
                .unwrap()
                .has_audio
        );
        assert!(
            !clip
                .video_formats
                .iter()
                .find(|format| format.format_id == "137")
                .unwrap()
                .has_audio
        );
    }

    #[test]
    fn legacy_requests_remain_readable_and_music_tags_change_signatures() {
        let request: crate::ytdlp::DownloadRequest = serde_json::from_value(serde_json::json!({"url":"https://www.youtube.com/watch?v=fixture","preset":"audioMp3","destinationDir":"downloads"})).unwrap();
        assert!(request.music.is_none());
        let legacy_signature = crate::downloads::media_signature(&request).unwrap();
        assert!(!legacy_signature.contains("music_metadata"));
        let mut musical = request.clone();
        musical.music = Some(context("single"));
        musical.embed_metadata = Some(true);
        assert_ne!(
            crate::downloads::media_signature(&musical),
            Some(legacy_signature)
        );
        let first = crate::downloads::media_signature(&musical);
        musical.music.as_mut().unwrap().metadata.title = "Edited".to_string();
        assert_ne!(first, crate::downloads::media_signature(&musical));
    }

    #[test]
    #[ignore = "requires bundled yt-dlp, FFmpeg and FFprobe; generates local audio fixtures"]
    fn music_tools_roundtrip() {
        use crate::tools::{ToolInventory, ToolState, ToolStatus};
        use crate::ytdlp::{build_download_args, DownloadPreset, DownloadRequest};
        use std::{
            fs,
            process::Command,
            time::{SystemTime, UNIX_EPOCH},
        };
        let project = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let windows = cfg!(target_os = "windows");
        let tools_dir = std::env::var_os("YTLOADSTER_MUSIC_SMOKE_TOOLS")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                project.join(if windows {
                    "tools/windows/x64"
                } else {
                    "src-tauri/resources/macos/tools"
                })
            });
        let ffmpeg_dir = if windows {
            tools_dir.join("ffmpeg")
        } else {
            tools_dir.clone()
        };
        let tool = |name: &str, path: PathBuf| ToolStatus {
            name: name.to_string(),
            path: Some(path),
            state: ToolState::Found,
            version: None,
            setup_action: None,
        };
        let inventory = ToolInventory {
            ytdlp: tool(
                "yt-dlp",
                tools_dir.join(if windows {
                    "yt-dlp.exe"
                } else {
                    "yt-dlp_macos"
                }),
            ),
            ffmpeg: tool(
                "ffmpeg",
                ffmpeg_dir.join(if windows { "ffmpeg.exe" } else { "ffmpeg" }),
            ),
            ffprobe: tool(
                "ffprobe",
                ffmpeg_dir.join(if windows { "ffprobe.exe" } else { "ffprobe" }),
            ),
            js_runtime: ToolStatus {
                name: "Deno".to_string(),
                path: None,
                state: ToolState::Missing,
                version: None,
                setup_action: None,
            },
        };
        let root = std::env::temp_dir().join(format!(
            "ytloadster-music-smoke-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let run = |program: &Path, args: &[String]| {
            let output = Command::new(program).args(args).output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            output
        };
        let ffmpeg = inventory.ffmpeg.path.as_ref().unwrap();
        let input = root.join("source.m4a");
        let cover = root.join("cover.png");
        run(
            ffmpeg,
            &[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.2",
                "-c:a",
                "aac",
                "-y",
            ]
            .map(str::to_string)
            .into_iter()
            .chain([input.to_string_lossy().to_string()])
            .collect::<Vec<_>>(),
        );
        run(
            ffmpeg,
            &[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x64",
                "-frames:v",
                "1",
                "-y",
            ]
            .map(str::to_string)
            .into_iter()
            .chain([cover.to_string_lossy().to_string()])
            .collect::<Vec<_>>(),
        );
        let info = root.join("info.json");
        let input_url = url::Url::from_file_path(&input).unwrap().to_string();
        fs::write(&info, serde_json::to_vec(&serde_json::json!({"id":"fixture","title":"Source title","extractor":"generic","extractor_key":"Generic","webpage_url":"https://music.youtube.com/watch?v=fixture","duration":0.2,"thumbnail":url::Url::from_file_path(&cover).unwrap().to_string(),"formats":[{"format_id":"audio","url":input_url,"ext":"m4a","acodec":"aac","vcodec":"none"}]})).unwrap()).unwrap();
        for (preset, extension, codec) in [
            (DownloadPreset::AudioSource, "m4a", "aac"),
            (DownloadPreset::AudioMp3, "mp3", "mp3"),
            (DownloadPreset::AudioM4a, "m4a", "aac"),
            (DownloadPreset::AudioOpus, "opus", "opus"),
            (DownloadPreset::AudioFlac, "flac", "flac"),
        ] {
            let destination = root.join(format!("{:?}", preset));
            fs::create_dir_all(&destination).unwrap();
            let mut music = context("album");
            music.metadata.title = "Song: 100% \\ 雪".to_string();
            let request = DownloadRequest {
                music: Some(music.clone()),
                url: "https://music.youtube.com/watch?v=fixture".to_string(),
                canonical_source: None,
                title: None,
                thumbnail: None,
                preset,
                format_id: Some("audio".to_string()),
                audio_format_id: None,
                video_profile: None,
                format_label: None,
                include_video_technical_details_in_filename: false,
                video_technical_details: None,
                destination_dir: destination.clone(),
                cookie_source: None,
                audio_bitrate: None,
                audio_channels: Some("source".to_string()),
                embed_metadata: Some(true),
                embed_thumbnail: Some(true),
                subtitle: None,
            };
            let mut args = build_download_args(&request, &inventory);
            args.pop();
            args.extend([
                "--ignore-config".to_string(),
                "--no-cache-dir".to_string(),
                "--enable-file-urls".to_string(),
                "--load-info-json".to_string(),
                info.to_string_lossy().to_string(),
                "-o".to_string(),
                "output.%(ext)s".to_string(),
            ]);
            run(inventory.ytdlp.path.as_ref().unwrap(), &args);
            let output_path = destination.join(format!("output.{extension}"));
            let probe = run(
                inventory.ffprobe.path.as_ref().unwrap(),
                &[
                    "-v".into(),
                    "error".into(),
                    "-show_format".into(),
                    "-show_streams".into(),
                    "-of".into(),
                    "json".into(),
                    output_path.to_string_lossy().to_string(),
                ],
            );
            let parsed: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
            let streams = parsed["streams"].as_array().unwrap();
            assert!(streams.iter().any(|stream| stream["codec_name"] == codec));
            assert!(
                streams
                    .iter()
                    .any(|stream| stream["disposition"]["attached_pic"] == 1),
                "missing cover: {extension}"
            );
            let mut tags = parsed["format"]["tags"]
                .as_object()
                .cloned()
                .unwrap_or_default();
            for stream in streams
                .iter()
                .filter(|stream| stream["codec_type"] == "audio")
            {
                if let Some(stream_tags) = stream["tags"].as_object() {
                    tags.extend(stream_tags.clone());
                }
            }
            let title = tags
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case("title"))
                .unwrap()
                .1;
            assert_eq!(title.as_str(), Some(music.metadata.title.as_str()));
            let year = tags
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case("date"))
                .unwrap()
                .1;
            assert_eq!(year.as_str(), Some("2026"));
        }
        fs::remove_dir_all(&root).unwrap();
    }
}
