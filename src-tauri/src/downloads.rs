use crate::tools::{discover_tools, ToolConfig, ToolState};
use crate::ytdlp::{
    build_download_args, hide_windows_console, humanize_ytdlp_error_for_browser, ytdlp_process_env,
    ytdlp_process_path, CookieSource, DownloadPreset, DownloadRequest,
};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub const INSUFFICIENT_DISK_SPACE_ERROR: &str = "download-error:insufficient-disk-space";
pub const MISSING_FFMPEG_ERROR: &str = "download-error:missing-ffmpeg";
pub const DUPLICATE_VIDEO_ERROR: &str = "enqueue-error:duplicate-video";
pub const DUPLICATE_AUDIO_ERROR: &str = "enqueue-error:duplicate-audio";
pub const DUPLICATE_SUBTITLES_ERROR: &str = "enqueue-error:duplicate-subtitles";
const OUTPUT_PATH_PREFIX: &str = "YTLOADSTER_OUTPUT|";
const MAX_OUTPUT_FILENAME_BYTES: usize = 240;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum JobState {
    Pending,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum JobPhase {
    Downloading,
    DownloadingVideo,
    DownloadingAudio,
    Merging,
    PostProcessing,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: u64,
    pub request: DownloadRequest,
    pub state: JobState,
    pub phase: Option<JobPhase>,
    pub progress_percent: Option<u8>,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadProgress {
    pub percent: u8,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub phase: Option<JobPhase>,
}

#[derive(Debug, Default)]
struct DownloadState {
    next_id: u64,
    jobs: Vec<Job>,
    active_downloads: HashMap<u64, ActiveDownload>,
    concurrency: u8,
    fragment_concurrency: u8,
}

#[derive(Debug, Clone)]
struct ActiveDownload {
    pid: u32,
    cache_dir: PathBuf,
    destination_dir: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct DownloadManager {
    inner: Arc<Mutex<DownloadState>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self::with_settings(2, 1)
    }

    pub fn with_concurrency(concurrency: u8) -> Self {
        Self::with_settings(concurrency, 1)
    }

    pub fn with_settings(concurrency: u8, fragment_concurrency: u8) -> Self {
        Self {
            inner: Arc::new(Mutex::new(DownloadState {
                next_id: 1,
                jobs: Vec::new(),
                active_downloads: HashMap::new(),
                concurrency: normalize_concurrency(concurrency),
                fragment_concurrency: normalize_fragment_concurrency(fragment_concurrency),
            })),
        }
    }

    pub fn try_enqueue(&self, request: DownloadRequest) -> Result<Job, String> {
        let mut state = self.inner.lock().expect("download state mutex poisoned");
        if let Some(error) = duplicate_error_for_request(&state.jobs, &request, None) {
            return Err(error.to_string());
        }
        Ok(push_job(&mut state, request))
    }

    #[cfg(test)]
    pub fn enqueue(&self, request: DownloadRequest) -> Job {
        let mut state = self.inner.lock().expect("download state mutex poisoned");
        push_job(&mut state, request)
    }

    pub fn jobs(&self) -> Vec<Job> {
        self.inner
            .lock()
            .expect("download state mutex poisoned")
            .jobs
            .clone()
    }

    pub fn cancel(&self, id: u64) -> Result<(), String> {
        self.cancel_with_process_killer(id, kill_process_tree)
    }

    pub fn pause(&self, id: u64) -> Result<(), String> {
        self.pause_with_process_killer(id, kill_process_tree)
    }

    pub fn pause_all(&self) -> Result<Vec<Job>, String> {
        self.pause_all_with_process_killer(kill_process_tree)
    }

    fn pause_with_process_killer(
        &self,
        id: u64,
        kill_process: impl Fn(u32) -> Result<(), String>,
    ) -> Result<(), String> {
        let active = {
            self.inner
                .lock()
                .expect("download state mutex poisoned")
                .active_downloads
                .get(&id)
                .cloned()
        };

        self.update_job(id, |job| {
            if matches!(
                job.state,
                JobState::Completed | JobState::Failed | JobState::Cancelled
            ) {
                return;
            }
            job.state = JobState::Paused;
            job.phase = None;
            job.speed = None;
            job.eta = None;
            job.error = None;
        })
        .map(|_| ())?;

        if let Some(active) = active {
            let _ = kill_process(active.pid);
        }

        Ok(())
    }

    fn pause_all_with_process_killer(
        &self,
        kill_process: impl Fn(u32) -> Result<(), String>,
    ) -> Result<Vec<Job>, String> {
        let (active_downloads, paused) = {
            let mut state = self.inner.lock().expect("download state mutex poisoned");
            let active_downloads = state.active_downloads.values().cloned().collect::<Vec<_>>();
            let mut paused = Vec::new();
            for job in state.jobs.iter_mut() {
                if matches!(job.state, JobState::Pending | JobState::Running) {
                    job.state = JobState::Paused;
                    job.phase = None;
                    job.speed = None;
                    job.eta = None;
                    job.error = None;
                    paused.push(job.clone());
                }
            }
            (active_downloads, paused)
        };

        for active in active_downloads {
            let _ = kill_process(active.pid);
        }

        Ok(paused)
    }

    fn cancel_with_process_killer(
        &self,
        id: u64,
        kill_process: impl Fn(u32) -> Result<(), String>,
    ) -> Result<(), String> {
        let (active, paused_download) = {
            let state = self.inner.lock().expect("download state mutex poisoned");
            let active = state.active_downloads.get(&id).cloned();
            let paused_download = state
                .jobs
                .iter()
                .find(|job| job.id == id && job.state == JobState::Paused)
                .map(|job| (job.request.destination_dir.clone(), false));
            (active, paused_download)
        };

        self.update_job(id, |job| {
            job.state = JobState::Cancelled;
            job.phase = None;
            job.progress_percent = None;
            job.speed = None;
            job.eta = None;
            job.error = None;
        })
        .map(|_| ())?;

        if let Some(active) = active {
            let _ = kill_process(active.pid);
        } else if let Some((destination_dir, remove_destination_parts)) = paused_download {
            let active = ActiveDownload {
                pid: 0,
                cache_dir: partial_cache_dir(&destination_dir, id),
                destination_dir,
            };
            let _ = cleanup_cancelled_download(&active, remove_destination_parts);
        }

        Ok(())
    }

    pub fn cancel_all(&self) -> Result<Vec<Job>, String> {
        let active_downloads = {
            self.inner
                .lock()
                .expect("download state mutex poisoned")
                .active_downloads
                .values()
                .cloned()
                .collect::<Vec<_>>()
        };

        for active in &active_downloads {
            let _ = kill_process_tree(active.pid);
        }

        let mut state = self.inner.lock().expect("download state mutex poisoned");
        let mut cancelled = Vec::new();
        for job in state.jobs.iter_mut() {
            if matches!(
                job.state,
                JobState::Pending | JobState::Running | JobState::Paused
            ) {
                job.state = JobState::Cancelled;
                job.phase = None;
                job.progress_percent = None;
                job.speed = None;
                job.eta = None;
                job.error = None;
                cancelled.push(job.clone());
            }
        }
        Ok(cancelled)
    }

    pub fn retry(&self, id: u64) -> Result<Job, String> {
        let mut state = self.inner.lock().expect("download state mutex poisoned");
        let index = state
            .jobs
            .iter()
            .position(|job| job.id == id)
            .ok_or_else(|| format!("job {id} was not found"))?;
        if !matches!(
            state.jobs[index].state,
            JobState::Failed | JobState::Cancelled
        ) {
            return Err(format!("job {id} cannot be retried"));
        }

        let request = state.jobs[index].request.clone();
        if let Some(error) = duplicate_error_for_request(&state.jobs, &request, Some(id)) {
            return Err(error.to_string());
        }
        state.jobs.remove(index);
        let job = Job {
            id: state.next_id,
            request,
            state: JobState::Pending,
            phase: None,
            progress_percent: None,
            speed: None,
            eta: None,
            error: None,
        };
        state.next_id += 1;
        state.jobs.push(job.clone());

        Ok(job)
    }

    pub fn resume(&self, id: u64) -> Result<Job, String> {
        self.update_job(id, |job| {
            if job.state == JobState::Paused {
                job.state = JobState::Pending;
                job.phase = None;
                job.speed = None;
                job.eta = None;
                job.error = None;
            }
        })
    }

    pub fn resume_all(&self) -> Result<Vec<Job>, String> {
        let mut state = self.inner.lock().expect("download state mutex poisoned");
        let mut resumed = Vec::new();
        for job in state.jobs.iter_mut() {
            if job.state == JobState::Paused {
                job.state = JobState::Pending;
                job.phase = None;
                job.speed = None;
                job.eta = None;
                job.error = None;
                resumed.push(job.clone());
            }
        }
        Ok(resumed)
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut state = self.inner.lock().expect("download state mutex poisoned");
        state.jobs.retain(|job| {
            !matches!(
                job.state,
                JobState::Completed | JobState::Failed | JobState::Cancelled
            )
        });
        Ok(())
    }

    pub fn remove(&self, id: u64) -> Result<(), String> {
        let mut state = self.inner.lock().expect("download state mutex poisoned");
        if state.active_downloads.contains_key(&id) {
            return Err(format!("job {id} is active and cannot be removed"));
        }

        let index = state
            .jobs
            .iter()
            .position(|job| job.id == id)
            .ok_or_else(|| format!("job {id} was not found"))?;

        if state.jobs[index].state == JobState::Running {
            return Err(format!("job {id} is running and cannot be removed"));
        }

        state.jobs.remove(index);
        Ok(())
    }

    pub fn set_concurrency(&self, concurrency: u8) {
        self.inner
            .lock()
            .expect("download state mutex poisoned")
            .concurrency = normalize_concurrency(concurrency);
    }

    pub fn set_fragment_concurrency(&self, fragment_concurrency: u8) {
        self.inner
            .lock()
            .expect("download state mutex poisoned")
            .fragment_concurrency = normalize_fragment_concurrency(fragment_concurrency);
    }

    fn fragment_concurrency(&self) -> u8 {
        self.inner
            .lock()
            .expect("download state mutex poisoned")
            .fragment_concurrency
    }

    pub fn mark_running(&self, id: u64) -> Result<Job, String> {
        self.update_job(id, |job| {
            job.state = JobState::Running;
            job.phase = Some(initial_download_phase(&job.request));
            job.error = None;
        })
    }

    pub fn mark_completed(&self, id: u64) -> Result<Job, String> {
        self.update_job(id, |job| {
            if matches!(job.state, JobState::Cancelled | JobState::Paused) {
                return;
            }
            job.state = JobState::Completed;
            job.phase = None;
            job.progress_percent = Some(100);
            job.speed = None;
            job.eta = None;
            job.error = None;
        })
    }

    pub fn mark_failed(&self, id: u64, error: String) -> Result<Job, String> {
        self.update_job(id, |job| {
            if matches!(job.state, JobState::Cancelled | JobState::Paused) {
                return;
            }
            job.state = JobState::Failed;
            job.phase = None;
            job.progress_percent = None;
            job.speed = None;
            job.eta = None;
            job.error = Some(error);
        })
    }

    pub fn mark_progress(&self, id: u64, progress: DownloadProgress) -> Result<Job, String> {
        self.update_job(id, |job| {
            if matches!(
                job.state,
                JobState::Cancelled | JobState::Paused | JobState::Completed | JobState::Failed
            ) {
                return;
            }
            job.state = JobState::Running;
            job.phase = progress.phase.or(job.phase).or(Some(JobPhase::Downloading));
            job.progress_percent = Some(progress.percent);
            job.speed = progress.speed;
            job.eta = progress.eta;
            job.error = None;
        })
    }

    pub fn mark_post_processing(&self, id: u64) -> Result<Job, String> {
        self.update_job(id, |job| {
            if matches!(
                job.state,
                JobState::Cancelled | JobState::Paused | JobState::Completed | JobState::Failed
            ) {
                return;
            }
            job.state = JobState::Running;
            job.phase = Some(JobPhase::PostProcessing);
            job.progress_percent = Some(100);
            job.speed = None;
            job.eta = None;
            job.error = None;
        })
    }

    pub fn mark_merging(&self, id: u64) -> Result<Job, String> {
        self.update_job(id, |job| {
            if matches!(
                job.state,
                JobState::Cancelled | JobState::Paused | JobState::Completed | JobState::Failed
            ) {
                return;
            }
            job.state = JobState::Running;
            job.phase = Some(JobPhase::Merging);
            job.progress_percent = Some(100);
            job.speed = None;
            job.eta = None;
            job.error = None;
        })
    }

    fn register_process(&self, id: u64, active: ActiveDownload) {
        self.inner
            .lock()
            .expect("download state mutex poisoned")
            .active_downloads
            .insert(id, active);
    }

    fn unregister_process(&self, id: u64) {
        self.inner
            .lock()
            .expect("download state mutex poisoned")
            .active_downloads
            .remove(&id);
    }

    #[cfg(test)]
    fn has_active_download_in_destination(&self, destination_dir: &Path) -> bool {
        self.inner
            .lock()
            .expect("download state mutex poisoned")
            .active_downloads
            .values()
            .any(|active| active.destination_dir == destination_dir)
    }

    fn job_state(&self, id: u64) -> Option<JobState> {
        self.inner
            .lock()
            .expect("download state mutex poisoned")
            .jobs
            .iter()
            .find(|job| job.id == id)
            .map(|job| job.state)
    }

    fn update_job(&self, id: u64, update: impl FnOnce(&mut Job)) -> Result<Job, String> {
        let mut state = self.inner.lock().expect("download state mutex poisoned");
        let job = state
            .jobs
            .iter_mut()
            .find(|job| job.id == id)
            .ok_or_else(|| format!("job {id} was not found"))?;
        update(job);
        Ok(job.clone())
    }

    fn reserve_pending_jobs(&self) -> Vec<Job> {
        let mut state = self.inner.lock().expect("download state mutex poisoned");
        let running_jobs = state
            .jobs
            .iter()
            .filter(|job| job.state == JobState::Running)
            .count();
        let occupied = running_jobs.max(state.active_downloads.len());
        let available = usize::from(state.concurrency).saturating_sub(occupied);
        if available == 0 {
            return Vec::new();
        }

        state
            .jobs
            .iter_mut()
            .filter(|job| job.state == JobState::Pending)
            .take(available)
            .map(|job| {
                job.state = JobState::Running;
                job.phase = Some(initial_download_phase(&job.request));
                job.error = None;
                job.clone()
            })
            .collect()
    }
}

#[derive(Debug, PartialEq, Eq)]
struct VideoJobSignature {
    canonical_source: String,
    video_format_id: Option<String>,
    audio_format_id: Option<String>,
    requested_container: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct AudioJobSignature {
    canonical_source: String,
    audio_format_id: Option<String>,
    output_format: &'static str,
    bitrate: Option<String>,
    channels: &'static str,
    embed_metadata: bool,
    embed_thumbnail: bool,
}

#[derive(Debug, PartialEq, Eq)]
struct SubtitleJobSignature {
    canonical_source: String,
    language: String,
    format: String,
    automatic: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum MediaJobSignature {
    Video(VideoJobSignature),
    Audio(AudioJobSignature),
    Subtitles(SubtitleJobSignature),
}

fn video_job_signature(request: &DownloadRequest) -> Option<VideoJobSignature> {
    if !matches!(
        request.preset,
        DownloadPreset::BestVideo | DownloadPreset::Mp4Video
    ) {
        return None;
    }

    Some(VideoJobSignature {
        canonical_source: canonical_source(request),
        video_format_id: normalized_text(request.format_id.as_deref()),
        audio_format_id: normalized_text(request.audio_format_id.as_deref()),
        requested_container: normalized_text(
            request
                .video_technical_details
                .as_ref()
                .and_then(|details| details.requested_container.as_deref())
                .or_else(|| matches!(request.preset, DownloadPreset::Mp4Video).then_some("mp4")),
        )
        .map(|container| container.to_ascii_lowercase()),
    })
}

fn audio_job_signature(request: &DownloadRequest) -> Option<AudioJobSignature> {
    let output_format = match request.preset {
        DownloadPreset::AudioMp3 => "mp3",
        DownloadPreset::AudioM4a => "m4a",
        DownloadPreset::AudioOpus => "opus",
        _ => return None,
    };

    let channels = match request.audio_channels.as_deref() {
        Some("mono") => "mono",
        Some("stereo") => "stereo",
        _ => "source",
    };

    Some(AudioJobSignature {
        canonical_source: canonical_source(request),
        audio_format_id: normalized_text(request.format_id.as_deref()),
        output_format,
        bitrate: normalized_text(request.audio_bitrate.as_deref())
            .map(|value| value.to_ascii_lowercase()),
        channels,
        embed_metadata: request.embed_metadata.unwrap_or(false),
        embed_thumbnail: request.embed_thumbnail.unwrap_or(false),
    })
}

fn subtitle_job_signature(request: &DownloadRequest) -> Option<SubtitleJobSignature> {
    if request.preset != DownloadPreset::Subtitles {
        return None;
    }
    let subtitle = request.subtitle.as_ref()?;
    Some(SubtitleJobSignature {
        canonical_source: canonical_source(request),
        language: subtitle.language.trim().to_ascii_lowercase(),
        format: subtitle.format.trim().to_ascii_lowercase(),
        automatic: subtitle.automatic,
    })
}

fn media_job_signature(request: &DownloadRequest) -> Option<MediaJobSignature> {
    if let Some(signature) = video_job_signature(request) {
        return Some(MediaJobSignature::Video(signature));
    }
    if let Some(signature) = audio_job_signature(request) {
        return Some(MediaJobSignature::Audio(signature));
    }
    subtitle_job_signature(request).map(MediaJobSignature::Subtitles)
}

fn canonical_source(request: &DownloadRequest) -> String {
    normalized_text(Some(
        request.canonical_source.as_deref().unwrap_or(&request.url),
    ))
    .unwrap_or_default()
}

fn normalized_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn duplicate_error_for_request(
    jobs: &[Job],
    request: &DownloadRequest,
    excluded_id: Option<u64>,
) -> Option<&'static str> {
    let signature = media_job_signature(request)?;

    let duplicate = jobs.iter().any(|job| {
        Some(job.id) != excluded_id
            && matches!(
                job.state,
                JobState::Pending | JobState::Running | JobState::Paused | JobState::Completed
            )
            && media_job_signature(&job.request).as_ref() == Some(&signature)
    });
    if !duplicate {
        return None;
    };

    Some(match signature {
        MediaJobSignature::Video(_) => DUPLICATE_VIDEO_ERROR,
        MediaJobSignature::Audio(_) => DUPLICATE_AUDIO_ERROR,
        MediaJobSignature::Subtitles(_) => DUPLICATE_SUBTITLES_ERROR,
    })
}

fn push_job(state: &mut DownloadState, request: DownloadRequest) -> Job {
    let job = Job {
        id: state.next_id,
        request,
        state: JobState::Pending,
        phase: None,
        progress_percent: None,
        speed: None,
        eta: None,
        error: None,
    };
    state.next_id += 1;
    state.jobs.push(job.clone());
    job
}

#[tauri::command]
pub fn enqueue_download(
    request: DownloadRequest,
    manager: State<'_, DownloadManager>,
    app: AppHandle,
) -> Result<Job, String> {
    let job = manager.try_enqueue(request.clone())?;
    schedule_pending_downloads(manager.inner().clone(), app);

    Ok(manager
        .jobs()
        .into_iter()
        .find(|current| current.id == job.id)
        .unwrap_or(job))
}

#[tauri::command]
pub fn get_jobs(manager: State<'_, DownloadManager>) -> Vec<Job> {
    manager.jobs()
}

#[tauri::command]
pub fn cancel_job(
    id: u64,
    manager: State<'_, DownloadManager>,
    app: AppHandle,
) -> Result<(), String> {
    manager.cancel(id)?;
    schedule_pending_downloads(manager.inner().clone(), app);
    Ok(())
}

#[tauri::command]
pub fn pause_job(
    id: u64,
    manager: State<'_, DownloadManager>,
    app: AppHandle,
) -> Result<(), String> {
    manager.pause(id)?;
    if let Some(job) = manager.jobs().into_iter().find(|job| job.id == id) {
        emit_job(&app, Ok(job));
    }
    schedule_pending_downloads(manager.inner().clone(), app);
    Ok(())
}

#[tauri::command]
pub fn pause_all_jobs(manager: State<'_, DownloadManager>, app: AppHandle) -> Result<(), String> {
    for job in manager.pause_all()? {
        emit_job(&app, Ok(job));
    }
    Ok(())
}

#[tauri::command]
pub fn resume_job(
    id: u64,
    manager: State<'_, DownloadManager>,
    app: AppHandle,
) -> Result<(), String> {
    let job = manager.resume(id)?;
    emit_job(&app, Ok(job));
    schedule_pending_downloads(manager.inner().clone(), app);
    Ok(())
}

#[tauri::command]
pub fn resume_all_jobs(manager: State<'_, DownloadManager>, app: AppHandle) -> Result<(), String> {
    for job in manager.resume_all()? {
        emit_job(&app, Ok(job));
    }
    schedule_pending_downloads(manager.inner().clone(), app);
    Ok(())
}

#[tauri::command]
pub fn cancel_all_jobs(manager: State<'_, DownloadManager>, app: AppHandle) -> Result<(), String> {
    for job in manager.cancel_all()? {
        emit_job(&app, Ok(job));
    }
    Ok(())
}

#[tauri::command]
pub fn retry_job(
    id: u64,
    manager: State<'_, DownloadManager>,
    app: AppHandle,
) -> Result<Job, String> {
    let job = manager.retry(id)?;
    schedule_pending_downloads(manager.inner().clone(), app);
    Ok(manager
        .jobs()
        .into_iter()
        .find(|current| current.id == job.id)
        .unwrap_or(job))
}

#[tauri::command]
pub fn clear_jobs(manager: State<'_, DownloadManager>) -> Result<(), String> {
    manager.clear()
}

#[tauri::command]
pub fn remove_job(id: u64, manager: State<'_, DownloadManager>) -> Result<(), String> {
    manager.remove(id)
}

#[tauri::command]
pub fn open_download_folder(path: PathBuf) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("папка не найдена: {}", path.display()));
    }

    let (program, args) = open_folder_command(&path);
    std::process::Command::new(program)
        .args(args)
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn schedule_pending_downloads(manager: DownloadManager, app: AppHandle) {
    for job in manager.reserve_pending_jobs() {
        emit_job(&app, Ok(job.clone()));
        let manager = manager.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            run_download(job.id, job.request, manager, app).await;
        });
    }
}

