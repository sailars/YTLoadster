import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ParameterSelectOption = {
  value: string;
  label: string;
  description?: string;
  group?: string;
  disabled?: boolean;
  disabledReason?: string;
  title?: string;
  icon?: ReactNode;
};

type Props = {
  label: string;
  value: string;
  options: ParameterSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  selectedOption?: ParameterSelectOption;
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

export function ParameterSelect({ label, value, options, onChange, disabled = false, selectedOption }: Props) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeValue, setActiveValue] = useState(value);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const selected = options.find((option) => option.value === value) ?? selectedOption ?? options[0];

  useEffect(() => {
    setActiveValue(value);
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;

    function positionMenu() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const preferredHeight = Math.min(320, options.reduce((height, option) => height + (option.description ? 54 : 35), 8));
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openAbove = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
      const availableHeight = Math.max(80, openAbove ? spaceAbove - 4 : spaceBelow - 4);

      setMenuPosition({
        left: rect.left + window.scrollX,
        top: (openAbove ? Math.max(8, rect.top - Math.min(preferredHeight, availableHeight) - 4) : rect.bottom + 4) + window.scrollY,
        width: rect.width,
        maxHeight: Math.min(preferredHeight, availableHeight),
      });
    }

    function closeOnOutsidePointer(event: MouseEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }

    positionMenu();
    document.addEventListener("mousedown", closeOnOutsidePointer);
    window.addEventListener("resize", positionMenu);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePointer);
      window.removeEventListener("resize", positionMenu);
    };
  }, [isOpen, options.length]);

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  function enabledOptions() {
    return options.filter((option) => !option.disabled);
  }

  function moveActive(direction: 1 | -1) {
    const available = enabledOptions();
    if (!available.length) return;
    const currentIndex = available.findIndex((option) => option.value === activeValue);
    const nextIndex = currentIndex < 0
      ? (direction > 0 ? 0 : available.length - 1)
      : (currentIndex + direction + available.length) % available.length;
    setActiveValue(available[nextIndex].value);
  }

  function choose(nextValue: string) {
    const option = options.find((candidate) => candidate.value === nextValue);
    if (!option || option.disabled) return;
    onChange(nextValue);
    setActiveValue(nextValue);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveValue(value);
      } else {
        moveActive(event.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen) choose(activeValue);
      else setIsOpen(true);
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
    }
  }

  return (
    <div className="parameter-select">
      <button
        ref={triggerRef}
        type="button"
        className="parameter-select-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? `${listboxId}-${activeValue}` : undefined}
        data-value={value}
        disabled={disabled}
        onClick={() => {
          setActiveValue(value);
          setIsOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="parameter-select-selected-copy">
          <span className="parameter-select-label">{selected?.icon ? <span className="parameter-select-icon" aria-hidden="true">{selected.icon}</span> : null}{selected?.label ?? ""}</span>
          {selected?.description ? <small>{selected.description}</small> : null}
        </span>
        <ChevronIcon expanded={isOpen} />
      </button>

      {isOpen && menuPosition
        ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className="parameter-select-menu"
            role="listbox"
            aria-label={label}
            style={menuPosition}
            onWheel={(event) => event.stopPropagation()}
          >
            {options.map((option, index) => (
              <div className="parameter-select-option-wrap" key={option.value}>
                {option.group && (index === 0 || options[index - 1].group !== option.group) ? <div className="parameter-select-group">{option.group}</div> : null}
                <button
                id={`${listboxId}-${option.value}`}
                type="button"
                className={`parameter-select-option${option.value === value ? " selected" : ""}${option.value === activeValue ? " active" : ""}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                title={option.title ?? option.disabledReason}
                tabIndex={-1}
                data-value={option.value}
                onMouseEnter={() => !option.disabled && setActiveValue(option.value)}
                onClick={() => choose(option.value)}
              >
                <span className="parameter-select-option-copy">
                  <span className="parameter-select-label">{option.icon ? <span className="parameter-select-icon" aria-hidden="true">{option.icon}</span> : null}{option.label}</span>
                  {option.description ? <small>{option.description}</small> : null}
                  {option.disabled && option.disabledReason ? <small className="parameter-select-disabled-reason">{option.disabledReason}</small> : null}
                </span>
              </button>
              </div>
            ))}
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className={`chevron-icon${expanded ? " expanded" : ""}`} aria-hidden="true" viewBox="0 0 20 20" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6.5 8 3.5 3.5L13.5 8" />
    </svg>
  );
}
