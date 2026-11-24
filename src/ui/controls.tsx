// Basic controls, drawn from scratch in the Apple style.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Icon } from './icons';
import { Menu, useAnchor } from './overlay';
import type { MenuEntry } from './overlay';

type ButtonVariant = 'filled' | 'tinted' | 'gray' | 'plain' | 'destructive' | 'glass';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  disabled?: boolean;
  full?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}

export function Button({ children, onClick, variant = 'filled', size = 'md', icon, disabled, full, type = 'button', className = '' }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`btn btn-${variant} btn-${size} ${variant === 'glass' ? 'glass' : ''} ${full ? 'btn-full' : ''} ${className}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

interface IconButtonProps {
  icon: ReactNode;
  label: string;
  onClick?: (target: HTMLButtonElement) => void;
  variant?: 'glass' | 'plain' | 'filled' | 'gray' | 'tinted';
  size?: 'sm' | 'md';
  disabled?: boolean;
  active?: boolean;
  badge?: number;
  className?: string;
}

export function IconButton({ icon, label, onClick, variant = 'plain', size = 'md', disabled, active, badge, className = '' }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={(event) => onClick?.(event.currentTarget)}
      className={`icon-btn ${size} ${variant} ${variant === 'glass' ? 'glass' : ''} ${className}`}
    >
      {icon}
      {badge ? <span className="badge">{badge > 9 ? '9+' : badge}</span> : null}
    </button>
  );
}

// ── Segmented control ──────────────────────────────────────────────────────────────────────────

interface SegmentedProps<T extends string | number> {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
  full?: boolean;
  size?: 'sm' | 'md';
}

export function Segmented<T extends string | number>({ value, options, onChange, label, full, size = 'md' }: SegmentedProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length;
    onChange(options[next].value);
  };
  return (
    <div
      className={`seg seg-${size} ${full ? 'seg-full' : ''}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ '--n': options.length, '--i': index } as CSSProperties}
    >
      <span className="seg-thumb" />
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Switch, check circle, slider ───────────────────────────────────────────────────────────────

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

interface CheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  color?: string;
  size?: number;
}

