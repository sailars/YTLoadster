use crate::ytdlp::{DownloadPreset, DownloadRequest, SubtitleSelection};
use url::Url;

// History remembers the downloaded object. Queue signatures still identify exact jobs.
fn source_key(value: &str) -> Option<String> {
    let url = Url::parse(value.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?.trim_start_matches("www.");
    let segments: Vec<_> = url
        .path_segments()?
        .filter(|part| !part.is_empty())
        .collect();
    let id = if host == "youtu.be" {
        segments.first()?.to_string()
    } else if host == "youtube.com" || host.ends_with(".youtube.com") {
        if segments.first() == Some(&"watch") {
            url.query_pairs()
                .find(|(key, _)| key == "v")?
                .1
                .trim()
                .to_string()
        } else if matches!(
            segments.first(),
            Some(&"shorts" | &"embed" | &"live" | &"v")
        ) {
            segments.get(1)?.to_string()
        } else {
            return None;
        }
    } else {
        return None;
    };
    if id.is_empty()
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return None;
    }
    Some(format!("youtube:{id}"))
}

pub fn key_for_source(
    url: &str,
    canonical_source: Option<&str>,
    preset: &str,
    subtitle: Option<&SubtitleSelection>,
) -> Option<String> {
    let source = canonical_source
        .and_then(source_key)
        .or_else(|| source_key(url))?;
    let kind = match preset {
        "bestVideo" | "mp4Video" => "video",
        "audioMp3" | "audioM4a" | "audioOpus" | "audioSource" | "audioFlac" => "audio",
        "subtitles" => "subtitles",
        _ => return None,
    };
    let mut parts = vec![source, kind.to_string()];
    if kind == "subtitles" {
        if let Some(subtitle) = subtitle {
            parts.push(subtitle.language.trim().to_lowercase());
            parts.push(
                if subtitle.automatic {
                    "automatic"
                } else {
                    "manual"
                }
                .to_string(),
            );
        }
    }
    serde_json::to_string(&parts).ok()
}

pub fn request_key(request: &DownloadRequest) -> Option<String> {
    let preset = match request.preset {
        DownloadPreset::BestVideo => "bestVideo",
        DownloadPreset::Mp4Video => "mp4Video",
        DownloadPreset::AudioMp3 => "audioMp3",
        DownloadPreset::AudioM4a => "audioM4a",
        DownloadPreset::AudioOpus => "audioOpus",
        DownloadPreset::AudioSource => "audioSource",
        DownloadPreset::AudioFlac => "audioFlac",
        DownloadPreset::Subtitles => "subtitles",
    };
    key_for_source(
        &request.url,
        request.canonical_source.as_deref(),
        preset,
        request.subtitle.as_ref(),
    )
}

pub fn legacy_subtitle_key(request: &DownloadRequest) -> Option<String> {
    if request.preset != DownloadPreset::Subtitles {
        return None;
    }
    key_for_source(
        &request.url,
        request.canonical_source.as_deref(),
        "subtitles",
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_identity_ignores_youtube_link_shape_and_tracking() {
        let expected = Some(r#"["youtube:Ab_c-123","audio"]"#.to_string());
        for url in [
            "https://www.youtube.com/watch?v=Ab_c-123&list=collection&t=15",
            "https://music.youtube.com/watch?v=Ab_c-123",
            "https://youtu.be/Ab_c-123?si=shared",
            "https://m.youtube.com/shorts/Ab_c-123",
            "https://www.youtube.com/embed/Ab_c-123",
            "https://youtube.com/live/Ab_c-123",
        ] {
            assert_eq!(
                key_for_source(url, None, "audioSource", None),
                expected,
                "{url}"
            );
        }
        assert_eq!(
            key_for_source(
                "https://youtu.be/Ab_c-123",
                Some("video:old-key"),
                "audioMp3",
                None
            ),
            expected
        );
        assert_ne!(
            key_for_source("https://youtu.be/other", None, "audioMp3", None),
            expected
        );
    }

    #[test]
    fn history_identity_keeps_media_kinds_and_subtitle_tracks_distinct() {
        let url = "https://youtu.be/same";
        let video = key_for_source(url, None, "bestVideo", None);
        assert_eq!(video, key_for_source(url, None, "mp4Video", None));
        assert_ne!(video, key_for_source(url, None, "audioMp3", None));
        let mut subtitle = SubtitleSelection {
            language: " RU ".into(),
            format: "srt".into(),
            automatic: false,
        };
        let ru = key_for_source(url, None, "subtitles", Some(&subtitle));
        assert_eq!(
            ru.as_deref(),
            Some(r#"["youtube:same","subtitles","ru","manual"]"#)
        );
        subtitle.format = "vtt".into();
        assert_eq!(ru, key_for_source(url, None, "subtitles", Some(&subtitle)));
        subtitle.language = "en".into();
        assert_ne!(ru, key_for_source(url, None, "subtitles", Some(&subtitle)));
        subtitle.language = "ru".into();
        subtitle.automatic = true;
        assert_ne!(ru, key_for_source(url, None, "subtitles", Some(&subtitle)));
    }

    #[test]
    fn history_identity_does_not_confuse_playlists_or_foreign_hosts_with_videos() {
        for url in [
            "https://youtube.com/playlist?list=album",
            "https://youtube.com/@artist",
            "https://youtube.com.evil.test/watch?v=same",
            "https://youtube.com/watch",
            "file:///watch?v=same",
        ] {
            assert!(key_for_source(url, None, "audioSource", None).is_none());
        }
    }
}
