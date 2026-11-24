// Create or edit a task. Edits to an existing task are saved as you make them.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '../db/hooks';
import { createTask, deleteTask, getTask, insertTask, listStages, moveTask, setItemTags, setTaskDone, updateTask } from '../db/repo';
import type { ChecklistItem, Priority, Task } from '../db/types';
import { addDays, atMinutes, fmt, minutesOfDay, startOfDay } from '../lib/dates';
import { startFocus } from '../lib/focus';
import { uid } from '../lib/id';
import { PRIORITY } from '../lib/tints';
import { closeSheet } from '../shell/sheets';
import type { SheetState } from '../shell/sheets';
import { Button, Check, Group, Row, Segmented, Select, TextArea } from '../ui/controls';
import { Icon } from '../ui/icons';
import { Menu, Sheet, toast, useAnchor } from '../ui/overlay';
import { DateButton, TagsField, TimeButton } from '../ui/pickers';

interface Form {
  title: string;
  notes: string;
  stage_id: string;
  priority: Priority;
  dueDay: number | null;
  dueMin: number | null;
  remindDay: number | null;
  remindMin: number | null;
  tagIds: string[];
  checklist: ChecklistItem[];
}

const split = (at: number | null, hasTime: boolean): [number | null, number | null] =>
  at === null ? [null, null] : [startOfDay(at), hasTime ? minutesOfDay(at) : null];

function toForm(source: Partial<Task>, fallbackStage: string): Form {
  const [dueDay, dueMin] = split(source.due_at ?? null, !!source.due_has_time);
  const [remindDay, remindMin] = split(source.remind_at ?? null, true);
  return {
    title: source.title ?? '', notes: source.notes ?? '', stage_id: source.stage_id ?? fallbackStage,
    priority: source.priority ?? 0, dueDay, dueMin, remindDay, remindMin,
    tagIds: source.tagIds ?? [], checklist: source.checklist ?? [],
  };
}

const dueAt = (form: Form): number | null => (form.dueDay === null ? null : form.dueMin === null ? form.dueDay : atMinutes(form.dueDay, form.dueMin));
const remindAt = (form: Form): number | null => (form.remindDay === null ? null : atMinutes(form.remindDay, form.remindMin ?? 9 * 60));

