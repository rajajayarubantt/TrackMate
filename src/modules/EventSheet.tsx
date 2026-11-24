// Create or edit a calendar entry: a meeting, an event or a reminder. New entries can also be
// switched to a task, so everything can be created from the calendar.
import { useEffect, useRef, useState } from 'react';
import { createEvent, deleteEvent, getEvent, insertEvent, setItemTags, updateEvent } from '../db/repo';
import type { CalEvent, EventKind, Repeat } from '../db/types';
import { addDays, atMinutes, dayDiff, HOUR, MIN, minutesOfDay, startOfDay } from '../lib/dates';
import { ALERT_OPTIONS, KIND_COLOR, REPEAT_OPTIONS } from '../lib/events';
import { getSettings } from '../lib/session';
import { closeSheet, openSheet } from '../shell/sheets';
import type { SheetState } from '../shell/sheets';
import { Button, Group, Row, Segmented, Select, Switch, TextArea } from '../ui/controls';
import { Icon } from '../ui/icons';
import { Menu, Sheet, toast, useAnchor } from '../ui/overlay';
import { ColorButton, DateButton, TagsField, TimeButton } from '../ui/pickers';

interface Form {
  title: string;
  kind: EventKind;
  allDay: boolean;
  startDay: number;
  startMin: number;
  endDay: number;
  endMin: number;
  repeat: Repeat;
  repeatUntil: number | null;
  alert: number | null;
  location: string;
  meetingUrl: string;
  attendees: string;
  notes: string;
  color: string;
  tagIds: string[];
}

function toForm(source: Partial<CalEvent>): Form {
  const nextHalfHour = Math.ceil((Date.now() + 5 * MIN) / (30 * MIN)) * 30 * MIN;
  const start = source.start_at ?? nextHalfHour;
  const allDay = !!source.all_day;
  // All-day events are stored up to the following midnight; the form shows the last day itself.
  const end = source.end_at ?? start + HOUR;
  const lastDay = allDay ? startOfDay(end - 1) : startOfDay(end);
  return {
    title: source.title ?? '', kind: source.kind ?? 'meeting', allDay,
    startDay: startOfDay(start), startMin: allDay ? 9 * 60 : minutesOfDay(start),
    endDay: lastDay, endMin: allDay ? 10 * 60 : minutesOfDay(end),
    repeat: source.repeat ?? 'none', repeatUntil: source.repeat_until ? startOfDay(source.repeat_until) : null,
    alert: source.remind_min === undefined ? getSettings().defaultAlert : source.remind_min,
    location: source.location ?? '', meetingUrl: source.meeting_url ?? '', attendees: source.attendees ?? '',
    notes: source.notes ?? '', color: source.color ?? '', tagIds: source.tagIds ?? [],
  };
}

function times(form: Form): { start: number; end: number } {
  if (form.allDay) return { start: form.startDay, end: addDays(Math.max(form.endDay, form.startDay), 1) };
  const start = atMinutes(form.startDay, form.startMin);
  if (form.kind === 'reminder') return { start, end: start + 15 * MIN };
  const end = atMinutes(form.endDay, form.endMin);
  return { start, end: end > start ? end : start + 30 * MIN };
}

