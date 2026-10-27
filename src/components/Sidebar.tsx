import { useState, type FocusEvent, type MouseEvent, type PointerEvent } from "react";
import { useI18n } from "../lib/i18n";
import type { ThemePreference } from "../lib/theme";
import { PlaylistDownloadIcon } from "./PlaylistDownloadIcon";
import { YouTubeMusicIcon } from "./YouTubeMusicIcon";

export type AppSection = "new" | "playlist" | "music" | "queue" | "history" | "settings";

type Props = {
  active: AppSection;
  queueCount: number;
  notificationsEnabled: boolean;
  notificationPending: boolean;
  theme: ThemePreference;
  onSectionChange: (section: AppSection) => void;
  onNotifications: () => void;
  onTheme: (event: MouseEvent<HTMLButtonElement>) => void;
  onSettings: () => void;
};

const navigation: Array<{ key: AppSection; label: "nav.newDownload" | "nav.playlist" | "nav.music" | "nav.queue" | "nav.history"; icon: IconName }> = [
  { key: "new", label: "nav.newDownload", icon: "download" },
  { key: "playlist", label: "nav.playlist", icon: "playlist" },
  { key: "music", label: "nav.music", icon: "music" },
  { key: "queue", label: "nav.queue", icon: "queue" },
  { key: "history", label: "nav.history", icon: "history" },
];

type IconName = "download" | "playlist" | "music" | "queue" | "history" | "bell" | "bellOff" | "sun" | "moon" | "systemTheme" | "settings";

export const sidebarPinnedStorageKey = "ytloadster.sidebarPinned";

