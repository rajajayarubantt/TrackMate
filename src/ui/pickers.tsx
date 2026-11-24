// Pickers: date, time, colour, icon and tags. Custom replacements for the browser's own pickers.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useTags } from '../db/hooks';
import { createTag } from '../db/repo';
import type { Tag } from '../db/types';
import { addDays, addMonths, fmt, sameDay, startOfDay, startOfMonth, startOfWeek, weekdayLabels } from '../lib/dates';
import { navigate } from '../lib/router';
import { getSettings } from '../lib/session';
import { hexToHsv, hsvToHex, isHex, SWATCHES } from '../lib/tints';
import { Segmented, Slider } from './controls';
import { Icon, TAG_ICONS, TagGlyph } from './icons';
import { Popover, useAnchor } from './overlay';
import type { Anchor } from './overlay';

// ── Month grid ─────────────────────────────────────────────────────────────────────────────────

interface MonthGridProps {
  value: number | null;
  onChange: (day: number) => void;
  weekStart: number;
  /** Days that should show a dot (calendar view). */
  marks?: Set<number>;
  month?: number;
  onMonthChange?: (month: number) => void;
}

export function MonthGrid({ value, onChange, weekStart, marks, month: controlledMonth, onMonthChange }: MonthGridProps) {
  const [ownMonth, setOwnMonth] = useState(() => startOfMonth(value ?? Date.now()));
  const month = controlledMonth ?? ownMonth;
  const setMonth = (next: number) => {
    setOwnMonth(next);
    onMonthChange?.(next);
  };
  useEffect(() => {
    if (value !== null && controlledMonth === undefined) setOwnMonth(startOfMonth(value));
  }, [value, controlledMonth]);
  const today = startOfDay(Date.now());
  const first = startOfWeek(month, weekStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const monthIndex = new Date(month).getMonth();
  return (
    <div className="month">
      <div className="month-head">
        <span className="month-name">{fmt.monthYear(month)}</span>
        <button type="button" className="icon-btn sm plain" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <Icon.chevronBack />
        </button>
        <button type="button" className="icon-btn sm plain" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <Icon.chevronForward />
        </button>
      </div>
      <div className="month-week">
        {weekdayLabels(weekStart, 'short').map((label, i) => (
          <span key={i}>{label.slice(0, 3)}</span>
        ))}
      </div>
      <div className="month-days">
        {days.map((day) => {
          const selected = value !== null && sameDay(day, value);
          return (
            <button
              key={day}
              type="button"
              className="month-day"
              aria-label={fmt.dayLong(day)}
              aria-pressed={selected}
              data-out={new Date(day).getMonth() !== monthIndex || undefined}
              data-today={day === today || undefined}
              onClick={() => onChange(day)}
            >
              {new Date(day).getDate()}
              {marks?.has(day) && <i className="month-mark" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Date ───────────────────────────────────────────────────────────────────────────────────────

interface DatePopoverProps {
  open: boolean;
  anchor: Anchor;
  onClose: () => void;
  value: number | null;
  onChange: (day: number | null) => void;
  clearable?: boolean;
}

export function DatePopover({ open, anchor, onClose, value, onChange, clearable }: DatePopoverProps) {
  const today = startOfDay(Date.now());
  const pick = (day: number | null) => {
    onChange(day);
    onClose();
  };
  return (
    <Popover open={open} anchor={anchor} onClose={onClose} align="center" className="date-pop" label="Choose a date">
      <MonthGrid value={value} onChange={pick} weekStart={getSettings().weekStart} />
      <div className="quick-row">
        <button type="button" className="quick" onClick={() => pick(today)}>Today</button>
        <button type="button" className="quick" onClick={() => pick(addDays(today, 1))}>Tomorrow</button>
        <button type="button" className="quick" onClick={() => pick(addDays(today, 7))}>In a week</button>
        {clearable && value !== null && (
          <button type="button" className="quick quick-clear" onClick={() => pick(null)}>Clear</button>
        )}
      </div>
    </Popover>
  );
}

export function dateLabel(day: number): string {
  return new Date(day).getFullYear() === new Date().getFullYear() ? fmt.dayShort(day) : fmt.monthDayYear(day);
}

interface DateButtonProps {
  value: number | null;
  onChange: (day: number | null) => void;
  placeholder?: string;
  clearable?: boolean;
  label: string;
}

export function DateButton({ value, onChange, placeholder = 'Add date', clearable, label }: DateButtonProps) {
  const pop = useAnchor();
  return (
    <>
      <button type="button" className="pill" data-set={value !== null || undefined} aria-label={label} onClick={(e) => pop.show(e.currentTarget)}>
        {value !== null ? dateLabel(value) : placeholder}
      </button>
      <DatePopover open={pop.open} anchor={pop.anchor} onClose={pop.hide} value={value} onChange={onChange} clearable={clearable} />
    </>
  );
}

// ── Time (scrolling wheels) ────────────────────────────────────────────────────────────────────

const ITEM = 36;

function Wheel({ items, index, onChange, label }: { items: string[]; index: number; onChange: (index: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const latest = useRef(index);
  latest.current = index;
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / ITEM) !== index) el.scrollTop = index * ITEM;
  }, [index]);
  const onScroll = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const next = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)));
      if (next !== latest.current) onChange(next);
    }, 80);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div ref={ref} className="wheel" role="listbox" aria-label={label} tabIndex={0} onScroll={onScroll}
      onKeyDown={(event) => {
        const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (!delta) return;
        event.preventDefault();
        onChange(Math.min(items.length - 1, Math.max(0, index + delta)));
      }}
    >
      {items.map((item, i) => (
        <button key={i} type="button" role="option" aria-selected={i === index} tabIndex={-1} className="wheel-item"
          onClick={() => ref.current?.scrollTo({ top: i * ITEM, behavior: 'smooth' })}>
          {item}
        </button>
      ))}
    </div>
  );
}

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i === 0 ? 12 : i));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export function timeLabel(minutes: number, h24: boolean): string {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  if (h24) return `${String(h).padStart(2, '0')}:${m}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

interface TimePopoverProps {
  open: boolean;
  anchor: Anchor;
  onClose: () => void;
  /** Minutes after midnight. */
  value: number;
  onChange: (minutes: number) => void;
  onClear?: () => void;
}

export function TimePopover({ open, anchor, onClose, value, onChange, onClear }: TimePopoverProps) {
  const h24 = getSettings().time24;
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return (
    <Popover open={open} anchor={anchor} onClose={onClose} align="center" className="time-pop" label="Choose a time">
      <div className="wheels">
        <span className="wheels-band" />
        {h24 ? (
          <Wheel label="Hour" items={HOURS_24} index={hour} onChange={(h) => onChange(h * 60 + minute)} />
        ) : (
          <Wheel label="Hour" items={HOURS_12} index={hour % 12} onChange={(h) => onChange((h + (hour >= 12 ? 12 : 0)) * 60 + minute)} />
        )}
        <span className="wheels-colon">:</span>
        <Wheel label="Minute" items={MINUTES} index={minute} onChange={(m) => onChange(hour * 60 + m)} />
        {!h24 && (
          <Wheel label="AM or PM" items={['AM', 'PM']} index={hour >= 12 ? 1 : 0} onChange={(i) => onChange(((hour % 12) + i * 12) * 60 + minute)} />
        )}
      </div>
      <div className="quick-row">
        {[9 * 60, 12 * 60, 15 * 60, 18 * 60].map((preset) => (
          <button key={preset} type="button" className="quick" onClick={() => onChange(preset)}>
            {timeLabel(preset, h24).replace(':00', '')}
          </button>
        ))}
        {onClear && (
          <button type="button" className="quick quick-clear" onClick={() => { onClear(); onClose(); }}>
            Clear
          </button>
        )}
      </div>
    </Popover>
  );
}

interface TimeButtonProps {
  value: number | null;
  onChange: (minutes: number | null) => void;
  placeholder?: string;
  clearable?: boolean;
  label: string;
  /** Used when there is no time yet and the picker opens. */
  fallback?: number;
}

export function TimeButton({ value, onChange, placeholder = 'Add time', clearable, label, fallback = 9 * 60 }: TimeButtonProps) {
  const pop = useAnchor();
  return (
    <>
      <button
        type="button"
        className="pill"
        data-set={value !== null || undefined}
        aria-label={label}
        onClick={(e) => {
          if (value === null) onChange(fallback);
          pop.show(e.currentTarget);
        }}
      >
        {value !== null ? timeLabel(value, getSettings().time24) : placeholder}
      </button>
      <TimePopover open={pop.open} anchor={pop.anchor} onClose={pop.hide} value={value ?? fallback} onChange={onChange}
        onClear={clearable ? () => onChange(null) : undefined} />
    </>
  );
}

// ── Colour ─────────────────────────────────────────────────────────────────────────────────────

export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const preset = SWATCHES.includes(value.toUpperCase());
  const [mode, setMode] = useState<'swatches' | 'spectrum'>(preset ? 'swatches' : 'spectrum');
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [text, setText] = useState(value.toUpperCase());
  useEffect(() => setText(value.toUpperCase()), [value]);

  const apply = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    onChange(hsvToHex(next.h, next.s, next.v));
  };
  const onArea = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.type === 'pointerdown') event.currentTarget.setPointerCapture(event.pointerId);
    else if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    apply({ h: hsv.h, s, v });
  };

  return (
    <div className="color-picker">
      <Segmented
        label="Colour picker mode" size="sm" full value={mode} onChange={setMode}
        options={[{ value: 'swatches', label: 'Swatches' }, { value: 'spectrum', label: 'Spectrum' }]}
      />
      {mode === 'swatches' ? (
        <div className="swatches" role="radiogroup" aria-label="Colour">
          {SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={hex === value.toUpperCase()}
              aria-label={hex}
              className="swatch"
              style={{ '--c': hex } as CSSProperties}
              onClick={() => {
                setHsv(hexToHsv(hex));
                onChange(hex);
              }}
            >
              <Icon.check />
            </button>
          ))}
        </div>
      ) : (
        <div className="spectrum">
          <div
            className="sv-area"
            style={{ '--hue': hsv.h } as CSSProperties}
            onPointerDown={onArea}
            onPointerMove={onArea}
            role="application"
            aria-label="Saturation and brightness"
          >
            <span className="sv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
          </div>
          <Slider label="Hue" className="hue" min={0} max={359} value={Math.round(hsv.h)} onChange={(h) => apply({ ...hsv, h })}
            style={{ '--thumb': `hsl(${hsv.h} 100% 50%)` } as CSSProperties} />
          <label className="hex-field">
            <span className="hex-dot" style={{ background: value }} />
            <input
              aria-label="Hex colour"
              value={text}
              spellCheck={false}
              autoCapitalize="characters"
              maxLength={7}
              onChange={(event) => {
                let next = event.currentTarget.value.trim().toUpperCase();
                if (next && !next.startsWith('#')) next = `#${next}`;
                setText(next);
                if (isHex(next)) {
                  setHsv(hexToHsv(next));
                  onChange(next);
                }
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function ColorButton({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const pop = useAnchor();
  return (
    <>
      <button type="button" className="color-well" aria-label={label} style={{ '--c': value } as CSSProperties} onClick={(e) => pop.show(e.currentTarget)} />
      <Popover open={pop.open} anchor={pop.anchor} onClose={pop.hide} align="end" className="color-pop" label="Choose a colour">
        <ColorPicker value={value} onChange={onChange} />
      </Popover>
    </>
  );
}

// ── Icon ───────────────────────────────────────────────────────────────────────────────────────

export function IconPicker({ value, onChange, color }: { value: string; onChange: (icon: string) => void; color: string }) {
  const [query, setQuery] = useState('');
  const names = useMemo(() => Object.keys(TAG_ICONS).filter((name) => name.includes(query.trim().toLowerCase())), [query]);
  return (
    <div className="icon-picker" style={{ '--c': color } as CSSProperties}>
      <label className="input input-search">
        <span className="input-icon"><Icon.search /></span>
        <input aria-label="Search icons" placeholder="Search icons" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      </label>
      <div className="icon-grid" role="radiogroup" aria-label="Icon">
        {names.map((name) => (
          <button key={name} type="button" role="radio" aria-checked={name === value} aria-label={name} className="icon-cell" onClick={() => onChange(name)}>
            <TagGlyph name={name} size={20} />
          </button>
        ))}
        {!names.length && <p className="icon-none">No icon matches “{query}”.</p>}
      </div>
    </div>
  );
}

// ── Tags ───────────────────────────────────────────────────────────────────────────────────────

interface TagChipProps {
  tag: Tag;
  onRemove?: () => void;
  onClick?: () => void;
  size?: 'sm' | 'md';
  active?: boolean;
}

export function TagChip({ tag, onRemove, onClick, size = 'md', active }: TagChipProps) {
  const body = (
    <>
      <TagGlyph name={tag.icon} size={size === 'sm' ? 11 : 13} />
      <span>{tag.name}</span>
    </>
  );
  const style = { '--c': tag.color } as CSSProperties;
  if (onClick) {
    return (
      <button type="button" className={`chip chip-${size}`} style={style} data-active={active || undefined} aria-pressed={active} onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <span className={`chip chip-${size}`} style={style}>
      {body}
      {onRemove && (
        <button type="button" className="chip-x" aria-label={`Remove ${tag.name}`} onClick={onRemove}>
          <Icon.close />
        </button>
      )}
    </span>
  );
}

interface TagPopoverProps {
  open: boolean;
  anchor: Anchor;
  onClose: () => void;
  value: string[];
  onChange: (tagIds: string[]) => void;
}

export function TagPopover({ open, anchor, onClose, value, onChange }: TagPopoverProps) {
  const tags = useTags();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  const q = query.trim().toLowerCase();
  const shown = tags.filter((tag) => tag.name.toLowerCase().includes(q));
  const exact = tags.some((tag) => tag.name.toLowerCase() === q);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const create = () => {
    const used = new Set(tags.map((tag) => tag.color.toUpperCase()));
    const color = SWATCHES.find((hex) => !used.has(hex)) ?? SWATCHES[tags.length % SWATCHES.length];
    const tag = createTag({ name: query.trim(), color, icon: 'pricetag' });
    onChange([...value, tag.id]);
    setQuery('');
  };
  return (
    <Popover open={open} anchor={anchor} onClose={onClose} align="start" className="tag-pop" width={280} label="Choose tags">
      <label className="input input-search">
        <span className="input-icon"><Icon.search /></span>
        <input
          aria-label="Find or create a tag"
          placeholder="Find or create a tag"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q && !exact) create();
            else if (e.key === 'Enter' && shown.length === 1) toggle(shown[0].id);
          }}
        />
      </label>
      <div className="tag-list">
        {shown.map((tag) => (
          <button key={tag.id} type="button" role="checkbox" aria-checked={value.includes(tag.id)} className="menu-item" onClick={() => toggle(tag.id)}>
            <span className="tag-dot" style={{ '--c': tag.color } as CSSProperties}><TagGlyph name={tag.icon} size={13} /></span>
            <span className="menu-label">{tag.name}</span>
            <span className="menu-check">{value.includes(tag.id) && <Icon.check />}</span>
          </button>
        ))}
        {q && !exact && (
          <button type="button" className="menu-item tag-create" onClick={create}>
            <span className="tag-dot plus"><Icon.add /></span>
            <span className="menu-label">Create “{query.trim()}”</span>
          </button>
        )}
        {!shown.length && !q && <p className="tag-none">No tags yet. Type a name to create one.</p>}
      </div>
      <button type="button" className="menu-item tag-manage" onClick={() => { onClose(); navigate('tags'); }}>
        <span className="menu-label">Manage tags</span>
        <span className="menu-icon"><Icon.chevronForward /></span>
      </button>
    </Popover>
  );
}

/** Chips for the chosen tags plus a button that opens the tag picker. */
export function TagsField({ value, onChange }: { value: string[]; onChange: (tagIds: string[]) => void }) {
  const tags = useTags();
  const pop = useAnchor();
  const chosen = tags.filter((tag) => value.includes(tag.id));
  return (
    <div className="tags-field">
      {chosen.map((tag) => (
        <TagChip key={tag.id} tag={tag} onRemove={() => onChange(value.filter((id) => id !== tag.id))} />
      ))}
      <button type="button" className="chip chip-add" aria-label="Add tag" onClick={(e) => pop.show(e.currentTarget)}>
        <Icon.add />
        <span>{chosen.length ? 'Tag' : 'Add tag'}</span>
      </button>
      <TagPopover open={pop.open} anchor={pop.anchor} onClose={pop.hide} value={value} onChange={onChange} />
    </div>
  );
}
