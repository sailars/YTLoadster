type Props = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  pasteLabel: string;
  pasteTooltip: string;
  clearLabel: string;
  onChange: (value: string) => void;
  onPaste: () => void;
  onClear: () => void;
};

export function UrlInput({
  id,
  label,
  value,
  placeholder,
  pasteLabel,
  pasteTooltip,
  clearLabel,
  onChange,
  onPaste,
  onClear,
}: Props) {
  return (
    <>
      <label className="input-label" htmlFor={id}>{label}</label>
      <div className="url-row">
        <input
          id={id}
          value={value}
          data-has-url={Boolean(value.trim())}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
        />
        <button type="button" className="url-action-button url-paste-button" aria-label={pasteTooltip} title={pasteTooltip} onClick={onPaste}>
          <ClipboardIcon />
          <span>{pasteLabel}</span>
        </button>
        <button
          type="button"
          className="icon-button url-action-button url-clear-button"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={onClear}
          disabled={!value.trim()}
        >
          <ClearIcon />
        </button>
      </div>
    </>
  );
}

function ClipboardIcon() {
  return (
    <svg className="url-action-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 5H6.75A2.25 2.25 0 0 0 4.5 7.25v12A2.25 2.25 0 0 0 6.75 21h10.5a2.25 2.25 0 0 0 2.25-2.25V7.25A2.25 2.25 0 0 0 17.25 5H16" />
      <rect x="8" y="2.75" width="8" height="4.5" rx="1.5" />
      <path d="M8.5 11.5h7" />
      <path d="M8.5 15.5h5" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg className="url-action-icon clear-url-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M7 7l10 10" />
      <path d="M17 7 7 17" />
    </svg>
  );
}
