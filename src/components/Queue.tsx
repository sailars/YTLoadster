import type { Job } from "../lib/types";
import { useState } from "react";
import {
  isYouTubeAgeRestrictionError,
  isYouTubeBotConfirmationError,
  isYouTubeRateLimitError,
  sanitizeTechnicalError,
} from "../lib/errors";
import { localizeTechnicalText, useI18n, type AppLocale, type Translate, type TranslationKey } from "../lib/i18n";

const insufficientDiskSpaceError = "download-error:insufficient-disk-space";
const missingFfmpegError = "download-error:missing-ffmpeg";

type Props = {
  jobs: Job[];
  onCancel: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onCancelAll: () => void;
  onClear: () => void;
  onRemove: (id: number) => void;
  onOpenFolder: (path: string) => void;
  onRetry: (id: number) => void;
};

export function Queue({
  jobs,
  onCancel,
  onPause,
  onResume,
  onPauseAll,
  onResumeAll,
  onCancelAll,
  onClear,
  onRemove,
  onOpenFolder,
  onRetry,
}: Props) {
  const { locale, t } = useI18n();
  const runningJobs = jobs.filter((job) => job.state === "Running").length;
  const pausedJobs = jobs.filter((job) => job.state === "Paused");
  const pauseAllIsResume = pausedJobs.length > 0;
  const cancellableJobs = jobs.filter((job) =>
    ["Pending", "Running", "Paused"].includes(job.state),
  ).length;
  const clearableJobs = jobs.filter((job) =>
    ["Completed", "Failed", "Cancelled"].includes(job.state),
  ).length;

  return (
    <section className="queue-panel" aria-label={t("queue.label")}>
      <div className="section-heading">
        <div className="queue-heading-title">
          <h2>{t("queue.label")}</h2>
          <span className="queue-count" aria-label={t("queue.count", { count: jobs.length })}>
            {jobs.length}
          </span>
        </div>
        <div className="queue-actions queue-actions-horizontal">
          <button
            type="button"
            className="secondary queue-action-button"
            onClick={pauseAllIsResume ? onResumeAll : onPauseAll}
            disabled={!pauseAllIsResume && runningJobs < 2}
          >
            {pauseAllIsResume ? <PlayIcon /> : <PauseIcon />}
            <span>{pauseAllIsResume ? t("queue.resumeAll") : t("queue.pauseAll")}</span>
          </button>
          <button type="button" className="secondary queue-action-button clear-queue-button" onClick={onClear} disabled={clearableJobs === 0}>
            <TrashIcon />
            <span>{t("queue.clear")}</span>
          </button>
            <button
              type="button"
              className="secondary queue-action-button danger-queue-button"
              onClick={onCancelAll}
            disabled={cancellableJobs < 2}
            >
              <CloseIcon />
              <span>{t("queue.cancelAll")}</span>
            </button>
        </div>
      </div>
      {jobs.length === 0 ? (
        <div className="queue-empty">
          <QueueEmptyIcon />
          <div>
            <strong>{t("queue.emptyTitle")}</strong>
            <span>{t("queue.emptyText")}</span>
          </div>
        </div>
      ) : (
        <ol className="job-list">
          {jobs.map((job) => (
            <li key={job.id} className="job-row">
              {job.request?.thumbnail ? (
                <img
                  className="queue-thumbnail"
                  src={job.request.thumbnail}
                  alt={t("queue.preview", { title: job.request.title ?? job.id })}
                />
              ) : (
                <div className="queue-thumbnail placeholder" aria-hidden="true" />
              )}
              <div className="job-main">
                <QueueJobTitle title={job.request?.title ?? t("queue.untitled")} jobId={job.id} />
                <span className="job-url">{job.request?.url ?? ""}</span>
                <span className="job-params">{downloadParameters(job, locale, t)}</span>
                {shouldShowProgress(job) ? (
                  <>
                    <div className={`progress-track ${isProcessingPhase(job) ? "post-processing" : ""}`} aria-label={t("queue.progress", { id: job.id })}>
                      <div
                        className={`progress-fill ${progressClass(job)}`}
                        style={{ width: `${isProcessingPhase(job) ? 100 : job.progressPercent ?? 0}%` }}
                      />
                    </div>
                    {job.state !== "Completed" && !isProcessingPhase(job) ? (
                      <small>
                        {job.progressPercent ?? 0}% {job.speed ? ` • ${job.speed}` : ""}
                        {job.eta ? ` • ${t("queue.remaining", { eta: job.eta })}` : ""}
                      </small>
                    ) : null}
                  </>
                ) : null}
                {job.error ? <p className="error">{localizedJobError(job.error, locale, t)}</p> : null}
              </div>
              <div className="job-actions">
                <strong>{jobStatus(job, t)}</strong>
                {job.state === "Completed" ? (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("queue.openFolder", { title: job.request?.title ?? job.id })}
                    onClick={() => onOpenFolder(job.request.destinationDir)}
                  >
                    <FolderIcon />
                  </button>
                ) : null}
                {canRemoveFromQueue(job) ? (
                  <button
                    type="button"
                    className="icon-button danger-action"
                    aria-label={t("queue.remove", { title: job.request?.title ?? job.id })}
                    title={t("queue.removeTitle")}
                    onClick={() => onRemove(job.id)}
                  >
                    <TrashIcon />
                  </button>
                ) : null}
                {job.state === "Running" ? (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("queue.pause", { title: job.request?.title ?? job.id })}
                    title={t("queue.pauseTitle")}
                    onClick={() => onPause(job.id)}
                  >
                    <PauseIcon />
                  </button>
                ) : null}
                {job.state === "Paused" ? (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("queue.resume", { title: job.request?.title ?? job.id })}
                    title={t("queue.resumeTitle")}
                    onClick={() => onResume(job.id)}
                  >
                    <PlayIcon />
                  </button>
                ) : null}
                {job.state === "Failed" || job.state === "Cancelled" ? (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("queue.retry", { title: job.request?.title ?? job.id })}
                    title={t("queue.retryTitle")}
                    onClick={() => onRetry(job.id)}
                  >
                    <ReturnIcon />
                  </button>
                ) : null}
                {job.state === "Pending" || job.state === "Running" || job.state === "Paused" ? (
                  <button
                    type="button"
                    className="icon-button danger-action"
                    aria-label={t("queue.cancel", { title: job.request?.title ?? job.id })}
                    title={t("queue.cancelTitle")}
                    onClick={() => onCancel(job.id)}
                  >
                    <CloseIcon />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function QueueJobTitle({ title, jobId }: { title: string; jobId: number }) {
  const [isTooltipVisible, setTooltipVisible] = useState(false);
  const tooltipId = `queue-job-title-tooltip-${jobId}`;

  return (
    <span
      className="queue-title-tooltip"
      tabIndex={0}
      aria-describedby={isTooltipVisible ? tooltipId : undefined}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <span className="job-title">{title}</span>
      {isTooltipVisible ? (
        <span id={tooltipId} className="queue-title-tooltip-content" role="tooltip">
          {title}
        </span>
      ) : null}
    </span>
  );
}

function QueueEmptyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 7.5h14" />
      <path d="M5 12h14" />
      <path d="M5 16.5h9" />
      <circle cx="3" cy="7.5" r=".75" fill="currentColor" stroke="none" />
      <circle cx="3" cy="12" r=".75" fill="currentColor" stroke="none" />
      <circle cx="3" cy="16.5" r=".75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function downloadParameters(job: Job, locale: AppLocale, t: Translate) {
  const request = job.request;
  const format = request.formatLabel
    ? localizeTechnicalText(request.formatLabel, locale)
    : request.formatId
      ? t("queue.format", { id: request.formatId })
      : null;
  const auth =
    request.cookieSource?.kind === "browser" ? t("queue.login", { browser: request.cookieSource.value.browser }) : null;
  return [t(`preset.${request.preset}` as TranslationKey), format, t("queue.folder", { path: request.destinationDir }), auth]
    .filter(Boolean)
    .join(" • ");
}

function localizedJobError(error: string, locale: "ru" | "en", t: Translate) {
  if (error === insufficientDiskSpaceError) return t("error.insufficientDiskSpace");
  if (error === missingFfmpegError) return t("error.missingFfmpeg");
  if (isYouTubeAgeRestrictionError(error)) return t("error.ageRestricted");
  if (isYouTubeBotConfirmationError(error)) return t("error.botConfirmation");
  if (isYouTubeRateLimitError(error)) return t("error.rateLimited");
  if (locale === "en" && /[А-Яа-яЁё]/.test(error)) return t("error.unknown");
  return sanitizeTechnicalError(error, locale === "ru" ? "программа" : "application");
}

function shouldShowProgress(job: Job) {
  return (
    job.state === "Pending" ||
    job.state === "Running" ||
    job.state === "Paused" ||
    job.state === "Completed"
  );
}

function progressClass(job: Job) {
  if (job.state === "Completed") {
    return "completed";
  }
  if (job.state === "Running") {
    return isProcessingPhase(job) ? "post-processing" : "running";
  }
  return "";
}

function isProcessingPhase(job: Job) {
  return job.phase === "Merging" || job.phase === "PostProcessing";
}

function jobStatus(job: Job, t: Translate) {
  if (job.state !== "Running") {
    return t(`state.${job.state}` as TranslationKey);
  }

  switch (job.phase) {
    case "DownloadingVideo":
      return t("queue.downloadingVideo");
    case "DownloadingAudio":
      return job.request.preset === "bestVideo" || job.request.preset === "mp4Video"
        ? t("queue.downloadingAudioTrack")
        : t("queue.downloadingAudio");
    case "Merging":
      return t("queue.mergingVideo");
    case "PostProcessing":
      return t("queue.convertingAudio");
    default:
      return t(`state.${job.state}` as TranslationKey);
  }
}

function canRemoveFromQueue(job: Job) {
  return job.state !== "Running" && job.state !== "Paused";
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-11Zm2.5-.7a.7.7 0 0 0-.7.7V8h14.4a.7.7 0 0 0-.7-.7h-7.25l-2-2H5.5Zm-.7 4v7.7c0 .39.31.7.7.7h13a.7.7 0 0 0 .7-.7V9.8H4.8Z" />
    </svg>
  );
}

function ReturnIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M9.7 5.3 4 11l5.7 5.7 1.27-1.27L7.44 11.9H15a4.2 4.2 0 1 1 0 8.4h-3v1.8h3a6 6 0 1 0 0-12H7.44l3.53-3.53L9.7 5.3Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M6 4h4v16H6V4Zm8 0h4v16h-4V4Z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-2 6h12l-1 12H7L6 9Zm3.85 2-.35 8h2l.25-8h-1.9Zm4.3 0h-1.9l.25 8h2l-.35-8Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="m6.7 5.3 5.3 5.3 5.3-5.3 1.4 1.4-5.3 5.3 5.3 5.3-1.4 1.4-5.3-5.3-5.3 5.3-1.4-1.4 5.3-5.3-5.3-5.3 1.4-1.4Z" />
    </svg>
  );
}