pub fn normalize_concurrency(concurrency: u8) -> u8 {
    if [1, 2, 4, 6, 8].contains(&concurrency) {
        concurrency
    } else if concurrency == 16 {
        8
    } else {
        1
    }
}

pub fn normalize_fragment_concurrency(fragment_concurrency: u8) -> u8 {
    if [1, 2, 4, 8].contains(&fragment_concurrency) {
        fragment_concurrency
    } else if fragment_concurrency == 16 {
        8
    } else {
        1
    }
}

async fn run_download(
    job_id: u64,
    request: DownloadRequest,
    manager: DownloadManager,
    app: AppHandle,
) {
    let materialized_cookies =
        if matches!(request.cookie_source, Some(CookieSource::YoutubeSession)) {
            match crate::auth::materialize_youtube_cookies(&app) {
                Ok(cookies) => Some(cookies),
                Err(error) => {
                    emit_job(&app, manager.mark_failed(job_id, error));
                    schedule_pending_downloads(manager, app);
                    return;
                }
            }
        } else {
            None
        };
    let mut effective_request = request.clone();
    if let Some(cookies) = materialized_cookies.as_ref() {
        effective_request.cookie_source = Some(CookieSource::File(cookies.path().to_path_buf()));
    }
    let inventory = discover_tools(
        ToolConfig::default(),
        crate::tools::ToolEnvironment::current_for_app(&app),
    );
    if inventory.ytdlp.state != ToolState::Found {
        emit_job(
            &app,
            manager.mark_failed(
                job_id,
                "Не удалось запустить загрузку. Проверьте целостность установки программы."
                    .to_string(),
            ),
        );
        schedule_pending_downloads(manager, app);
        return;
    }

    let Some(ytdlp_path) = inventory.ytdlp.path.as_ref() else {
        emit_job(
            &app,
            manager.mark_failed(
                job_id,
                "Не удалось запустить загрузку. Проверьте целостность установки программы."
                    .to_string(),
            ),
        );
        schedule_pending_downloads(manager, app);
        return;
    };

    // All video modes request separate video and audio streams, and the
    // audio modes use yt-dlp post-processing.  Do not let yt-dlp silently
    // fall back to a lower-quality progressive stream or leave a lone audio
    // stream when the bundled FFmpeg pair cannot be found.
    if download_requires_ffmpeg(&request)
        && (inventory.ffmpeg.state != ToolState::Found
            || inventory.ffmpeg.path.is_none()
            || inventory.ffprobe.state != ToolState::Found
            || inventory.ffprobe.path.is_none())
    {
        emit_job(
            &app,
            manager.mark_failed(job_id, MISSING_FFMPEG_ERROR.to_string()),
        );
        schedule_pending_downloads(manager, app);
        return;
    }

    let cache_dir = partial_cache_dir(&request.destination_dir, job_id);
    let output_dir = cache_dir.join("output");
    let temp_dir = cache_dir.join("temp");
    if let Err(err) = fs::create_dir_all(&output_dir).and_then(|_| fs::create_dir_all(&temp_dir)) {
        emit_job(&app, manager.mark_failed(job_id, err.to_string()));
        let _ = fs::remove_dir_all(&cache_dir);
        schedule_pending_downloads(manager, app);
        return;
    }

    let mut args = build_download_args(&effective_request, &inventory);
    set_home_path_args(&mut args, &output_dir);
    add_output_tracking_args(&mut args);
    add_fragment_concurrency_args(&mut args, manager.fragment_concurrency());
    add_temp_path_args(&mut args, &temp_dir);
    let mut process = Command::new(ytdlp_path);
    process
        .args(args)
        .envs(ytdlp_process_env())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(path) = ytdlp_process_path(&inventory, std::env::var_os("PATH")) {
        process.env("PATH", path);
    }
    hide_windows_console(&mut process);

    let mut child = match process.spawn() {
        Ok(child) => child,
        Err(_) => {
            emit_job(
                &app,
                manager.mark_failed(
                    job_id,
                    "Не удалось запустить загрузку. Проверьте целостность установки программы."
                        .to_string(),
                ),
            );
            let _ = fs::remove_dir_all(&cache_dir);
            schedule_pending_downloads(manager, app);
            return;
        }
    };

    if let Some(pid) = child.id() {
        manager.register_process(
            job_id,
            ActiveDownload {
                pid,
                cache_dir: cache_dir.clone(),
                destination_dir: request.destination_dir.clone(),
            },
        );
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let progress_manager = manager.clone();
    let progress_app = app.clone();
    let stdout_task = tauri::async_runtime::spawn(async move {
        let mut output_path = None;
        if let Some(stdout) = stdout {
            let mut reader = BufReader::new(stdout);
            while let Ok(Some(line)) = read_process_line(&mut reader).await {
                if let Some(path) = parse_output_path_line(&line) {
                    output_path = Some(path);
                } else if let Some(progress) = parse_progress_line(&line) {
                    emit_job(
                        &progress_app,
                        progress_manager.mark_progress(job_id, progress),
                    );
                } else if is_video_merging_line(&line) {
                    emit_job(&progress_app, progress_manager.mark_merging(job_id));
                } else if is_post_processing_line(&line) {
                    emit_job(&progress_app, progress_manager.mark_post_processing(job_id));
                }
            }
        }
        output_path
    });

    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut collected = String::new();
        if let Some(stderr) = stderr {
            let mut reader = BufReader::new(stderr);
            while let Ok(Some(line)) = read_process_line(&mut reader).await {
                if !collected.is_empty() {
                    collected.push('\n');
                }
                collected.push_str(&line);
            }
        }
        collected
    });

    let status = child.wait().await;
    manager.unregister_process(job_id);
    let job_state_after_exit = manager.job_state(job_id);
    let output_path = stdout_task.await.unwrap_or_default();
    let stderr = stderr_task.await.unwrap_or_default();

    if job_state_after_exit == Some(JobState::Paused) {
        schedule_pending_downloads(manager, app);
        return;
    }

    if job_state_after_exit == Some(JobState::Cancelled) {
        let _ = fs::remove_dir_all(cache_dir);
        schedule_pending_downloads(manager, app);
        return;
    }

    match status {
        Ok(status) if status.success() => {
            let finalized = resolve_output_file(output_path.as_deref(), &output_dir, &request)
                .and_then(|source| {
                    finalize_output_without_overwrite(&source, &request.destination_dir, &request)
                        .map(|_| ())
                });

            match finalized {
                Ok(()) => emit_job(&app, manager.mark_completed(job_id)),
                Err(error) => emit_job(&app, manager.mark_failed(job_id, error)),
            }
            let _ = fs::remove_dir_all(&cache_dir);
        }
        Ok(_) => {
            let message = if is_insufficient_disk_space_error(&stderr) {
                INSUFFICIENT_DISK_SPACE_ERROR.to_string()
            } else if stderr.trim().is_empty() {
                "Загрузка завершилась ошибкой без подробного сообщения.".to_string()
            } else {
                let browser = match request.cookie_source.as_ref() {
                    Some(CookieSource::Browser { browser, .. }) => Some(browser.as_str()),
                    _ => None,
                };
                humanize_ytdlp_error_for_browser(stderr.trim(), browser)
            };
            emit_job(&app, manager.mark_failed(job_id, message));
            let _ = fs::remove_dir_all(&cache_dir);
        }
        Err(_) => {
            emit_job(
                &app,
                manager.mark_failed(
                    job_id,
                    "Не удалось завершить загрузку. Повторите попытку.".to_string(),
                ),
            );
            let _ = fs::remove_dir_all(&cache_dir);
        }
    }
    schedule_pending_downloads(manager, app);
}