export function EventSheet({ state }: { state: SheetState['event'] }) {
  const [form, setForm] = useState<Form>(() => toForm({}));
  const [existing, setExisting] = useState<CalEvent | undefined>();
  const deleteMenu = useAnchor();
  const footRef = useRef<HTMLDivElement>(null);
  const editing = !!state?.id;

  useEffect(() => {
    if (!state) return;
    const event = state.id ? getEvent(state.id) : undefined;
    setExisting(event);
    setForm(toForm(event ?? state.draft ?? {}));
  }, [state]);

  const close = () => closeSheet('event');
  const set = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }));

  // Moving the start keeps the length of the event.
  const setStart = (startDay: number, startMin: number) => {
    const length = atMinutes(form.endDay, form.endMin) - atMinutes(form.startDay, form.startMin);
    const end = atMinutes(startDay, startMin) + Math.max(length, 15 * MIN);
    set({ startDay, startMin, endDay: form.allDay ? addDays(startDay, Math.max(0, dayDiff(form.endDay, form.startDay))) : startOfDay(end), endMin: minutesOfDay(end) });
  };

  const save = () => {
    if (!form.title.trim()) return;
    const { start, end } = times(form);
    const fields = {
      title: form.title.trim(), kind: form.kind, start_at: start, end_at: end, all_day: form.allDay ? 1 : 0,
      location: form.location.trim(), meeting_url: form.meetingUrl.trim(), attendees: form.attendees.trim(), notes: form.notes,
      color: form.color, remind_min: form.alert, repeat: form.repeat,
      repeat_until: form.repeat !== 'none' && form.repeatUntil !== null ? addDays(form.repeatUntil, 1) : null,
    };
    if (existing) {
      // Changing when a repeating event happens makes earlier skipped dates meaningless.
      const moved = existing.start_at !== start || existing.repeat !== form.repeat;
      updateEvent(existing.id, { ...fields, exdates: moved ? [] : undefined });
      setItemTags('event', existing.id, form.tagIds);
      toast('Changes saved');
    } else {
      createEvent({ ...fields, tagIds: form.tagIds });
      toast(form.kind === 'reminder' ? 'Reminder added' : form.kind === 'meeting' ? 'Meeting added' : 'Event added');
    }
    close();
  };

  const removeAll = () => {
    if (!existing) return;
    const snapshot = existing;
    close();
    deleteEvent(snapshot.id);
    toast({ message: 'Deleted', actionLabel: 'Undo', onAction: () => insertEvent(snapshot) });
  };
  const removeOne = () => {
    if (!existing || state?.occurrence === undefined) return;
    updateEvent(existing.id, { exdates: [...existing.exdates, state.occurrence] });
    close();
    toast('This one was removed');
  };

  const switchToTask = () => {
    const { start } = times(form);
    close();
    openSheet('task', { draft: { title: form.title, notes: form.notes, due_at: start, due_has_time: form.allDay ? 0 : 1, tagIds: form.tagIds } });
  };

  const url = form.meetingUrl.trim();
  const joinUrl = url && !/^https?:\/\//i.test(url) ? `https://${url}` : url;
  const people = form.attendees.split(/[,;\n]/).map((name) => name.trim()).filter(Boolean);
  const kindLabel = form.kind === 'meeting' ? 'meeting' : form.kind === 'reminder' ? 'reminder' : 'event';

  return (
    <Sheet open={!!state} onClose={close} title={editing ? `Edit ${kindLabel}` : `New ${kindLabel}`} onConfirm={save}
      confirmDisabled={!form.title.trim()} confirmLabel={editing ? 'Save' : 'Add'}>
      <Segmented
        label="Kind" full value={form.kind}
        onChange={(kind: EventKind | 'task') => (kind === 'task' ? switchToTask() : set({ kind, allDay: kind === 'reminder' ? false : form.allDay }))}
        options={[
          { value: 'meeting', label: 'Meeting' }, { value: 'event', label: 'Event' }, { value: 'reminder', label: 'Reminder' },
          ...(editing ? [] : [{ value: 'task' as const, label: 'Task' }]),
        ]}
      />

      <Group>
        <Row>
          <input className="row-input event-title" aria-label="Title" placeholder="Title" value={form.title}
            data-autofocus={!editing || undefined} onChange={(event) => set({ title: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }} />
          <ColorButton label="Colour" value={form.color || KIND_COLOR[form.kind]} onChange={(color) => set({ color })} />
        </Row>
        {form.kind !== 'reminder' && (
          <Row icon={<Icon.location />}>
            <input className="row-input" aria-label="Location" placeholder="Location" value={form.location} onChange={(event) => set({ location: event.currentTarget.value })} />
          </Row>
        )}
      </Group>

      <Group>
        {form.kind !== 'reminder' && (
          <Row label="All-day" trailing={<Switch label="All-day" checked={form.allDay} onChange={(allDay) => set({ allDay })} />} />
        )}
        <Row label={form.kind === 'reminder' ? 'When' : 'Starts'}>
          <div className="pills">
            <DateButton label="Start date" value={form.startDay} onChange={(day) => day !== null && setStart(day, form.startMin)} />
            {!form.allDay && <TimeButton label="Start time" value={form.startMin} onChange={(minutes) => minutes !== null && setStart(form.startDay, minutes)} />}
          </div>
        </Row>
        {form.kind !== 'reminder' && (
          <Row label="Ends">
            <div className="pills">
              <DateButton label="End date" value={form.endDay} onChange={(day) => day !== null && set({ endDay: Math.max(day, form.startDay) })} />
              {!form.allDay && <TimeButton label="End time" value={form.endMin} onChange={(minutes) => minutes !== null && set({ endMin: minutes })} />}
            </div>
          </Row>
        )}
        <Row icon={<Icon.repeat />} label="Repeat">
          <Select label="Repeat" value={form.repeat} onChange={(repeat) => set({ repeat })} options={REPEAT_OPTIONS} />
        </Row>
        {form.repeat !== 'none' && (
          <Row label="End repeat">
            <div className="pills">
              <DateButton label="End repeat" placeholder="Never" clearable value={form.repeatUntil} onChange={(repeatUntil) => set({ repeatUntil })} />
            </div>
          </Row>
        )}
        <Row icon={<Icon.bellOutline />} label="Alert">
          <Select label="Alert" value={form.alert} onChange={(alert) => set({ alert })} options={ALERT_OPTIONS} />
        </Row>
      </Group>

      {form.kind === 'meeting' && (
        <Group>
          <Row icon={<Icon.videoOutline />}>
            <input className="row-input" aria-label="Meeting link" placeholder="Meeting link" value={form.meetingUrl} inputMode="url" autoCapitalize="none"
              onChange={(event) => set({ meetingUrl: event.currentTarget.value })} />
            {joinUrl && <a className="join" href={joinUrl} target="_blank" rel="noopener noreferrer"><Icon.video />Join</a>}
          </Row>
          <Row icon={<Icon.people />} className={people.length ? 'row-wrap' : ''}>
            <input className="row-input" aria-label="People" placeholder="People, separated by commas" value={form.attendees}
              onChange={(event) => set({ attendees: event.currentTarget.value })} />
            {people.length > 1 && (
              <div className="people">
                {people.map((name, index) => <span key={`${name}${index}`} className="person">{name}</span>)}
              </div>
            )}
          </Row>
        </Group>
      )}

      <Group title="Tags">
        <div className="pad"><TagsField value={form.tagIds} onChange={(tagIds) => set({ tagIds })} /></div>
      </Group>

      <Group title="Notes">
        <div className="pad"><TextArea label="Notes" placeholder="Agenda, details, anything to remember" value={form.notes} onChange={(notes) => set({ notes })} /></div>
      </Group>

      {existing && (
        <div className="sheet-foot" ref={footRef}>
          <Button variant="destructive" full icon={<Icon.trash />}
            onClick={() => {
              if (existing.repeat !== 'none' && state?.occurrence !== undefined) deleteMenu.show(footRef.current);
              else removeAll();
            }}>
            Delete {kindLabel}
          </Button>
          <Menu open={deleteMenu.open} anchor={deleteMenu.anchor} onClose={deleteMenu.hide} align="center" items={[
            { label: 'Delete this one only', onSelect: removeOne },
            { label: 'Delete every occurrence', destructive: true, onSelect: removeAll },
          ]} />
        </div>
      )}
      {existing && existing.repeat !== 'none' && <p className="about">Changes apply to every occurrence.</p>}
    </Sheet>
  );
}