export function TaskSheet({ state }: { state: SheetState['task'] }) {
  const stages = useQuery(listStages);
  const live = useQuery(() => (state?.id ? getTask(state.id) : undefined), [state?.id]);
  const firstStage = stages.find((stage) => !stage.is_done)?.id ?? stages[0]?.id ?? '';
  const [form, setForm] = useState<Form>(() => toForm({}, firstStage));
  const [newItem, setNewItem] = useState('');
  const focusMenu = useAnchor();
  const editingId = state?.id;
  const formRef = useRef(form);
  formRef.current = form;

  // Load the task (or the draft) each time the sheet opens.
  useEffect(() => {
    if (!state) return;
    setForm(toForm(state.id ? (getTask(state.id) ?? {}) : (state.draft ?? {}), firstStage));
    setNewItem('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const close = () => closeSheet('task');

  const change = (patch: Partial<Form>) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    if (!editingId) return;
    updateTask(editingId, {
      title: next.title.trim() || undefined, notes: next.notes, priority: next.priority,
      due_at: dueAt(next), due_has_time: next.dueDay !== null && next.dueMin !== null ? 1 : 0,
      remind_at: remindAt(next), checklist: next.checklist,
    });
    if (patch.tagIds) setItemTags('task', editingId, next.tagIds);
    if (patch.stage_id) moveTask(editingId, next.stage_id, Number.MAX_SAFE_INTEGER);
  };

  const create = () => {
    if (!form.title.trim()) return;
    createTask({
      title: form.title, notes: form.notes, stage_id: form.stage_id, priority: form.priority,
      due_at: dueAt(form), due_has_time: form.dueDay !== null && form.dueMin !== null ? 1 : 0,
      remind_at: remindAt(form), checklist: form.checklist, tagIds: form.tagIds,
    });
    close();
    toast('Task added');
  };

  const remove = () => {
    if (!live) return;
    const snapshot: Task = live;
    close();
    deleteTask(snapshot.id);
    toast({ message: 'Task deleted', actionLabel: 'Undo', onAction: () => insertTask(snapshot) });
  };

  const addReminder = () => {
    if (form.dueDay !== null) {
      const minutes = form.dueMin === null ? 9 * 60 : Math.max(0, form.dueMin - 60);
      change({ remindDay: form.dueDay, remindMin: minutes });
    } else {
      change({ remindDay: addDays(startOfDay(Date.now()), 1), remindMin: 9 * 60 });
    }
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    change({ checklist: [...form.checklist, { id: uid(8), text: newItem.trim(), done: false }] });
    setNewItem('');
  };
  const setItem = (id: string, patch: Partial<ChecklistItem>) =>
    change({ checklist: form.checklist.map((item) => (item.id === id ? { ...item, ...patch } : item)) });

  const done = !!live?.completed_at;
  const doneItems = form.checklist.filter((item) => item.done).length;

  return (
    <Sheet
      open={!!state} onClose={close} title={editingId ? 'Task' : 'New task'}
      onConfirm={editingId ? close : create} confirmDisabled={!editingId && !form.title.trim()} confirmLabel={editingId ? 'Done' : 'Add task'}
    >
      <div className="task-head card">
        {editingId && (
          <Check checked={done} size={26} label={done ? 'Mark as not done' : 'Mark as done'}
            color={form.priority ? PRIORITY[form.priority].color : undefined}
            onChange={(next) => setTaskDone(editingId, next)} />
        )}
        <div className="task-head-main">
          <TextArea label="Title" placeholder="What needs doing?" minRows={1} className="task-title-input" value={form.title} autoFocus={!editingId}
            onChange={(title) => change({ title: title.replace(/\n/g, ' ') })} />
          <TextArea label="Notes" placeholder="Notes" minRows={1} className="task-notes-input" value={form.notes} onChange={(notes) => change({ notes })} />
        </div>
      </div>

      <Group>
        <Row icon={<Icon.board />} label="Stage">
          <Select label="Stage" value={form.stage_id} onChange={(stage_id) => change({ stage_id })}
            options={stages.map((stage) => ({ value: stage.id, label: stage.name, swatch: stage.color }))} />
        </Row>
        <Row className="row-stack">
          <span className="row-inline"><span className="row-icon"><Icon.flagOutline /></span><span className="row-label">Priority</span></span>
          <Segmented label="Priority" full size="sm" value={form.priority} onChange={(priority) => change({ priority })}
            options={PRIORITY.map((p) => ({ value: p.value as Priority, label: p.label }))} />
        </Row>
      </Group>

      <Group>
        <Row icon={<Icon.calendarOutline />} label="Due">
          <div className="pills">
            <DateButton label="Due date" value={form.dueDay} clearable
              onChange={(dueDay) => change(dueDay === null ? { dueDay: null, dueMin: null } : { dueDay })} />
            {form.dueDay !== null && (
              <TimeButton label="Due time" value={form.dueMin} clearable onChange={(dueMin) => change({ dueMin })} />
            )}
          </div>
        </Row>
        <Row icon={<Icon.bellOutline />} label="Remind me">
          <div className="pills">
            {form.remindDay === null ? (
              <button type="button" className="pill" onClick={addReminder}>Add reminder</button>
            ) : (
              <>
                <DateButton label="Reminder date" value={form.remindDay} clearable
                  onChange={(remindDay) => change(remindDay === null ? { remindDay: null, remindMin: null } : { remindDay })} />
                <TimeButton label="Reminder time" value={form.remindMin ?? 9 * 60} onChange={(remindMin) => change({ remindMin: remindMin ?? 9 * 60 })} />
              </>
            )}
          </div>
        </Row>
      </Group>

      <Group title="Tags">
        <div className="pad"><TagsField value={form.tagIds} onChange={(tagIds) => change({ tagIds })} /></div>
      </Group>

      <Group title={form.checklist.length ? `Checklist · ${doneItems}/${form.checklist.length}` : 'Checklist'}>
        {form.checklist.map((item) => (
          <div key={item.id} className="row check-item">
            <Check size={22} checked={item.done} label={item.text} onChange={(next) => setItem(item.id, { done: next })} />
            <input aria-label="Checklist item" value={item.text} data-done={item.done || undefined}
              onChange={(event) => setItem(item.id, { text: event.currentTarget.value })} />
            <button type="button" className="check-remove" aria-label={`Remove “${item.text}”`}
              onClick={() => change({ checklist: form.checklist.filter((other) => other.id !== item.id) })}>
              <Icon.close />
            </button>
          </div>
        ))}
        <div className="row check-item">
          <span className="check-plus"><Icon.add /></span>
          <input aria-label="Add checklist item" placeholder="Add item" value={newItem} enterKeyHint="done"
            onChange={(event) => setNewItem(event.currentTarget.value)}
            onBlur={addItem}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addItem();
            }} />
        </div>
      </Group>

      {editingId && live && (
        <>
          <Group>
            <Row icon={<Icon.timer />} label="Start a focus session"
              detail={live.focus_minutes ? `${live.focus_minutes} min focused so far` : 'A timer that logs time against this task'}
              onClick={(target) => focusMenu.show(target)} chevron />
          </Group>
          <Menu open={focusMenu.open} anchor={focusMenu.anchor} onClose={focusMenu.hide} align="start"
            items={[15, 25, 50].map((minutes) => ({
              label: `${minutes} minutes`,
              onSelect: () => {
                startFocus(live.id, live.title, minutes);
                close();
              },
            }))} />
          <div className="sheet-foot">
            <Button variant="destructive" full icon={<Icon.trash />} onClick={remove}>Delete task</Button>
          </div>
          <p className="about">Created {fmt.monthDayYear(live.created_at)}</p>
        </>
      )}
    </Sheet>
  );
}