fn download_requires_ffmpeg(request: &DownloadRequest) -> bool {
    !matches!(request.preset, DownloadPreset::Subtitles)
}

pub fn is_insufficient_disk_space_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    [
        "no space left on device",
        "enospc",
        "disk full",
        "disk is full",
        "full disk",
        "filesystem full",
        "not enough free disk space",
        "insufficient disk space",
        "not enough space on the disk",
        "there is not enough space on the disk",
    ]
    .iter()
    .any(|variant| normalized.contains(variant))
}

fn partial_cache_dir(destination_dir: &Path, job_id: u64) -> PathBuf {
    destination_dir
        .join(".ytloadster-cache")
        .join(job_id.to_string())
}

fn add_temp_path_args(args: &mut Vec<String>, cache_dir: &Path) {
    let Some(url) = args.pop() else {
        return;
    };
    args.push("--paths".to_string());
    args.push(format!("temp:{}", cache_dir.to_string_lossy()));
    args.push(url);
}

fn set_home_path_args(args: &mut [String], output_dir: &Path) {
    for index in 0..args.len().saturating_sub(1) {
        if args[index] == "--paths" && args[index + 1].starts_with("home:") {
            args[index + 1] = format!("home:{}", output_dir.to_string_lossy());
            return;
        }
    }
}

fn add_output_tracking_args(args: &mut Vec<String>) {
    let Some(url) = args.pop() else {
        return;
    };
    args.push("--print".to_string());
    args.push(format!("after_move:{OUTPUT_PATH_PREFIX}%(filepath)s"));
    args.push("--no-quiet".to_string());
    args.push("--progress".to_string());
    args.push(url);
}

fn parse_output_path_line(line: &str) -> Option<PathBuf> {
    line.strip_prefix(OUTPUT_PATH_PREFIX)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn resolve_output_file(
    reported_path: Option<&Path>,
    output_dir: &Path,
    request: &DownloadRequest,
) -> Result<PathBuf, String> {
    let expected_extension = expected_output_extension(request);
    if let Some(path) = reported_path {
        let candidate = if path.is_absolute() {
            path.to_path_buf()
        } else {
            output_dir.join(path)
        };
        if candidate.is_file()
            && output_extension_matches(&candidate, expected_extension.as_deref())
            && !is_ytdlp_format_sidecar(&candidate)
        {
            return Ok(candidate);
        }
    }

    let mut candidates = fs::read_dir(output_dir)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| output_extension_matches(path, expected_extension.as_deref()))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        is_ytdlp_format_sidecar(left)
            .cmp(&is_ytdlp_format_sidecar(right))
            .then_with(|| output_file_size(right).cmp(&output_file_size(left)))
            .then_with(|| left.cmp(right))
    });
    candidates
        .into_iter()
        .next()
        .ok_or_else(|| "Не удалось определить итоговый файл загрузки.".to_string())
}

