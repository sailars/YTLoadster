import type { Job, JobState } from "../lib/types";
import { useEffect, useState } from "react";
import {
  isYouTubeAgeRestrictionError,
  isYouTubeBotConfirmationError,
  isYouTubeRateLimitError,
  sanitizeTechnicalError,
} from "../lib/errors";
import { localizeTechnicalText, useI18n, type AppLocale, type Translate, type TranslationKey } from "../lib/i18n";
import { MediaThumbnail } from "./MediaThumbnail";

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
  const { t } = useI18n();
  const [filter, setFilter] = useState<JobState | "All">("All");
  const queueJobs = jobs.filter((job) => job.state !== "Completed");
  const groupOrder: JobState[] = ["Running", "Pending", "Paused", "Failed", "Cancelled"];
  const runningJobs = queueJobs.filter((job) => job.state === "Running").length;
  const pausedJobs = queueJobs.filter((job) => job.state === "Paused");
  const pauseAllIsResume = pausedJobs.length > 0;
  const cancellableJobs = queueJobs.filter((job) =>
    ["Pending", "Running", "Paused"].includes(job.state),
  ).length;
  const clearableJobs = queueJobs.filter((job) =>
    ["Failed", "Cancelled"].includes(job.state),
  ).length;
  const presentStates = groupOrder.filter((state) => queueJobs.some((job) => job.state === state));
  const visibleJobs = filter === "All" ? queueJobs : queueJobs.filter((job) => job.state === filter);
  const groupedJobs = groupOrder
    .map((state) => ({ state, jobs: visibleJobs.filter((job) => job.state === state) }))
    .filter((group) => group.jobs.length > 0);

  useEffect(() => {
    if (filter !== "All" && !queueJobs.some((job) => job.state === filter)) setFilter("All");
  }, [filter, queueJobs]);

  return (
    <section className="queue-panel" aria-label={t("queue.label")}>
      <div className="section-heading queue-header">
        <div className="queue-heading-title">
          <h2>{t("queue.label")}</h2>
          <span className="queue-count" aria-label={t("queue.activeCount", { count: cancellableJobs })}>
            {cancellableJobs}
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
          <QueueBulkAction
            id="clear-queue-tooltip"
            label={t("queue.clear")}
            tooltip={t("queue.clearTooltip")}
            className="clear-queue-button"
            onClick={onClear}
            disabled={clearableJobs === 0}
            icon="trash"
          />
          <QueueBulkAction
            id="cancel-all-tooltip"
            label={t("queue.cancelAll")}
            tooltip={t("queue.cancelAllTooltip")}
            className="danger-queue-button"
            onClick={onCancelAll}
            disabled={cancellableJobs < 2}
            icon="close"
          />
        </div>
      </div>

      {queueJobs.length > 0 ? (
        <div className="queue-status-filters" role="toolbar" aria-label={t("queue.filters")}>
          <button type="button" className="queue-filter-chip filter-all" data-active={filter === "All" || undefined} onClick={() => setFilter("All")}>
            {t("queue.filterAll")} · {queueJobs.length}
          </button>
          {presentStates.map((state) => (
            <button
              key={state}
              type="button"
              className={`queue-filter-chip state-${state.toLowerCase()}`}
              data-active={filter === state || undefined}
              onClick={() => setFilter((current) => current === state ? "All" : state)}
            >
              {t(`state.${state}` as TranslationKey)} · {queueJobs.filter((job) => job.state === state).length}
            </button>
          ))}
        </div>
      ) : null}

      {queueJobs.length === 0 ? (
        <div className="queue-empty">
          <QueueEmptyIcon />
          <div>
            <strong>{t("queue.emptyTitle")}</strong>
            <span>{t("queue.emptyText")}</span>
          </div>
        </div>
      ) : groupedJobs.length === 0 ? (
        <div className="queue-filter-empty">{t("queue.filteredEmpty")}</div>
      ) : (
        <div className="queue-groups">
          {groupedJobs.map((group) => (
            <section key={group.state} className="queue-status-group" aria-labelledby={`queue-group-${group.state}`}>
              <h3 id={`queue-group-${group.state}`} className="queue-group-title">{t(`state.${group.state}` as TranslationKey)} · {group.jobs.length}</h3>
              <ol className="job-list">
                {group.jobs.map((job) => (
                  <QueueRow
                    key={job.id}
                    job={job}
                    onCancel={onCancel}
                    onPause={onPause}
                    onResume={onResume}
                    onRemove={onRemove}
                    onRetry={onRetry}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function QueueRow({
  job,
  onCancel,
  onPause,
  onResume,
  onRemove,
  onRetry,
}: {
  job: Job;
  onCancel: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onRemove: (id: number) => void;
  onRetry: (id: number) => void;
}) {
  const { locale, t } = useI18n();
  const title = job.request?.title ?? t("queue.untitled");
  return (
    <li className="job-row" data-state={job.state.toLowerCase()}>
      <MediaThumbnail
        src={job.request?.thumbnail}
        mediaUrl={job.request?.canonicalSource ?? job.request?.url}
        alt={t("queue.preview", { title })}
        className="queue-thumbnail"
        placeholderClassName="queue-thumbnail placeholder"
      />
      <div className="job-main">
        <div className="queue-job-heading">
          <QueueJobTitle title={title} jobId={job.id} />
          <span className={`queue-state-badge state-${job.state.toLowerCase()}`}>{jobStatus(job, t)}</span>
        </div>
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
            {!isProcessingPhase(job) ? (
              <small className="queue-progress-copy">
                <span>{job.progressPercent ?? 0}%</span>
                {job.state === "Running" && job.speed ? <span>{job.speed}</span> : null}
                {job.state === "Running" && job.eta ? <span>{t("queue.remaining", { eta: job.eta })}</span> : null}
              </small>
            ) : null}
          </>
        ) : null}
        {job.error ? <p className="error">{localizedJobError(job.error, locale, t)}</p> : null}
      </div>
      <div className="job-actions">
        {job.state === "Running" ? (
          <button type="button" className="icon-button" aria-label={t("queue.pause", { title })} title={t("queue.pauseTitle")} onClick={() => onPause(job.id)}><PauseIcon /></button>
        ) : null}
        {job.state === "Paused" ? (
          <button type="button" className="icon-button" aria-label={t("queue.resume", { title })} title={t("queue.resumeTitle")} onClick={() => onResume(job.id)}><PlayIcon /></button>
        ) : null}
        {job.state === "Failed" || job.state === "Cancelled" ? (
          <button type="button" className="icon-button" aria-label={t("queue.retry", { title })} title={t("queue.retryTitle")} onClick={() => onRetry(job.id)}><ReturnIcon /></button>
        ) : null}
        {job.state === "Pending" || job.state === "Running" || job.state === "Paused" ? (
          <button type="button" className="icon-button danger-action" aria-label={t("queue.cancel", { title })} title={t("queue.cancelTitle")} onClick={() => onCancel(job.id)}><CloseIcon /></button>
        ) : null}
        {canRemoveFromQueue(job) ? (
          <button type="button" className="icon-button danger-action" aria-label={t("queue.remove", { title })} title={t("queue.removeTitle")} onClick={() => onRemove(job.id)}><TrashIcon /></button>
        ) : null}
      </div>
    </li>
  );
}

function QueueBulkAction({
  id,
  label,
  tooltip,
  className,
  onClick,
  disabled,
  icon,
}: {
  id: string;
  label: string;
  tooltip: string;
  className: string;
  onClick: () => void;
  disabled: boolean;
  icon: "trash" | "close";
}) {
  return (
    <span
      className="queue-action-tooltip"
      tabIndex={disabled ? 0 : undefined}
      aria-label={disabled ? label : undefined}
      aria-describedby={disabled ? id : undefined}
    >
      <button
        type="button"
        className={`secondary queue-action-button ${className}`}
        onClick={onClick}
        disabled={disabled}
        aria-describedby={id}
      >
        {icon === "trash" ? <TrashIcon /> : <CloseIcon />}
        <span>{label}</span>
      </button>
      <span id={id} className="queue-action-tooltip-content" role="tooltip">
        {tooltip}
      </span>
    </span>
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
  return job.state === "Failed" || job.state === "Cancelled";
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