/** The round tick used for tasks and to-dos. */
export function Check({ checked, onChange, label, color, size = 24 }: CheckProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className="check"
      style={{ '--c': color, '--s': `${size}px` } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      <Icon.check />
    </button>
  );
}

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  className?: string;
  style?: CSSProperties;
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, label, className = '', style }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const ratio = (value - min) / (max - min);
  const fromPointer = (clientX: number) => {
    const rect = (ref.current as HTMLDivElement).getBoundingClientRect();
    const raw = min + Math.min(1, Math.max(0, (clientX - rect.left - 14) / (rect.width - 28))) * (max - min);
    onChange(Math.round(raw / step) * step);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    fromPointer(event.clientX);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientX);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    onChange(Math.min(max, Math.max(min, value + delta * (event.shiftKey ? 10 : 1))));
  };
  return (
    <div
      ref={ref}
      className={`slider ${className}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      style={{ ...style, '--r': ratio } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <span className="slider-track" />
      <span className="slider-thumb" />
    </div>
  );
}

// ── Text input ─────────────────────────────────────────────────────────────────────────────────

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'password' | 'url' | 'search';
  icon?: ReactNode;
  label: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  clearable?: boolean;
  trailing?: ReactNode;
  autoComplete?: string;
  className?: string;
  name?: string;
}

export function TextInput({
  value, onChange, placeholder, type = 'text', icon, label, autoFocus, onEnter, clearable, trailing, autoComplete = 'off', className = '', name,
}: TextInputProps) {
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';
  return (
    <label className={`input ${className}`}>
      {icon && <span className="input-icon">{icon}</span>}
      <input
        name={name}
        aria-label={label}
        type={isPassword ? (reveal ? 'text' : 'password') : type === 'search' ? 'text' : type}
        inputMode={type === 'email' ? 'email' : type === 'url' ? 'url' : type === 'search' ? 'search' : undefined}
        enterKeyHint={type === 'search' ? 'search' : onEnter ? 'done' : undefined}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize={type === 'text' ? 'sentences' : 'none'}
        autoCorrect={type === 'text' ? 'on' : 'off'}
        spellCheck={type === 'text'}
        data-autofocus={autoFocus || undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
      />
      {isPassword && value && (
        <button type="button" className="input-action" aria-label={reveal ? 'Hide password' : 'Show password'} onClick={() => setReveal(!reveal)}>
          {reveal ? <Icon.eyeOff /> : <Icon.eye />}
        </button>
      )}
      {clearable && value && (
        <button type="button" className="input-action" aria-label="Clear" onClick={() => onChange('')}>
          <Icon.closeCircle />
        </button>
      )}
      {trailing}
    </label>
  );
}

interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  minRows?: number;
  className?: string;
  autoFocus?: boolean;
}

/** A text area that grows with its content. */
export function TextArea({ value, onChange, placeholder, label, minRows = 2, className = '', autoFocus }: TextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      className={`textarea ${className}`}
      rows={minRows}
      value={value}
      placeholder={placeholder}
      data-autofocus={autoFocus || undefined}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

// ── Grouped lists (the Settings-style rows) ────────────────────────────────────────────────────

export function Group({ title, footer, children, className = '' }: { title?: string; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`group-wrap ${className}`}>
      {title && <h3 className="group-title">{title}</h3>}
      <div className="group">{children}</div>
      {footer && <p className="group-footer">{footer}</p>}
    </section>
  );
}

interface RowProps {
  label?: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  iconColor?: string;
  value?: ReactNode;
  trailing?: ReactNode;
  onClick?: (target: HTMLElement) => void;
  chevron?: boolean;
  destructive?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Row({ label, detail, icon, iconColor, value, trailing, onClick, chevron, destructive, children, className = '' }: RowProps) {
  const content = (
    <>
      {icon && (
        <span className={`row-icon ${iconColor ? 'filled' : ''}`} style={iconColor ? ({ '--c': iconColor } as CSSProperties) : undefined}>
          {icon}
        </span>
      )}
      {(label || detail) && (
        <span className="row-text">
          {label && <span className="row-label">{label}</span>}
          {detail && <span className="row-detail">{detail}</span>}
        </span>
      )}
      {children}
      {value !== undefined && <span className="row-value">{value}</span>}
      {trailing}
      {chevron && <Icon.chevronForward className="row-chevron" />}
    </>
  );
  const classes = `row ${icon ? 'has-icon' : ''} ${destructive ? 'destructive' : ''} ${className}`;
  return onClick ? (
    <button type="button" className={`${classes} row-button`} onClick={(event) => onClick(event.currentTarget)}>
      {content}
    </button>
  ) : (
    <div className={classes}>{content}</div>
  );
}

// ── Select (a pop-up button with a menu) ───────────────────────────────────────────────────────

interface SelectProps<T extends string | number | null> {
  value: T;
  options: { value: T; label: string; swatch?: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function Select<T extends string | number | null>({ value, options, onChange, label, className = '' }: SelectProps<T>) {
  const menu = useAnchor();
  const current = options.find((o) => o.value === value);
  const items: MenuEntry[] = options.map((option) => ({
    label: option.label,
    checked: option.value === value,
    swatch: option.swatch,
    onSelect: () => onChange(option.value),
  }));
  return (
    <>
      <button type="button" className={`select ${className}`} aria-label={label} aria-haspopup="menu" onClick={(event) => menu.show(event.currentTarget)}>
        {current?.swatch && <span className="menu-swatch" style={{ background: current.swatch }} />}
        <span>{current?.label ?? 'Choose'}</span>
        <Icon.chevronExpand />
      </button>
      <Menu open={menu.open} anchor={menu.anchor} onClose={menu.hide} items={items} />
    </>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      <p className="empty-text">{text}</p>
      {action}
    </div>
  );
}

/** Runs a callback once per interval while mounted (clocks, countdowns). */
export function useTick(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