fn is_ytdlp_format_sidecar(path: &Path) -> bool {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .and_then(|stem| stem.rsplit_once(".f"))
        .is_some_and(|(_, format_id)| {
            !format_id.is_empty()
                && format_id
                    .chars()
                    .all(|character| character.is_ascii_digit())
        })
}

fn output_file_size(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn expected_output_extension(request: &DownloadRequest) -> Option<String> {
    match request.preset {
        DownloadPreset::Mp4Video => Some("mp4".to_string()),
        DownloadPreset::BestVideo => request
            .video_technical_details
            .as_ref()
            .and_then(|details| normalized_text(details.requested_container.as_deref()))
            .map(|extension| extension.to_ascii_lowercase()),
        DownloadPreset::AudioMp3 => Some("mp3".to_string()),
        DownloadPreset::AudioM4a => Some("m4a".to_string()),
        DownloadPreset::AudioOpus => Some("opus".to_string()),
        DownloadPreset::Subtitles => request
            .subtitle
            .as_ref()
            .and_then(|subtitle| normalized_text(Some(&subtitle.format)))
            .map(|format| format.to_ascii_lowercase()),
    }
}

fn output_extension_matches(path: &Path, expected_extension: Option<&str>) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    !matches!(
        extension.to_ascii_lowercase().as_str(),
        "part" | "ytdl" | "temp"
    ) && expected_extension.map_or(true, |expected| extension.eq_ignore_ascii_case(expected))
}

fn initial_download_phase(request: &DownloadRequest) -> JobPhase {
    match request.preset {
        DownloadPreset::BestVideo | DownloadPreset::Mp4Video => JobPhase::DownloadingVideo,
        DownloadPreset::AudioMp3 | DownloadPreset::AudioM4a | DownloadPreset::AudioOpus => {
            JobPhase::DownloadingAudio
        }
        DownloadPreset::Subtitles => JobPhase::Downloading,
    }
}

fn technical_filename_suffix(request: &DownloadRequest) -> Option<String> {
    if !matches!(
        request.preset,
        DownloadPreset::BestVideo | DownloadPreset::Mp4Video
    ) || !request.include_video_technical_details_in_filename
    {
        return None;
    }
    let details = request.video_technical_details.as_ref()?;
    let mut parts = Vec::new();
    if let Some(height) = details.height.filter(|height| *height > 0) {
        parts.push(format!("{height}p"));
    }
    if let Some(fps) = details.fps.filter(|fps| *fps > 0) {
        parts.push(format!("{fps}fps"));
    }
    if let Some(codec) = normalized_text(details.codec.as_deref()) {
        parts.push(codec);
    }
    if details
        .dynamic_range
        .as_deref()
        .is_some_and(|range| range.to_ascii_lowercase().contains("hdr"))
    {
        parts.push("HDR".to_string());
    }
    (!parts.is_empty()).then(|| format!("[{}]", parts.join(" ")))
}

fn finalize_output_without_overwrite(
    source: &Path,
    destination_dir: &Path,
    request: &DownloadRequest,
) -> Result<PathBuf, String> {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let source_stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| match request.preset {
            DownloadPreset::BestVideo | DownloadPreset::Mp4Video => "video",
            DownloadPreset::AudioMp3 | DownloadPreset::AudioM4a | DownloadPreset::AudioOpus => {
                "audio"
            }
            DownloadPreset::Subtitles => "subtitles",
        });
    let source_stem = if request
        .subtitle
        .as_ref()
        .is_some_and(|subtitle| subtitle.automatic)
        && !source_stem.to_ascii_lowercase().ends_with(".auto")
    {
        format!("{source_stem}.auto")
    } else {
        source_stem.to_string()
    };
    let suffix = technical_filename_suffix(request);

    fs::create_dir_all(destination_dir).map_err(|error| error.to_string())?;
    for number in 0_u32.. {
        let number_suffix = if number == 0 {
            String::new()
        } else {
            format!(" ({number})")
        };
        let fixed_bytes = suffix.as_ref().map_or(0, |value| value.len() + 1)
            + number_suffix.len()
            + if extension.is_empty() {
                0
            } else {
                extension.len() + 1
            };
        let stem = truncate_utf8(
            &source_stem,
            MAX_OUTPUT_FILENAME_BYTES.saturating_sub(fixed_bytes),
        );
        let mut filename = stem.trim_end_matches([' ', '.']).to_string();
        if filename.is_empty() {
            filename.push_str(match request.preset {
                DownloadPreset::BestVideo | DownloadPreset::Mp4Video => "video",
                DownloadPreset::AudioMp3 | DownloadPreset::AudioM4a | DownloadPreset::AudioOpus => {
                    "audio"
                }
                DownloadPreset::Subtitles => "subtitles",
            });
        }
        if let Some(suffix) = &suffix {
            filename.push(' ');
            filename.push_str(suffix);
        }
        filename.push_str(&number_suffix);
        if !extension.is_empty() {
            filename.push('.');
            filename.push_str(extension);
        }

        let target = destination_dir.join(filename);
        match fs::hard_link(source, &target) {
            Ok(()) => {
                let _ = fs::remove_file(source);
                return Ok(target);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => match copy_file_exclusive(source, &target) {
                Ok(()) => {
                    let _ = fs::remove_file(source);
                    return Ok(target);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.to_string()),
            },
        }
    }
    unreachable!()
}

fn copy_file_exclusive(source: &Path, target: &Path) -> io::Result<()> {
    let mut input = File::open(source)?;
    let mut output = match OpenOptions::new().write(true).create_new(true).open(target) {
        Ok(output) => output,
        Err(error) => return Err(error),
    };
    if let Err(error) = io::copy(&mut input, &mut output).and_then(|_| output.sync_all()) {
        drop(output);
        let _ = fs::remove_file(target);
        return Err(error);
    }
    Ok(())
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut boundary = max_bytes.min(value.len());
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value[..boundary].to_string()
}

fn add_fragment_concurrency_args(args: &mut Vec<String>, fragment_concurrency: u8) {
    let Some(url) = args.pop() else {
        return;
    };
    args.push("--concurrent-fragments".to_string());
    args.push(normalize_fragment_concurrency(fragment_concurrency).to_string());
    args.push(url);
}

fn cleanup_cancelled_download(
    active: &ActiveDownload,
    remove_destination_part_files: bool,
) -> Result<(), String> {
    let cache_result = if active.cache_dir.exists() {
        fs::remove_dir_all(&active.cache_dir).map_err(|err| err.to_string())
    } else {
        Ok(())
    };
    let partial_result = if remove_destination_part_files {
        remove_download_part_files(&active.destination_dir).map_err(|err| err.to_string())
    } else {
        Ok(())
    };

    cache_result.and(partial_result)
}

fn remove_download_part_files(destination_dir: &Path) -> std::io::Result<()> {
    let Ok(entries) = fs::read_dir(destination_dir) else {
        return Ok(());
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_part_file(&path) {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

#[cfg(test)]
fn cleanup_destination_parts_if_idle(manager: &DownloadManager, destination_dir: &Path) {
    if !manager.has_active_download_in_destination(destination_dir) {
        let _ = remove_download_part_files(destination_dir);
    }
}

fn is_part_file(path: &Path) -> bool {
    path.file_name()
        .map(|name| {
            name.to_string_lossy()
                .to_ascii_lowercase()
                .ends_with(".part")
        })
        .unwrap_or(false)
}

fn emit_job(app: &AppHandle, result: Result<Job, String>) {
    if let Ok(job) = result {
        let _ = app.emit("download-updated", job);
    }
}

async fn read_process_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<String>> {
    let mut bytes = Vec::new();
    let read = reader.read_until(b'\n', &mut bytes).await?;
    if read == 0 {
        return Ok(None);
    }

    Ok(Some(decode_process_line(&bytes)))
}

fn decode_process_line(bytes: &[u8]) -> String {
    let mut line = bytes;
    if let Some(trimmed) = line.strip_suffix(b"\n") {
        line = trimmed;
    }
    if let Some(trimmed) = line.strip_suffix(b"\r") {
        line = trimmed;
    }

    String::from_utf8_lossy(line).into_owned()
}

pub fn parse_progress_line(line: &str) -> Option<DownloadProgress> {
    let payload = line.strip_prefix("download:").unwrap_or(line);
    if let Some(payload) = payload.strip_prefix("YTLOADSTER_PROGRESS|") {
        let mut parts = payload.splitn(5, '|');
        let video_codec = parts.next()?.trim();
        let audio_codec = parts.next()?.trim();
        let percent = parse_progress_percent(parts.next()?)?;
        return Some(DownloadProgress {
            percent,
            speed: clean_progress_field(parts.next()),
            eta: clean_progress_field(parts.next()),
            phase: Some(download_phase_from_codecs(video_codec, audio_codec)),
        });
    }
    if !payload.contains('%') || !payload.contains('|') {
        return None;
    }
    let mut parts = payload.split('|').map(str::trim);
    let percent = parse_progress_percent(parts.next()?)?;
    let speed = clean_progress_field(parts.next());
    let eta = clean_progress_field(parts.next());

    Some(DownloadProgress {
        percent,
        speed,
        eta,
        phase: None,
    })
}

fn parse_progress_percent(value: &str) -> Option<u8> {
    value
        .trim()
        .trim_end_matches('%')
        .trim()
        .parse::<f64>()
        .ok()
        .map(|value| value.round().clamp(0.0, 100.0) as u8)
}

fn download_phase_from_codecs(video_codec: &str, audio_codec: &str) -> JobPhase {
    let has_video = !video_codec.is_empty()
        && !video_codec.eq_ignore_ascii_case("none")
        && !video_codec.eq_ignore_ascii_case("NA");
    let has_audio = !audio_codec.is_empty()
        && !audio_codec.eq_ignore_ascii_case("none")
        && !audio_codec.eq_ignore_ascii_case("NA");
    if !has_video && has_audio {
        JobPhase::DownloadingAudio
    } else if has_video {
        JobPhase::DownloadingVideo
    } else {
        JobPhase::Downloading
    }
}

pub fn is_post_processing_line(line: &str) -> bool {
    line.contains("[ExtractAudio]")
}

pub fn is_video_merging_line(line: &str) -> bool {
    line.contains("[Merger]") || line.contains("[VideoRemuxer]")
}

fn clean_progress_field(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("n/a") || value.eq_ignore_ascii_case("na") {
        None
    } else {
        Some(value.to_string())
    }
}

fn kill_process_tree(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut process = std::process::Command::new("taskkill");
        process.args(["/PID", &pid.to_string(), "/T", "/F"]);
        hide_windows_console_std(&mut process);
        let status = process.status().map_err(|err| err.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("не удалось остановить процесс {pid}"))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let status = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|err| err.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("не удалось остановить процесс {pid}"))
        }
    }
}

