// Quick capture and search. One field: type what you want to add in plain words, or search
// everything you have saved.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTags } from '../db/hooks';
import { createEvent, createNote, search } from '../db/repo';
import type { SearchHit } from '../db/repo';
import type { Tag } from '../db/types';
import { duration, fmt, HOUR, MIN, relDateTime } from '../lib/dates';
import { KIND_LABEL } from '../lib/events';
import { hostOf } from '../lib/linkmeta';
import { parseQuick } from '../lib/nlp';
import type { Parsed, QuickKind } from '../lib/nlp';
import { navigate } from '../lib/router';
import { getSettings, useSettings } from '../lib/session';
import { PRIORITY } from '../lib/tints';
import { saveLink } from '../modules/Links';
import { resolveTags, taskFromParsed } from '../modules/Tasks';
import { Segmented } from '../ui/controls';
import { Icon, TagGlyph } from '../ui/icons';
import { Sheet, toast } from '../ui/overlay';
import { closeSheet, openSheet } from './sheets';
import type { SheetState } from './sheets';

type Mode = 'auto' | QuickKind;

function createFrom(parsed: Parsed, kind: QuickKind, tags: Tag[], raw: string): void {
  const tagIds = resolveTags(parsed.tagNames, tags);
  const title = parsed.title || raw.trim();
  if (kind === 'link') {
    if (!parsed.url || !saveLink(parsed.url, { note: parsed.title, tagIds })) toast({ message: 'That does not look like a link', tone: 'warning' });
    return;
  }
  if (kind === 'note') {
    const note = createNote({ title, tagIds });
    navigate('notes', note.id);
    return;
  }
  if (kind === 'event') {
    const nextHalfHour = Math.ceil((Date.now() + 5 * MIN) / (30 * MIN)) * 30 * MIN;
    const allDay = parsed.date !== null && !parsed.hasTime;
    const start = parsed.date ?? nextHalfHour;
    const length = parsed.durationMin !== null ? parsed.durationMin * MIN : parsed.eventKind === 'reminder' ? 15 * MIN : HOUR;
    const event = createEvent({
      title, kind: parsed.eventKind, start_at: start, end_at: allDay ? start + 24 * HOUR : start + length, all_day: allDay ? 1 : 0,
      remind_min: parsed.eventKind === 'reminder' ? 0 : getSettings().defaultAlert, tagIds,
    });
    toast({ message: `${KIND_LABEL[parsed.eventKind]} added`, actionLabel: 'Open', onAction: () => openSheet('event', { id: event.id }) });
    return;
  }
  const task = taskFromParsed({ ...parsed, title, tagNames: [] }, tags, { tagIds });
  toast({ message: 'Task added', actionLabel: 'Open', onAction: () => openSheet('task', { id: task.id }) });
}

const HIT_ICON: Record<SearchHit['type'], ReactNode> = {
  task: <Icon.checkCircleOutline />, note: <Icon.noteOutline />, link: <Icon.linkOutline />, event: <Icon.calendarOutline />, tag: <Icon.tagsOutline />,
};
const HIT_TINT: Record<SearchHit['type'], string> = { task: 'orange', note: 'yellow', link: 'blue', event: 'red', tag: 'purple' };
const HIT_LABEL: Record<SearchHit['type'], string> = { task: 'Task', note: 'Note', link: 'Link', event: 'Event', tag: 'Tag' };

function openHit(hit: SearchHit): void {
  if (hit.type === 'task') openSheet('task', { id: hit.id });
  else if (hit.type === 'event') openSheet('event', { id: hit.id });
  else if (hit.type === 'link') openSheet('link', { id: hit.id });
  else if (hit.type === 'note') navigate('notes', hit.id);
  else navigate('tags', hit.id);
}