export function Sidebar({
  active,
  queueCount,
  notificationsEnabled,
  notificationPending,
  theme,
  onSectionChange,
  onNotifications,
  onTheme,
  onSettings,
}: Props) {
  const { t } = useI18n();
  const nextTheme = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
  const themeLabel = theme === "dark" ? t("sidebar.darkTheme") : theme === "light" ? t("sidebar.lightTheme") : t("sidebar.systemTheme");
  const themeAriaLabel = nextTheme === "dark" ? t("theme.enableDark") : nextTheme === "light" ? t("theme.enableLight") : t("theme.enableSystem");
  const themeIcon: IconName = theme === "dark" ? "moon" : theme === "light" ? "sun" : "systemTheme";
  const [pinned, setPinned] = useState(loadSidebarPinned);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const expanded = pinned || hovered || focusWithin;

  function togglePinned(event: MouseEvent<HTMLButtonElement>) {
    const next = !pinned;
    setPinned(next);
    if (event.detail > 0) {
      setFocusWithin(false);
      event.currentTarget.blur();
    }
    try { window.localStorage.setItem(sidebarPinnedStorageKey, String(next)); } catch { /* storage is optional */ }
  }

  function selectSection(event: MouseEvent<HTMLButtonElement>, section: AppSection) {
    onSectionChange(section);
    if (event.detail > 0) {
      setFocusWithin(false);
      event.currentTarget.blur();
    }
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
      setFocusWithin(false);
    }
  }

  function handlePointerLeave(event: PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerStillInside = rect.width > 0
      && rect.height > 0
      && event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom;
    if (!pointerStillInside) setHovered(false);
  }

  return (
    <div className="app-sidebar-rail" data-pinned={pinned || undefined} data-expanded={expanded || undefined}>
      <nav
        className="app-sidebar"
        aria-label={t("nav.primary")}
        data-pinned={pinned || undefined}
        data-expanded={expanded || undefined}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={handlePointerLeave}
        onFocus={() => setFocusWithin(true)}
        onBlur={handleBlur}
      >
        <div className="sidebar-navigation">
          {navigation.map((item) => {
            const count = item.key === "queue" ? queueCount : 0;
            return (
              <button
                key={item.key}
                type="button"
                className="sidebar-item"
                data-active={active === item.key}
                aria-current={active === item.key ? "page" : undefined}
                aria-label={t(item.label)}
                title={t(item.label)}
                onClick={(event) => selectSection(event, item.key)}
              >
                <span className="sidebar-icon-wrap">
                  <SidebarIcon name={item.icon} />
                  {count > 0 ? <span className="sidebar-badge sidebar-badge-compact">{count > 99 ? "99+" : count}</span> : null}
                </span>
                <span className="sidebar-label">{t(item.label)}</span>
                {count > 0 ? <span className="sidebar-badge sidebar-badge-wide">{count > 99 ? "99+" : count}</span> : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="sidebar-pin-button"
          aria-label={pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          aria-pressed={pinned}
          title={pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          onClick={togglePinned}
        >
          <PinIcon pinned={pinned} />
        </button>

        <div className="sidebar-spacer" />
        <div className="sidebar-divider" />
        <div className="header-utilities sidebar-utilities">
          <SidebarUtility
            label={t("sidebar.notifications")}
            ariaLabel={notificationsEnabled ? t("notifications.disable") : t("notifications.enable")}
            icon={notificationsEnabled ? "bell" : "bellOff"}
            pressed={notificationsEnabled}
            disabled={notificationPending}
            onClick={onNotifications}
          />
          <SidebarUtility
            label={themeLabel}
            ariaLabel={themeAriaLabel}
            icon={themeIcon}
            pressed={theme === "dark"}
            themeToggle
            onClick={onTheme}
          />
          <SidebarUtility label={t("app.settings")} icon="settings" active={active === "settings"} onClick={onSettings} />
        </div>
      </nav>
    </div>
  );
}

function loadSidebarPinned() {
  try { return window.localStorage.getItem(sidebarPinnedStorageKey) === "true"; } catch { return false; }
}

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg className={pinned ? "is-pinned" : undefined} aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M8 4h8l-1.35 5 2.35 2.5V13H7v-1.5L9.35 9 8 4Z" />
      <path d="M12 13v7" />
    </svg>
  );
}

function SidebarUtility({
  label,
  ariaLabel,
  icon,
  pressed,
  active = false,
  disabled = false,
  themeToggle = false,
  onClick,
}: {
  label: string;
  ariaLabel?: string;
  icon: IconName;
  pressed?: boolean;
  active?: boolean;
  disabled?: boolean;
  themeToggle?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="sidebar-item sidebar-utility"
      aria-label={ariaLabel ?? label}
      aria-pressed={pressed}
      aria-current={active ? "page" : undefined}
      aria-disabled={disabled || undefined}
      aria-busy={disabled || undefined}
      data-theme-toggle={themeToggle || undefined}
      data-active={active || undefined}
      title={ariaLabel ?? label}
      onClick={(event) => {
        if (!disabled) onClick(event);
      }}
    >
      <span className="sidebar-icon-wrap"><SidebarIcon name={icon} /></span>
      <span className="sidebar-label">{label}</span>
    </button>
  );
}

function SidebarIcon({ name }: { name: IconName }) {
  if (name === "music") return <YouTubeMusicIcon />;
  if (name === "download") return (
    <svg className="download-tray-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3v10m-4-4 4 4 4-4" />
      <path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14" />
    </svg>
  );
  if (name === "playlist") return <PlaylistDownloadIcon />;
  if (name === "queue") return (
    <svg className="queue-list-icon" aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="4.25" cy="6" r="1.05" />
      <circle cx="4.25" cy="12" r="1.05" />
      <circle cx="4.25" cy="18" r="1.05" />
      <path d="M7.5 6H20.5M7.5 12H18.5M7.5 18H15.5" />
    </svg>
  );
  if (name === "history") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 1-7.3 4.7L2.8 7H8v5.2l-1.8-1.8A6 6 0 1 0 12 6V4Zm-1 3h2v4.6l3.2 2-1.1 1.7-4.1-2.6V7Z" /></svg>;
  if (name === "bell" || name === "bellOff") return (
    <svg className={`notification-icon ${name === "bell" ? "bell-icon" : "notification-off-icon"}`} aria-hidden="true" viewBox="0 0 24 24">
      <path d={name === "bellOff" ? "M8.7 3A6 6 0 0 1 18 8c0 3 .5 4.5 1.5 6M17 17H4s2-1.5 2-9a5.9 5.9 0 0 1 .3-1.9M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20" : "M18 8a6 6 0 0 0-12 0c0 7.5-2 9-2 9h16s-2-1.5-2-9M10.3 21a1.94 1.94 0 0 0 3.4 0"} />
    </svg>
  );
  if (name === "sun") return <svg className="sun-icon" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (name === "moon") return <svg className="moon-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>;
  if (name === "systemTheme") return <svg className="system-theme-icon" aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>;
}