#[cfg(target_os = "windows")]
fn hide_windows_console_std(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(0x0800_0000);
}

fn open_folder_command(path: &Path) -> (&'static str, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        ("explorer.exe", vec![path.to_string_lossy().to_string()])
    }

    #[cfg(target_os = "macos")]
    {
        ("open", vec![path.to_string_lossy().to_string()])
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        ("xdg-open", vec![path.to_string_lossy().to_string()])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ytdlp::{
        CookieSource, DownloadPreset, DownloadRequest, SubtitleSelection, VideoTechnicalDetails,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn enqueue_creates_pending_job_with_request_snapshot() {
        let manager = DownloadManager::new();
        let request = sample_download_request();

        let job = manager.enqueue(request.clone());

        assert_eq!(job.state, JobState::Pending);
        assert_eq!(job.request.url, request.url);
    }

    #[test]
    fn exact_video_duplicate_is_blocked_in_all_protected_states() {
        for protected_state in [
            JobState::Pending,
            JobState::Running,
            JobState::Paused,
            JobState::Completed,
        ] {
            let manager = DownloadManager::new();
            let request = sample_download_request();
            let first = manager.try_enqueue(request.clone()).unwrap();
            manager
                .update_job(first.id, |job| job.state = protected_state)
                .unwrap();

            assert_eq!(
                manager.try_enqueue(request).unwrap_err(),
                DUPLICATE_VIDEO_ERROR,
                "state {protected_state:?} must block an exact duplicate"
            );
            assert_eq!(manager.jobs().len(), 1);
        }
    }

    #[test]
    fn failed_and_cancelled_video_jobs_do_not_block_new_enqueue() {
        for terminal_state in [JobState::Failed, JobState::Cancelled] {
            let manager = DownloadManager::new();
            let request = sample_download_request();
            let first = manager.try_enqueue(request.clone()).unwrap();
            manager
                .update_job(first.id, |job| job.state = terminal_state)
                .unwrap();

            let second = manager.try_enqueue(request).unwrap();
            assert_ne!(first.id, second.id);
            assert_eq!(manager.jobs().len(), 2);
        }
    }

    #[test]
    fn exact_audio_and_subtitle_duplicates_are_blocked_in_all_protected_states() {
        for (request, expected_error) in [
            (sample_audio_request(), DUPLICATE_AUDIO_ERROR),
            (sample_subtitle_request(false), DUPLICATE_SUBTITLES_ERROR),
        ] {
            for protected_state in [
                JobState::Pending,
                JobState::Running,
                JobState::Paused,
                JobState::Completed,
            ] {
                let manager = DownloadManager::new();
                let first = manager.try_enqueue(request.clone()).unwrap();
                manager
                    .update_job(first.id, |job| job.state = protected_state)
                    .unwrap();

                assert_eq!(
                    manager.try_enqueue(request.clone()).unwrap_err(),
                    expected_error
                );
                assert_eq!(manager.jobs().len(), 1);
            }
        }
    }

    #[test]
    fn failed_and_cancelled_audio_and_subtitle_jobs_allow_new_attempts() {
        for request in [sample_audio_request(), sample_subtitle_request(false)] {
            for terminal_state in [JobState::Failed, JobState::Cancelled] {
                let manager = DownloadManager::new();
                let first = manager.try_enqueue(request.clone()).unwrap();
                manager
                    .update_job(first.id, |job| job.state = terminal_state)
                    .unwrap();

                assert!(manager.try_enqueue(request.clone()).is_ok());
            }
        }
    }

    #[test]
    fn retry_reports_the_matching_media_duplicate_error() {
        for (request, expected_error) in [
            (sample_audio_request(), DUPLICATE_AUDIO_ERROR),
            (sample_subtitle_request(false), DUPLICATE_SUBTITLES_ERROR),
        ] {
            let manager = DownloadManager::new();
            let failed = manager.try_enqueue(request.clone()).unwrap();
            manager
                .update_job(failed.id, |job| job.state = JobState::Failed)
                .unwrap();
            let completed = manager.try_enqueue(request).unwrap();
            manager.mark_completed(completed.id).unwrap();

            assert_eq!(manager.retry(failed.id).unwrap_err(), expected_error);
        }
    }

    #[test]
    fn audio_signature_distinguishes_every_output_parameter() {
        let manager = DownloadManager::new();
        let request = sample_audio_request();
        manager.try_enqueue(request.clone()).unwrap();

        let mut variants = Vec::new();
        let mut other_stream = request.clone();
        other_stream.format_id = Some("251".to_string());
        variants.push(other_stream);
        let mut other_format = request.clone();
        other_format.preset = DownloadPreset::AudioM4a;
        variants.push(other_format);
        let mut other_bitrate = request.clone();
        other_bitrate.audio_bitrate = Some("192K".to_string());
        variants.push(other_bitrate);
        let mut other_channels = request.clone();
        other_channels.audio_channels = Some("mono".to_string());
        variants.push(other_channels);
        let mut other_metadata = request.clone();
        other_metadata.embed_metadata = Some(true);
        variants.push(other_metadata);
        let mut other_thumbnail = request;
        other_thumbnail.embed_thumbnail = Some(true);
        variants.push(other_thumbnail);

        for variant in variants {
            assert!(manager.try_enqueue(variant).is_ok());
        }
    }

    #[test]
    fn subtitle_signature_distinguishes_language_format_and_track_type() {
        let manager = DownloadManager::new();
        let request = sample_subtitle_request(false);
        manager.try_enqueue(request.clone()).unwrap();

        let mut other_language = request.clone();
        other_language.subtitle.as_mut().unwrap().language = "en".to_string();
        assert!(manager.try_enqueue(other_language).is_ok());

        let mut other_format = request.clone();
        other_format.subtitle.as_mut().unwrap().format = "vtt".to_string();
        assert!(manager.try_enqueue(other_format).is_ok());

        let mut automatic = request;
        automatic.subtitle.as_mut().unwrap().automatic = true;
        assert!(manager.try_enqueue(automatic).is_ok());
    }

    #[test]
    fn different_container_or_stream_is_not_a_duplicate() {
        let manager = DownloadManager::new();
        let mut mp4 = sample_download_request();
        mp4.video_technical_details = Some(VideoTechnicalDetails {
            requested_container: Some("mp4".to_string()),
            ..VideoTechnicalDetails::default()
        });
        manager.try_enqueue(mp4.clone()).unwrap();

        let mut webm = mp4.clone();
        webm.video_technical_details
            .as_mut()
            .unwrap()
            .requested_container = Some("WebM".to_string());
        assert!(manager.try_enqueue(webm).is_ok());

        let mut other_video = mp4.clone();
        other_video.format_id = Some("248".to_string());
        assert!(manager.try_enqueue(other_video).is_ok());

        let mut other_audio = mp4;
        other_audio.audio_format_id = Some("251".to_string());
        assert!(manager.try_enqueue(other_audio).is_ok());
    }

    #[test]
    fn naming_preference_and_destination_do_not_make_duplicate_unique() {
        let manager = DownloadManager::new();
        let request = sample_download_request();
        manager.try_enqueue(request.clone()).unwrap();

        let mut changed = request;
        changed.include_video_technical_details_in_filename = true;
        changed.destination_dir = PathBuf::from("D:/Other");
        assert_eq!(
            manager.try_enqueue(changed).unwrap_err(),
            DUPLICATE_VIDEO_ERROR
        );
    }

    #[test]
    fn simultaneous_exact_enqueues_create_only_one_job_and_do_not_consume_an_id() {
        let manager = DownloadManager::new();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let mut threads = Vec::new();
        for _ in 0..2 {
            let manager = manager.clone();
            let barrier = barrier.clone();
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                manager.try_enqueue(sample_download_request())
            }));
        }

        let results = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| result.as_ref().err().map(String::as_str)
                    == Some(DUPLICATE_VIDEO_ERROR))
                .count(),
            1
        );

        let first = manager.jobs()[0].clone();
        manager
            .update_job(first.id, |job| job.state = JobState::Failed)
            .unwrap();
        let next = manager.try_enqueue(sample_download_request()).unwrap();
        assert_eq!(next.id, first.id + 1);
    }

    #[test]
    fn clearing_completed_video_allows_a_new_numbered_attempt() {
        let manager = DownloadManager::new();
        let first = manager.try_enqueue(sample_download_request()).unwrap();
        manager.mark_completed(first.id).unwrap();
        assert_eq!(
            manager.try_enqueue(sample_download_request()).unwrap_err(),
            DUPLICATE_VIDEO_ERROR
        );

        manager.clear().unwrap();
        assert!(manager.try_enqueue(sample_download_request()).is_ok());
    }

    #[test]
    fn retry_failed_job_replaces_original_with_pending_job() {
        let manager = DownloadManager::new();
        let original = manager.enqueue(sample_download_request());
        manager
            .mark_failed(original.id, "network error".to_string())
            .unwrap();

        let retry = manager.retry(original.id).unwrap();

        assert_ne!(retry.id, original.id);
        assert_eq!(retry.state, JobState::Pending);
        assert_eq!(retry.request.url, original.request.url);
        assert_eq!(
            retry.request.thumbnail.as_deref(),
            Some("https://i.ytimg.com/example.jpg")
        );
        assert_eq!(manager.jobs(), vec![retry]);
    }

    #[test]
    fn recognizes_disk_space_errors_from_ytdlp_and_ffmpeg() {
        for message in [
            "ERROR: unable to write data: No space left on device",
            "ffmpeg: avio_write failed: ENOSPC",
            "ERROR: disk full while merging formats",
            "The disk is full.",
        ] {
            assert!(is_insufficient_disk_space_error(message), "{message}");
        }

        assert!(!is_insufficient_disk_space_error(
            "ERROR: HTTP Error 403: Forbidden"
        ));
    }

    #[test]
    fn pausing_running_job_marks_it_paused_without_clearing_progress() {
        let manager = DownloadManager::new();
        let job = manager.enqueue(sample_download_request());
        manager
            .mark_progress(
                job.id,
                DownloadProgress {
                    percent: 42,
                    speed: Some("3.2MiB/s".to_string()),
                    eta: Some("00:30".to_string()),
                    phase: None,
                },
            )
            .unwrap();
        manager.register_process(
            job.id,
            ActiveDownload {
                pid: 0,
                cache_dir: PathBuf::from("C:/Downloads/.ytloadster-cache/1"),
                destination_dir: PathBuf::from("C:/Downloads"),
            },
        );

        manager
            .pause_with_process_killer(job.id, |_| Ok(()))
            .unwrap();

        let paused = &manager.jobs()[0];
        assert_eq!(paused.state, JobState::Paused);
        assert_eq!(paused.progress_percent, Some(42));
        assert_eq!(paused.speed, None);
        assert_eq!(paused.eta, None);
    }

    #[test]
    fn resuming_paused_job_returns_it_to_pending() {
        let manager = DownloadManager::new();
        let job = manager.enqueue(sample_download_request());
        manager
            .pause_with_process_killer(job.id, |_| Ok(()))
            .unwrap();

        let resumed = manager.resume(job.id).unwrap();

        assert_eq!(resumed.id, job.id);
        assert_eq!(resumed.state, JobState::Pending);
        assert_eq!(manager.jobs()[0].state, JobState::Pending);
    }

    #[test]
    fn active_processes_hold_concurrency_slots_until_they_exit() {
        let manager = DownloadManager::with_concurrency(1);
        let running = manager.enqueue(sample_download_request());
        let pending = manager.enqueue(sample_download_request());
        manager.reserve_pending_jobs();
        manager.register_process(
            running.id,
            ActiveDownload {
                pid: 0,
                cache_dir: PathBuf::from("C:/Downloads/.ytloadster-cache/1"),
                destination_dir: PathBuf::from("C:/Downloads"),
            },
        );
        manager
            .cancel_with_process_killer(running.id, |_| Ok(()))
            .unwrap();

        let reserved = manager.reserve_pending_jobs();

        assert!(reserved.is_empty());
        assert_eq!(manager.jobs()[1].id, pending.id);
        assert_eq!(manager.jobs()[1].state, JobState::Pending);
    }

    #[test]
    fn mark_running_and_completed_update_existing_job() {
        let manager = DownloadManager::new();
        let job = manager.enqueue(sample_download_request());

        manager.mark_running(job.id).unwrap();
        assert_eq!(manager.jobs()[0].state, JobState::Running);

        manager.mark_completed(job.id).unwrap();
        assert_eq!(manager.jobs()[0].state, JobState::Completed);
    }

    #[test]
    fn completing_job_clears_speed_and_eta() {
        let manager = DownloadManager::new();
        let job = manager.enqueue(sample_download_request());
        manager
            .mark_progress(
                job.id,
                DownloadProgress {
                    percent: 100,
                    speed: Some("3.58MiB/s".to_string()),
                    eta: Some("NA".to_string()),
                    phase: None,
                },
            )
            .unwrap();

        manager.mark_completed(job.id).unwrap();

        let completed = &manager.jobs()[0];
        assert_eq!(completed.state, JobState::Completed);
        assert_eq!(completed.progress_percent, Some(100));
        assert_eq!(completed.speed, None);
        assert_eq!(completed.eta, None);
    }

    #[test]
    fn parses_ytdlp_progress_template_line() {
        let progress = parse_progress_line("42.5%| 1.25MiB/s|00:13").unwrap();

        assert_eq!(progress.percent, 43);
        assert_eq!(progress.speed, Some("1.25MiB/s".to_string()));
        assert_eq!(progress.eta, Some("00:13".to_string()));
    }

    #[test]
    fn parses_ytdlp_progress_template_line_with_legacy_prefix() {
        let progress = parse_progress_line("download: 42.5%| 1.25MiB/s|00:13").unwrap();

        assert_eq!(progress.percent, 43);
    }

    #[test]
    fn parses_structured_video_and_audio_stream_progress() {
        let video = parse_progress_line(
            "download:YTLOADSTER_PROGRESS|vp09.00.51.08|none|42.5%|1.25MiB/s|00:13",
        )
        .unwrap();
        let audio =
            parse_progress_line("download:YTLOADSTER_PROGRESS|none|opus|27.0%|768.00KiB/s|00:08")
                .unwrap();

        assert_eq!(video.percent, 43);
        assert_eq!(video.phase, Some(JobPhase::DownloadingVideo));
        assert_eq!(audio.percent, 27);
        assert_eq!(audio.phase, Some(JobPhase::DownloadingAudio));
    }

    #[test]
    fn parses_na_progress_fields_as_empty() {
        let progress = parse_progress_line("100.0%| 3.58MiB/s|NA").unwrap();

        assert_eq!(progress.percent, 100);
        assert_eq!(progress.speed, Some("3.58MiB/s".to_string()));
        assert_eq!(progress.eta, None);
    }

    #[test]
    fn detects_audio_post_processing_output() {
        assert!(is_post_processing_line(
            "[ExtractAudio] Destination: track.mp3"
        ));
        assert!(!is_post_processing_line("100.0%| 3.58MiB/s|NA"));
    }

    #[test]
    fn detects_video_merging_and_remuxing_output() {
        assert!(is_video_merging_line(
            "[Merger] Merging formats into \"Nature.webm\""
        ));
        assert!(is_video_merging_line(
            "[VideoRemuxer] Remuxing video from webm to mp4"
        ));
        assert!(!is_video_merging_line("download:50.0%|1.0MiB/s|00:05"));
    }

    #[test]
    fn post_processing_marks_job_as_running_without_download_metrics() {
        let manager = DownloadManager::new();
        let job = manager.enqueue(sample_download_request());

        manager.mark_post_processing(job.id).unwrap();

        let updated = &manager.jobs()[0];
        assert_eq!(updated.state, JobState::Running);
        assert_eq!(updated.phase, Some(JobPhase::PostProcessing));
        assert_eq!(updated.progress_percent, Some(100));
        assert_eq!(updated.speed, None);
        assert_eq!(updated.eta, None);
    }

    #[test]
    fn merging_marks_job_as_running_without_download_metrics() {
        let manager = DownloadManager::new();
        let job = manager.enqueue(sample_download_request());

        manager.mark_merging(job.id).unwrap();

        let updated = &manager.jobs()[0];
        assert_eq!(updated.state, JobState::Running);
        assert_eq!(updated.phase, Some(JobPhase::Merging));
        assert_eq!(updated.progress_percent, Some(100));
        assert_eq!(updated.speed, None);
        assert_eq!(updated.eta, None);
    }

    #[test]
    fn decodes_process_output_with_invalid_utf8_lossily() {
        let line = decode_process_line(b"\xff42.5%| 1.25MiB/s|00:13\r\n");
        let line_with_lf = decode_process_line(b"100.0%|4.28MiB/s|NA\n");

        assert!(line.starts_with('\u{fffd}'));
        assert!(line.ends_with("00:13"));
        assert!(!line.ends_with('\n'));
        assert_eq!(line_with_lf, "100.0%|4.28MiB/s|NA");
    }

    #[test]
    fn progress_update_marks_job_running_with_progress_fields() {
        let manager = DownloadManager::new();
        let job = manager.enqueue(sample_download_request());

        manager
            .mark_progress(
                job.id,
                DownloadProgress {
                    percent: 42,
                    speed: Some("1.25MiB/s".to_string()),
                    eta: Some("00:13".to_string()),
                    phase: None,
                },
            )
            .unwrap();

        let updated = &manager.jobs()[0];
        assert_eq!(updated.state, JobState::Running);
        assert_eq!(updated.progress_percent, Some(42));
        assert_eq!(updated.speed, Some("1.25MiB/s".to_string()));
        assert_eq!(updated.eta, Some("00:13".to_string()));
    }

    #[test]
    fn cancelling_job_clears_progress_fields() {
        let manager = DownloadManager::new();
        let job = manager.enqueue(sample_download_request());
        manager
            .mark_progress(
                job.id,
                DownloadProgress {
                    percent: 42,
                    speed: Some("3.50MiB/s".to_string()),
                    eta: Some("00:17".to_string()),
                    phase: None,
                },
            )
            .unwrap();

        manager.cancel(job.id).unwrap();

        let cancelled = &manager.jobs()[0];
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert_eq!(cancelled.progress_percent, None);
        assert_eq!(cancelled.speed, None);
        assert_eq!(cancelled.eta, None);
        assert_eq!(cancelled.error, None);
    }

    #[test]
    fn cancelling_job_marks_cancelled_even_if_process_is_already_gone() {
        let manager = DownloadManager::new();
        let job = manager.enqueue(sample_download_request());
        manager
            .mark_progress(
                job.id,
                DownloadProgress {
                    percent: 50,
                    speed: Some("4.98MiB/s".to_string()),
                    eta: Some("00:45".to_string()),
                    phase: None,
                },
            )
            .unwrap();
        manager.register_process(
            job.id,
            ActiveDownload {
                pid: u32::MAX,
                cache_dir: PathBuf::from("C:/missing-cache"),
                destination_dir: PathBuf::from("C:/missing-downloads"),
            },
        );

        manager
            .cancel_with_process_killer(job.id, |_| Err("process is already gone".to_string()))
            .unwrap();

        let cancelled = &manager.jobs()[0];
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert_eq!(cancelled.progress_percent, None);
        assert_eq!(cancelled.speed, None);
        assert_eq!(cancelled.eta, None);
    }

    #[test]
    fn clear_removes_only_terminal_jobs_from_queue() {
        let manager = DownloadManager::new();
        let completed = manager.enqueue(sample_download_request());
        let failed = manager.enqueue(sample_download_request());
        let cancelled = manager.enqueue(sample_download_request());
        let running = manager.enqueue(sample_download_request());
        let paused = manager.enqueue(sample_download_request());

        manager.mark_completed(completed.id).unwrap();
        manager
            .mark_failed(failed.id, "download error".to_string())
            .unwrap();
        manager.cancel(cancelled.id).unwrap();
        manager.mark_running(running.id).unwrap();
        manager.mark_running(paused.id).unwrap();
        manager.pause(paused.id).unwrap();

        manager.clear().unwrap();

        assert_eq!(
            manager.jobs().iter().map(|job| job.id).collect::<Vec<_>>(),
            vec![running.id, paused.id]
        );
    }

    #[test]
    fn remove_deletes_one_job_from_queue() {
        let manager = DownloadManager::new();
        let removed = manager.enqueue(sample_download_request());
        let kept = manager.enqueue(sample_download_request());

        manager.remove(removed.id).unwrap();

        assert_eq!(
            manager.jobs().iter().map(|job| job.id).collect::<Vec<_>>(),
            vec![kept.id]
        );
    }

    #[test]
    fn cancel_all_marks_pending_and_running_jobs_cancelled() {
        let manager = DownloadManager::with_concurrency(2);
        let first = manager.enqueue(sample_download_request());
        let second = manager.enqueue(sample_download_request());
        let third = manager.enqueue(sample_download_request());
        manager.reserve_pending_jobs();

        let cancelled = manager.cancel_all().unwrap();

        assert_eq!(
            cancelled.iter().map(|job| job.id).collect::<Vec<_>>(),
            vec![first.id, second.id, third.id]
        );
        assert!(manager
            .jobs()
            .iter()
            .all(|job| job.state == JobState::Cancelled));
    }

    #[test]
    fn pause_all_marks_pending_and_running_jobs_paused() {
        let manager = DownloadManager::with_concurrency(2);
        let first = manager.enqueue(sample_download_request());
        let second = manager.enqueue(sample_download_request());
        let third = manager.enqueue(sample_download_request());
        manager.reserve_pending_jobs();
        manager
            .mark_progress(
                first.id,
                DownloadProgress {
                    percent: 37,
                    speed: Some("2.5MiB/s".to_string()),
                    eta: Some("00:40".to_string()),
                    phase: None,
                },
            )
            .unwrap();

        let paused = manager.pause_all().unwrap();

        assert_eq!(
            paused.iter().map(|job| job.id).collect::<Vec<_>>(),
            vec![first.id, second.id, third.id]
        );
        assert!(manager
            .jobs()
            .iter()
            .all(|job| job.state == JobState::Paused));
        let first = manager
            .jobs()
            .into_iter()
            .find(|job| job.id == first.id)
            .unwrap();
        assert_eq!(first.progress_percent, Some(37));
        assert_eq!(first.speed, None);
        assert_eq!(first.eta, None);
    }

    #[test]
    fn resume_all_returns_only_paused_jobs_to_pending() {
        let manager = DownloadManager::new();
        let paused = manager.enqueue(sample_download_request());
        let completed = manager.enqueue(sample_download_request());
        manager
            .pause_with_process_killer(paused.id, |_| Ok(()))
            .unwrap();
        manager.mark_completed(completed.id).unwrap();

        let resumed = manager.resume_all().unwrap();

        assert_eq!(
            resumed.iter().map(|job| job.id).collect::<Vec<_>>(),
            vec![paused.id]
        );
        assert_eq!(manager.jobs()[0].state, JobState::Pending);
        assert_eq!(manager.jobs()[1].state, JobState::Completed);
    }

    #[test]
    fn cancelled_jobs_ignore_late_progress_and_process_result() {
        let manager = DownloadManager::with_concurrency(1);
        let job = manager.enqueue(sample_download_request());
        manager.reserve_pending_jobs();
        manager.cancel_all().unwrap();

        manager
            .mark_progress(
                job.id,
                DownloadProgress {
                    percent: 44,
                    speed: Some("4.40MiB/s".to_string()),
                    eta: Some("00:57".to_string()),
                    phase: None,
                },
            )
            .unwrap();
        manager
            .mark_failed(
                job.id,
                "Загрузка завершилась ошибкой без подробного сообщения.".to_string(),
            )
            .unwrap();

        let cancelled = &manager.jobs()[0];
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert_eq!(cancelled.progress_percent, None);
        assert_eq!(cancelled.speed, None);
        assert_eq!(cancelled.eta, None);
        assert_eq!(cancelled.error, None);
    }

    #[test]
    fn fragment_concurrency_args_are_inserted_before_url() {
        let mut args = vec![
            "-o".to_string(),
            "%(title)s.%(ext)s".to_string(),
            "https://youtube.com/watch?v=x".to_string(),
        ];

        add_fragment_concurrency_args(&mut args, 4);

        assert_eq!(
            args,
            vec![
                "-o",
                "%(title)s.%(ext)s",
                "--concurrent-fragments",
                "4",
                "https://youtube.com/watch?v=x",
            ]
        );
    }

    #[test]
    fn fragment_concurrency_is_limited_to_eight() {
        assert_eq!(normalize_fragment_concurrency(8), 8);
        assert_eq!(normalize_fragment_concurrency(16), 8);
        assert_eq!(normalize_fragment_concurrency(3), 1);
    }

    #[test]
    fn simultaneous_downloads_are_limited_to_eight() {
        assert_eq!(normalize_concurrency(6), 6);
        assert_eq!(normalize_concurrency(8), 8);
        assert_eq!(normalize_concurrency(16), 8);
        assert_eq!(normalize_concurrency(3), 1);
    }

    #[test]
    fn reserves_pending_jobs_up_to_concurrency_limit() {
        let manager = DownloadManager::with_concurrency(1);
        let first = manager.enqueue(sample_download_request());
        let second = manager.enqueue(sample_download_request());

        let reserved = manager.reserve_pending_jobs();

        assert_eq!(
            reserved.iter().map(|job| job.id).collect::<Vec<_>>(),
            vec![first.id]
        );
        let jobs = manager.jobs();
        assert_eq!(jobs[0].state, JobState::Running);
        assert_eq!(jobs[1].id, second.id);
        assert_eq!(jobs[1].state, JobState::Pending);
    }

    #[test]
    fn increasing_concurrency_reserves_next_pending_job_in_order() {
        let manager = DownloadManager::with_concurrency(1);
        let first = manager.enqueue(sample_download_request());
        let second = manager.enqueue(sample_download_request());
        let third = manager.enqueue(sample_download_request());
        manager.reserve_pending_jobs();

        manager.set_concurrency(2);
        let reserved = manager.reserve_pending_jobs();

        assert_eq!(
            reserved.iter().map(|job| job.id).collect::<Vec<_>>(),
            vec![second.id]
        );
        let jobs = manager.jobs();
        assert_eq!(jobs[0].id, first.id);
        assert_eq!(jobs[0].state, JobState::Running);
        assert_eq!(jobs[1].state, JobState::Running);
        assert_eq!(jobs[2].id, third.id);
        assert_eq!(jobs[2].state, JobState::Pending);
    }

    #[test]
    fn open_folder_command_targets_requested_path() {
        let path = PathBuf::from("C:/Downloads");

        let (_program, args) = open_folder_command(&path);

        assert_eq!(args, vec!["C:/Downloads".to_string()]);
    }

    #[test]
    fn temp_path_args_are_inserted_before_url() {
        let mut args = vec![
            "-o".to_string(),
            "C:/Downloads/%(title)s.%(ext)s".to_string(),
            "https://youtube.com/watch?v=x".to_string(),
        ];

        add_temp_path_args(&mut args, Path::new("C:/Downloads/.ytloadster-cache/1"));

        assert_eq!(
            args,
            vec![
                "-o",
                "C:/Downloads/%(title)s.%(ext)s",
                "--paths",
                "temp:C:/Downloads/.ytloadster-cache/1",
                "https://youtube.com/watch?v=x",
            ]
        );
    }

    #[test]
    fn output_tracking_marker_is_inserted_and_parsed() {
        let mut args = vec![
            "-o".to_string(),
            "%(title)s.%(ext)s".to_string(),
            "url".to_string(),
        ];
        add_output_tracking_args(&mut args);

        assert!(args.windows(2).any(|pair| {
            pair[0] == "--print" && pair[1] == "after_move:YTLOADSTER_OUTPUT|%(filepath)s"
        }));
        assert!(args.iter().any(|arg| arg == "--no-quiet"));
        assert!(args.iter().any(|arg| arg == "--progress"));
        assert_eq!(args.last().map(String::as_str), Some("url"));
        assert_eq!(
            parse_output_path_line("YTLOADSTER_OUTPUT|C:/Temp/Nature.webm"),
            Some(PathBuf::from("C:/Temp/Nature.webm"))
        );
        assert_eq!(parse_output_path_line("download:50%"), None);
    }

    #[test]
    fn output_file_falls_back_to_isolated_workspace_scan() {
        let root = unique_test_dir("output-scan");
        let output = root.join("output");
        fs::create_dir_all(&output).unwrap();
        fs::write(output.join("Nature.ru.srt"), b"subtitles").unwrap();

        let resolved = resolve_output_file(
            Some(Path::new("C:/missing/Nature.mp4")),
            &output,
            &sample_subtitle_request(false),
        )
        .unwrap();

        assert_eq!(resolved, output.join("Nature.ru.srt"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn mp4_video_finalization_never_selects_an_audio_sidecar() {
        let root = unique_test_dir("mp4-output-selection");
        let output = root.join("output");
        fs::create_dir_all(&output).unwrap();
        fs::write(output.join("Nature.f140.m4a"), b"audio").unwrap();
        fs::write(output.join("Nature.mp4"), b"video with audio").unwrap();

        let resolved = resolve_output_file(
            Some(&output.join("Nature.f140.m4a")),
            &output,
            &sample_download_request(),
        )
        .unwrap();

        assert_eq!(resolved, output.join("Nature.mp4"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn best_video_finalization_uses_the_selected_video_container() {
        let root = unique_test_dir("best-video-output-selection");
        let output = root.join("output");
        fs::create_dir_all(&output).unwrap();
        fs::write(output.join("Nature.f251.webm"), b"audio").unwrap();
        fs::write(output.join("Nature.webm"), b"video with audio").unwrap();
        let mut request = sample_download_request();
        request.preset = DownloadPreset::BestVideo;
        request.video_technical_details = Some(VideoTechnicalDetails {
            height: Some(1080),
            fps: Some(30),
            codec: Some("VP9".to_string()),
            dynamic_range: None,
            requested_container: Some("webm".to_string()),
        });

        let resolved =
            resolve_output_file(Some(&output.join("Nature.f251.webm")), &output, &request).unwrap();

        assert_eq!(resolved, output.join("Nature.webm"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn subtitles_are_the_only_downloads_that_do_not_require_ffmpeg() {
        assert!(download_requires_ffmpeg(&sample_download_request()));
        assert!(download_requires_ffmpeg(&sample_audio_request()));
        assert!(!download_requires_ffmpeg(&sample_subtitle_request(false)));
    }

    #[test]
    fn finalization_keeps_existing_file_and_uses_incrementing_suffixes() {
        let root = unique_test_dir("numbered-finalization");
        let destination = root.join("Downloads");
        let workspace = destination.join(".ytloadster-cache/1/output");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(destination.join("Nature.webm"), b"original").unwrap();
        fs::write(destination.join("Nature (1).webm"), b"previous").unwrap();
        let source = workspace.join("Nature.webm");
        fs::write(&source, b"new video").unwrap();

        let target =
            finalize_output_without_overwrite(&source, &destination, &sample_download_request())
                .unwrap();

        assert_eq!(target.file_name().unwrap(), "Nature (2).webm");
        assert_eq!(
            fs::read(destination.join("Nature.webm")).unwrap(),
            b"original"
        );
        assert_eq!(fs::read(target).unwrap(), b"new video");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn audio_finalization_uses_incrementing_suffix_without_overwrite() {
        let root = unique_test_dir("audio-finalization");
        let destination = root.join("Downloads");
        let workspace = destination.join(".ytloadster-cache/1/output");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(destination.join("Nature.mp3"), b"original").unwrap();
        let source = workspace.join("Nature.mp3");
        fs::write(&source, b"new audio").unwrap();

        let target =
            finalize_output_without_overwrite(&source, &destination, &sample_audio_request())
                .unwrap();

        assert_eq!(target.file_name().unwrap(), "Nature (1).mp3");
        assert_eq!(
            fs::read(destination.join("Nature.mp3")).unwrap(),
            b"original"
        );
        assert_eq!(fs::read(target).unwrap(), b"new audio");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn automatic_subtitles_get_auto_marker_before_collision_number() {
        let root = unique_test_dir("automatic-subtitles-finalization");
        let destination = root.join("Downloads");
        let workspace = destination.join(".ytloadster-cache/1/output");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(destination.join("Nature.ru.auto.srt"), b"original").unwrap();
        let source = workspace.join("Nature.ru.srt");
        fs::write(&source, b"automatic subtitles").unwrap();

        let target = finalize_output_without_overwrite(
            &source,
            &destination,
            &sample_subtitle_request(true),
        )
        .unwrap();

        assert_eq!(target.file_name().unwrap(), "Nature.ru.auto (1).srt");
        assert_eq!(
            fs::read(destination.join("Nature.ru.auto.srt")).unwrap(),
            b"original"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn technical_details_are_added_before_collision_number() {
        let root = unique_test_dir("technical-filename");
        let destination = root.join("Downloads");
        let workspace = destination.join(".ytloadster-cache/1/output");
        fs::create_dir_all(&workspace).unwrap();
        let source = workspace.join("Nature.webm");
        fs::write(&source, b"first").unwrap();
        let mut request = sample_download_request();
        request.include_video_technical_details_in_filename = true;
        request.video_technical_details = Some(VideoTechnicalDetails {
            height: Some(360),
            fps: Some(60),
            codec: Some("VP9".to_string()),
            dynamic_range: Some("HDR".to_string()),
            requested_container: Some("webm".to_string()),
        });

        let first = finalize_output_without_overwrite(&source, &destination, &request).unwrap();
        assert_eq!(
            first.file_name().unwrap(),
            "Nature [360p 60fps VP9 HDR].webm"
        );

        fs::create_dir_all(&workspace).unwrap();
        let second_source = workspace.join("Nature.webm");
        fs::write(&second_source, b"second").unwrap();
        let second =
            finalize_output_without_overwrite(&second_source, &destination, &request).unwrap();
        assert_eq!(
            second.file_name().unwrap(),
            "Nature [360p 60fps VP9 HDR] (1).webm"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parallel_finalizers_never_overwrite_each_other() {
        let root = unique_test_dir("parallel-finalization");
        let destination = root.join("Downloads");
        let first_workspace = destination.join(".ytloadster-cache/1/output");
        let second_workspace = destination.join(".ytloadster-cache/2/output");
        fs::create_dir_all(&first_workspace).unwrap();
        fs::create_dir_all(&second_workspace).unwrap();
        let first_source = first_workspace.join("Nature.webm");
        let second_source = second_workspace.join("Nature.webm");
        fs::write(&first_source, b"first").unwrap();
        fs::write(&second_source, b"second").unwrap();

        let first_destination = destination.clone();
        let first_request = sample_download_request();
        let first_thread = std::thread::spawn(move || {
            finalize_output_without_overwrite(&first_source, &first_destination, &first_request)
        });
        let second_destination = destination.clone();
        let second_request = sample_download_request();
        let second_thread = std::thread::spawn(move || {
            finalize_output_without_overwrite(&second_source, &second_destination, &second_request)
        });

        let first_target = first_thread.join().unwrap().unwrap();
        let second_target = second_thread.join().unwrap().unwrap();
        assert_ne!(first_target, second_target);
        let mut contents = vec![
            fs::read(first_target).unwrap(),
            fs::read(second_target).unwrap(),
        ];
        contents.sort();
        assert_eq!(contents, vec![b"first".to_vec(), b"second".to_vec()]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parallel_audio_finalizers_never_overwrite_each_other() {
        let root = unique_test_dir("parallel-audio-finalization");
        let destination = root.join("Downloads");
        let first_workspace = destination.join(".ytloadster-cache/1/output");
        let second_workspace = destination.join(".ytloadster-cache/2/output");
        fs::create_dir_all(&first_workspace).unwrap();
        fs::create_dir_all(&second_workspace).unwrap();
        let first_source = first_workspace.join("Nature.mp3");
        let second_source = second_workspace.join("Nature.mp3");
        fs::write(&first_source, b"first audio").unwrap();
        fs::write(&second_source, b"second audio").unwrap();

        let first_destination = destination.clone();
        let first_thread = std::thread::spawn(move || {
            finalize_output_without_overwrite(
                &first_source,
                &first_destination,
                &sample_audio_request(),
            )
        });
        let second_destination = destination.clone();
        let second_thread = std::thread::spawn(move || {
            finalize_output_without_overwrite(
                &second_source,
                &second_destination,
                &sample_audio_request(),
            )
        });

        let first_target = first_thread.join().unwrap().unwrap();
        let second_target = second_thread.join().unwrap().unwrap();
        assert_ne!(first_target, second_target);
        assert!(destination.join("Nature.mp3").exists());
        assert!(destination.join("Nature (1).mp3").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn long_unicode_stem_is_truncated_without_breaking_extension() {
        let root = unique_test_dir("unicode-finalization");
        let destination = root.join("Downloads");
        let workspace = destination.join(".ytloadster-cache/1/output");
        fs::create_dir_all(&workspace).unwrap();
        let source = workspace.join(format!("{}.mp4", "Природа".repeat(15)));
        fs::write(&source, b"video").unwrap();

        let target =
            finalize_output_without_overwrite(&source, &destination, &sample_download_request())
                .unwrap();
        let filename = target.file_name().unwrap().to_string_lossy();
        assert!(filename.len() <= MAX_OUTPUT_FILENAME_BYTES);
        assert!(filename.ends_with(".mp4"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_cancelled_download_removes_cache_and_part_files_when_safe() {
        let root = unique_test_dir("cancel-cleanup");
        let destination = root.join("Downloads");
        let cache = destination.join(".ytloadster-cache").join("1");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("fragment.part"), b"partial").unwrap();
        fs::write(destination.join("video.mp4.part"), b"partial").unwrap();
        fs::write(destination.join("video.mp4"), b"complete").unwrap();
        let active = ActiveDownload {
            pid: 0,
            cache_dir: cache.clone(),
            destination_dir: destination.clone(),
        };

        cleanup_cancelled_download(&active, true).unwrap();

        assert!(!cache.exists());
        assert!(!destination.join("video.mp4.part").exists());
        assert!(destination.join("video.mp4").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cancelling_running_download_waits_for_process_exit_before_removing_part_file() {
        let root = unique_test_dir("cancel-after-exit-cleanup");
        let destination = root.join("Downloads");
        let cache = destination.join(".ytloadster-cache").join("1");
        fs::create_dir_all(&cache).unwrap();
        fs::write(destination.join("video.mp4.part"), b"partial").unwrap();

        let manager = DownloadManager::new();
        let mut request = sample_download_request();
        request.destination_dir = destination.clone();
        let job = manager.enqueue(request);
        manager.register_process(
            job.id,
            ActiveDownload {
                pid: 0,
                cache_dir: cache,
                destination_dir: destination.clone(),
            },
        );

        manager
            .cancel_with_process_killer(job.id, |_| Ok(()))
            .unwrap();

        assert!(destination.join("video.mp4.part").exists());

        manager.unregister_process(job.id);
        cleanup_destination_parts_if_idle(&manager, &destination);

        assert!(!destination.join("video.mp4.part").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_cancelled_download_keeps_destination_part_files_when_another_job_is_active() {
        let root = unique_test_dir("cancel-cleanup-shared");
        let destination = root.join("Downloads");
        let cache = destination.join(".ytloadster-cache").join("1");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("fragment.part"), b"partial").unwrap();
        fs::write(destination.join("other-video.mp4.part"), b"partial").unwrap();
        let active = ActiveDownload {
            pid: 0,
            cache_dir: cache.clone(),
            destination_dir: destination.clone(),
        };

        cleanup_cancelled_download(&active, false).unwrap();

        assert!(!cache.exists());
        assert!(destination.join("other-video.mp4.part").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cancelling_paused_video_removes_only_its_isolated_workspace() {
        let root = unique_test_dir("paused-video-scoped-cleanup");
        let destination = root.join("Downloads");
        let manager = DownloadManager::new();
        let mut request = sample_download_request();
        request.destination_dir = destination.clone();
        let job = manager.enqueue(request);
        let cache = partial_cache_dir(&destination, job.id);
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("fragment.part"), b"own partial").unwrap();
        fs::write(destination.join("other-video.webm.part"), b"other partial").unwrap();
        manager
            .update_job(job.id, |job| job.state = JobState::Paused)
            .unwrap();

        manager
            .cancel_with_process_killer(job.id, |_| Ok(()))
            .unwrap();

        assert!(!cache.exists());
        assert!(destination.join("other-video.webm.part").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn destination_part_files_are_removed_once_destination_is_idle() {
        let root = unique_test_dir("idle-part-cleanup");
        let destination = root.join("Downloads");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("cancelled-video.mp4.part"), b"partial").unwrap();
        fs::write(destination.join("finished-video.mp4"), b"complete").unwrap();

        let manager = DownloadManager::new();
        manager.register_process(
            1,
            ActiveDownload {
                pid: 0,
                cache_dir: destination.join(".ytloadster-cache").join("1"),
                destination_dir: destination.clone(),
            },
        );

        cleanup_destination_parts_if_idle(&manager, &destination);
        assert!(destination.join("cancelled-video.mp4.part").exists());

        manager.unregister_process(1);
        cleanup_destination_parts_if_idle(&manager, &destination);

        assert!(!destination.join("cancelled-video.mp4.part").exists());
        assert!(destination.join("finished-video.mp4").exists());
        let _ = fs::remove_dir_all(root);
    }

    fn sample_download_request() -> DownloadRequest {
        DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            preset: DownloadPreset::Mp4Video,
            format_id: Some("137".to_string()),
            audio_format_id: Some("140".to_string()),
            video_profile: None,
            format_label: Some("1080p 30fps mp4".to_string()),
            thumbnail: Some("https://i.ytimg.com/example.jpg".to_string()),
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: Some(CookieSource::File(PathBuf::from("C:/cookies.txt"))),
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: None,
            canonical_source: Some("https://www.youtube.com/watch?v=x".to_string()),
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        }
    }

    fn sample_audio_request() -> DownloadRequest {
        let mut request = sample_download_request();
        request.preset = DownloadPreset::AudioMp3;
        request.format_id = Some("140".to_string());
        request.audio_format_id = None;
        request.video_profile = None;
        request.format_label = Some("128kbps M4A".to_string());
        request.audio_bitrate = Some("320K".to_string());
        request.audio_channels = Some("stereo".to_string());
        request.embed_metadata = Some(false);
        request.embed_thumbnail = Some(false);
        request.subtitle = None;
        request.video_technical_details = None;
        request
    }

    fn sample_subtitle_request(automatic: bool) -> DownloadRequest {
        let mut request = sample_download_request();
        request.preset = DownloadPreset::Subtitles;
        request.format_id = Some("ru".to_string());
        request.audio_format_id = None;
        request.video_profile = None;
        request.format_label = Some("Русский (ru) • SRT".to_string());
        request.audio_bitrate = None;
        request.audio_channels = None;
        request.embed_metadata = None;
        request.embed_thumbnail = None;
        request.subtitle = Some(SubtitleSelection {
            language: "ru".to_string(),
            format: "srt".to_string(),
            automatic,
        });
        request.video_technical_details = None;
        request
    }

    fn unique_test_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "ytloadster-{prefix}-{}-{nanos}",
            std::process::id()
        ))
    }
}