export function CaptureSheet({ state }: { state: SheetState['capture'] }) {
  const tags = useTags();
  const settings = useSettings();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('auto');
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!state) return;
    setText(state.text ?? '');
    setMode('auto');
    setActive(0);
  }, [state]);

  const parsed = useMemo(() => parseQuick(text), [text]);
  const kind: QuickKind = mode === 'auto' ? parsed.kind : mode;
  const hits = useMemo(() => (text.trim().length >= 2 ? search(text.trim(), 5) : []), [text]);
  const close = () => closeSheet('capture');
  const hasText = !!text.trim();

  // Row 0 is "create"; the rest are search results.
  const rows = hasText ? 1 + hits.length : 0;
  const run = (index: number) => {
    if (!hasText) return;
    close();
    if (index === 0) createFrom(parsed, kind, tags, text);
    else openHit(hits[index - 1]);
  };

  const details: string[] = [];
  if (kind === 'link') details.push(parsed.url ? hostOf(parsed.url) : 'Paste a web address');
  if (kind === 'task' || kind === 'event') {
    if (parsed.date !== null) details.push(relDateTime(parsed.date, parsed.hasTime, settings.time24));
    else details.push(kind === 'event' ? `Today, ${fmt.time(Math.ceil((Date.now() + 5 * MIN) / (30 * MIN)) * 30 * MIN, settings.time24)}` : 'No date');
    if (kind === 'event' && parsed.durationMin) details.push(duration(parsed.durationMin));
    if (kind === 'task' && parsed.priority) details.push(`${PRIORITY[parsed.priority].label} priority`);
  }
  details.push(...parsed.tagNames.map((name) => `#${name}`));
  const kindName = kind === 'event' ? KIND_LABEL[parsed.eventKind].toLowerCase() : kind;

  const starters: { label: string; hint: string; icon: ReactNode; tint: string; run: () => void }[] = [
    { label: 'New task', hint: 'Call Sam tomorrow 3pm #work !high', icon: <Icon.checkCircle />, tint: 'orange', run: () => openSheet('task', { draft: {} }) },
    { label: 'New meeting', hint: 'meeting Design review fri 10am for 45m', icon: <Icon.video />, tint: 'red', run: () => openSheet('event', { draft: { kind: 'meeting' } }) },
    { label: 'New note', hint: 'note Ideas for the offsite', icon: <Icon.note />, tint: 'yellow', run: () => { const note = createNote(); navigate('notes', note.id); } },
    { label: 'Save a link', hint: 'Paste any web address', icon: <Icon.link />, tint: 'blue', run: () => navigate('links') },
  ];

  return (
    <Sheet open={!!state} onClose={close} size="lg" className="capture">
      <div className="capture-field">
        <Icon.search />
        <input
          aria-label="Search or add" placeholder="Search, or type something to add" value={text} data-autofocus enterKeyHint="go"
          onChange={(event) => {
            setText(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (rows) setActive((active + (event.key === 'ArrowDown' ? 1 : rows - 1)) % rows);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(active);
            }
          }}
        />
        {hasText && <button type="button" className="input-action" aria-label="Clear" onClick={() => setText('')}><Icon.closeCircle /></button>}
      </div>

      {hasText ? (
        <>
          <Segmented
            label="Add as" size="sm" full value={mode} onChange={setMode}
            options={[
              { value: 'auto', label: 'Auto' }, { value: 'task', label: 'Task' }, { value: 'event', label: 'Event' },
              { value: 'note', label: 'Note' }, { value: 'link', label: 'Link' },
            ]}
          />
          <div className="capture-list" role="listbox">
            <button type="button" role="option" aria-selected={active === 0} className="capture-row create" data-active={active === 0 || undefined}
              onPointerEnter={() => setActive(0)} onClick={() => run(0)}>
              <span className="capture-icon" data-tint={kind === 'task' ? 'orange' : kind === 'event' ? 'red' : kind === 'note' ? 'yellow' : 'blue'}><Icon.add /></span>
              <span className="capture-text">
                <b className="clamp-1">Add {kindName}: {kind === 'link' ? (parsed.url ?? text) : parsed.title || text.trim()}</b>
                <span className="clamp-1">{details.join(' · ') || 'Press Return to add'}</span>
              </span>
              <kbd>↵</kbd>
            </button>
            {hits.length > 0 && <div className="capture-label">Found</div>}
            {hits.map((hit, index) => (
              <button key={`${hit.type}${hit.id}`} type="button" role="option" aria-selected={active === index + 1} className="capture-row"
                data-active={active === index + 1 || undefined} onPointerEnter={() => setActive(index + 1)} onClick={() => run(index + 1)}>
                <span className="capture-icon" data-tint={HIT_TINT[hit.type]}>
                  {hit.type === 'tag' ? <TagGlyph name={tags.find((tag) => tag.id === hit.id)?.icon ?? 'pricetag'} size={17} /> : HIT_ICON[hit.type]}
                </span>
                <span className="capture-text">
                  <b className="clamp-1">{hit.title || 'Untitled'}</b>
                  <span className="clamp-1">{HIT_LABEL[hit.type]}{hit.detail ? ` · ${hit.detail.replace(/\s+/g, ' ').slice(0, 90)}` : ''}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="capture-list">
          <div className="capture-label">Add something</div>
          {starters.map((starter) => (
            <button key={starter.label} type="button" className="capture-row"
              onClick={() => {
                close();
                starter.run();
              }}>
              <span className="capture-icon" data-tint={starter.tint} style={{ '--on': '#fff' } as CSSProperties}>{starter.icon}</span>
              <span className="capture-text">
                <b>{starter.label}</b>
                <span className="clamp-1">or type: {starter.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
