// Tasks: a grouped list, and a board whose cards can be dragged between stages (mouse and touch).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode, TouchEvent as ReactTouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useTagMap, useTags } from '../db/hooks';
import {
  createStage, createTag, createTask, deleteStage, listStages, listTasks, moveTask, reorderStages, setStageDone, updateStage,
} from '../db/repo';
import type { Stage, Tag, Task } from '../db/types';
import { addDays, relDateTime, startOfDay } from '../lib/dates';
import { parseQuick } from '../lib/nlp';
import type { Parsed } from '../lib/nlp';
import { updateSettings, useSettings } from '../lib/session';
import { PRIORITY, SWATCHES } from '../lib/tints';
import { Screen } from '../shell/Screen';
import { openSheet } from '../shell/sheets';
import { EmptyState, Group, IconButton, Row, Segmented, Switch } from '../ui/controls';
import { Icon } from '../ui/icons';
import { confirm, Menu, Sheet, toast, useAnchor } from '../ui/overlay';
import type { MenuEntry } from '../ui/overlay';
import { ColorPicker, TagChip } from '../ui/pickers';
import { dueInfo, TaskRow } from './rows';

/** Match #tags to existing tags by name, creating any that do not exist yet. */
export function resolveTags(names: string[], tags: Tag[]): string[] {
  const known = [...tags];
  return names.map((name) => {
    let tag = known.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!tag) {
      const used = new Set(known.map((item) => item.color.toUpperCase()));
      const color = SWATCHES.find((hex) => !used.has(hex)) ?? SWATCHES[known.length % SWATCHES.length];
      tag = createTag({ name: name.charAt(0).toUpperCase() + name.slice(1), color, icon: 'pricetag' });
      known.push(tag);
    }
    return tag.id;
  });
}

/** Create a task from a parsed quick-add line. */
export function taskFromParsed(parsed: Parsed, tags: Tag[], extra: Partial<Task> = {}): Task {
  const tagIds = resolveTags(parsed.tagNames, tags);
  return createTask({
    title: parsed.title || 'New task', priority: parsed.priority, due_at: parsed.date, due_has_time: parsed.hasTime ? 1 : 0,
    ...extra, tagIds: [...new Set([...(extra.tagIds ?? []), ...tagIds])],
  });
}

/** The little line under a quick-add field that shows what was understood. */
export function ParsedHint({ parsed, h24 }: { parsed: Parsed; h24: boolean }) {
  const parts: string[] = [];
  if (parsed.date !== null) parts.push(relDateTime(parsed.date, parsed.hasTime, h24));
  if (parsed.durationMin) parts.push(`${parsed.durationMin} min`);
  if (parsed.priority) parts.push(`${PRIORITY[parsed.priority].label} priority`);
  parts.push(...parsed.tagNames.map((name) => `#${name}`));
  if (!parts.length) return null;
  return (
    <div className="parsed-hint">
      <Icon.sparkles />
      {parts.join(' · ')}
    </div>
  );
}

function QuickAdd({ tags, h24 }: { tags: Tag[]; h24: boolean }) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseQuick(text), [text]);
  const add = () => {
    if (!text.trim()) return;
    taskFromParsed({ ...parsed, title: parsed.title || text.trim() }, tags);
    setText('');
  };
  return (
    <div className="quick-add card">
      <div className="quick-add-row">
        <span className="quick-add-plus"><Icon.add /></span>
        <input
          aria-label="New task" placeholder="New task — try “Call Sam tomorrow 3pm #work !high”" value={text} enterKeyHint="done"
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        {text.trim() && (
          <button type="button" className="paste-go" aria-label="Add task" onClick={add}><Icon.up /></button>
        )}
      </div>
      {text.trim() && <ParsedHint parsed={parsed} h24={h24} />}
    </div>
  );
}

// ── List ───────────────────────────────────────────────────────────────────────────────────────

function TaskList({ tasks, stages, tags, h24 }: { tasks: Task[]; stages: Map<string, Stage>; tags: Map<string, Tag>; h24: boolean }) {
  const [showDone, setShowDone] = useState(false);
  const sections = useMemo(() => {
    const today = startOfDay(Date.now());
    const groups: { key: string; title: string; tone?: string; items: Task[] }[] = [
      { key: 'overdue', title: 'Overdue', tone: 'red', items: [] },
      { key: 'today', title: 'Today', items: [] },
      { key: 'tomorrow', title: 'Tomorrow', items: [] },
      { key: 'week', title: 'Next 7 days', items: [] },
      { key: 'later', title: 'Later', items: [] },
      { key: 'none', title: 'No date', items: [] },
    ];
    const done: Task[] = [];
    for (const task of tasks) {
      if (task.completed_at !== null) done.push(task);
      else if (task.due_at === null) groups[5].items.push(task);
      else {
        const day = startOfDay(task.due_at);
        if (day < today) groups[0].items.push(task);
        else if (day === today) groups[1].items.push(task);
        else if (day === addDays(today, 1)) groups[2].items.push(task);
        else if (day < addDays(today, 8)) groups[3].items.push(task);
        else groups[4].items.push(task);
      }
    }
    const byDue = (a: Task, b: Task) => (a.due_at ?? 0) - (b.due_at ?? 0) || b.priority - a.priority;
    groups.forEach((group) => group.items.sort(group.key === 'none' ? (a, b) => b.priority - a.priority || b.created_at - a.created_at : byDue));
    done.sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0));
    return { groups: groups.filter((group) => group.items.length), done };
  }, [tasks]);

  if (!tasks.length) {
    return <EmptyState icon={<Icon.checkCircle />} title="Nothing to do yet" text="Add your first task above. Dates, #tags and !priority in the text are picked up automatically." />;
  }
  return (
    <>
      {sections.groups.map((group) => (
        <Group key={group.key} title={`${group.title} · ${group.items.length}`} className={group.tone === 'red' ? 'group-red' : ''}>
          {group.items.map((task) => <TaskRow key={task.id} task={task} tags={tags} h24={h24} stage={stages.get(task.stage_id)} />)}
        </Group>
      ))}
      {!sections.groups.length && <EmptyState icon={<Icon.checkCircle />} title="All done" text="Every task is ticked off. Enjoy it." />}
      {sections.done.length > 0 && (
        <section className="group-wrap">
          <button type="button" className="done-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <Icon.chevronForward />
            Completed · {sections.done.length}
          </button>
          {showDone && (
            <div className="group">
              {sections.done.map((task) => <TaskRow key={task.id} task={task} tags={tags} h24={h24} />)}
            </div>
          )}
        </section>
      )}
    </>
  );
}

// ── Board ──────────────────────────────────────────────────────────────────────────────────────

function BoardCard({ task, tags, h24, isDone }: { task: Task; tags: Map<string, Tag>; h24: boolean; isDone: boolean }) {
  const due = dueInfo(task, h24);
  const checked = task.checklist.filter((item) => item.done).length;
  return (
    <>
      <div className="bcard-title" data-done={isDone || undefined}>
        {task.priority > 0 && <Icon.flag className="bcard-flag" style={{ color: PRIORITY[task.priority].color }} />}
        {task.title}
      </div>
      {(due || task.checklist.length > 0 || task.focus_minutes > 0 || task.remind_at !== null) && (
        <div className="item-meta">
          {due && <span className="meta" data-overdue={due.overdue || undefined}><Icon.calendarOutline />{due.label}</span>}
          {task.checklist.length > 0 && <span className="meta"><Icon.checkboxOutline />{checked}/{task.checklist.length}</span>}
          {task.remind_at !== null && !isDone && <span className="meta"><Icon.bellOutline /></span>}
          {task.focus_minutes > 0 && <span className="meta"><Icon.timer />{task.focus_minutes}m</span>}
        </div>
      )}
      {task.tagIds.length > 0 && (
        <div className="chips bcard-tags">
          {task.tagIds.map((id) => {
            const tag = tags.get(id);
            return tag ? <TagChip key={id} tag={tag} size="sm" /> : null;
          })}
        </div>
      )}
    </>
  );
}

interface DragState {
  id: string;
  overStage: string;
  overIndex: number;
  width: number;
  height: number;
}

function Board({ tasks, stages, tags, h24 }: { tasks: Task[]; stages: Stage[]; tags: Map<string, Tag>; h24: boolean }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [editing, setEditing] = useState<Stage | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newStage, setNewStage] = useState<string | null>(null);
  // Mutable drag bookkeeping that must not wait for a render.
  const live = useRef<{
    pending: { id: string; x: number; y: number; el: HTMLElement } | null;
    active: boolean; offsetX: number; offsetY: number; x: number; y: number; timer: number; raf: number; suppressClick: boolean;
  }>({ pending: null, active: false, offsetX: 0, offsetY: 0, x: 0, y: 0, timer: 0, raf: 0, suppressClick: false });
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const byStage = useMemo(() => {
    const map = new Map<string, Task[]>(stages.map((stage) => [stage.id, []]));
    for (const task of tasks) map.get(task.stage_id)?.push(task);
    return map;
  }, [tasks, stages]);

  /** Work out which column and position the pointer is over. */
  const locate = (x: number, y: number): { stage: string; index: number } | null => {
    const board = boardRef.current;
    if (!board) return null;
    const columns = [...board.querySelectorAll<HTMLElement>('[data-stage]')];
    if (!columns.length) return null;
    let column = columns[0];
    let best = Infinity;
    for (const el of columns) {
      const rect = el.getBoundingClientRect();
      const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      if (distance < best) {
        best = distance;
        column = el;
      }
    }
    const cards = [...column.querySelectorAll<HTMLElement>('[data-card]:not([data-dragging])')];
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    return { stage: column.dataset.stage as string, index };
  };

  const placeGhost = () => {
    const ghost = ghostRef.current;
    const state = live.current;
    if (ghost) ghost.style.transform = `translate(${state.x - state.offsetX}px, ${state.y - state.offsetY}px) rotate(2.5deg) scale(1.04)`;
  };

  const begin = () => {
    const state = live.current;
    const pending = state.pending;
    if (!pending) return;
    const rect = pending.el.getBoundingClientRect();
    state.active = true;
    state.offsetX = pending.x - rect.left;
    state.offsetY = pending.y - rect.top;
    state.x = pending.x;
    state.y = pending.y;
    const task = tasks.find((t) => t.id === pending.id);
    if (!task) return;
    const index = (byStage.get(task.stage_id) ?? []).findIndex((t) => t.id === task.id);
    setDrag({ id: task.id, overStage: task.stage_id, overIndex: Math.max(0, index), width: rect.width, height: rect.height });
    document.body.classList.add('dragging');
    navigator.vibrate?.(8);
    // Scroll the board (and the column under the pointer) when dragging near an edge.
    const tick = () => {
      const board = boardRef.current;
      if (!state.active || !board) return;
      const bounds = board.getBoundingClientRect();
      const edge = 56;
      if (state.x < bounds.left + edge) board.scrollLeft -= 9;
      else if (state.x > bounds.right - edge) board.scrollLeft += 9;
      const over = dragRef.current && board.querySelector<HTMLElement>(`[data-stage="${dragRef.current.overStage}"] .col-cards`);
      if (over) {
        const rect = over.getBoundingClientRect();
        if (state.y < rect.top + 40) over.scrollTop -= 10;
        else if (state.y > rect.bottom - 40) over.scrollTop += 10;
      }
      const at = locate(state.x, state.y);
      const current = dragRef.current;
      if (at && current && (at.stage !== current.overStage || at.index !== current.overIndex)) {
        setDrag({ ...current, overStage: at.stage, overIndex: at.index });
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  };

  const move = (x: number, y: number) => {
    const state = live.current;
    state.x = x;
    state.y = y;
    placeGhost();
  };

  const finish = (commit: boolean) => {
    const state = live.current;
    clearTimeout(state.timer);
    cancelAnimationFrame(state.raf);
    const current = dragRef.current;
    if (state.active) {
      state.suppressClick = true;
      window.setTimeout(() => (state.suppressClick = false), 60);
      if (commit && current) moveTask(current.id, current.overStage, current.overIndex);
    }
    state.active = false;
    state.pending = null;
    document.body.classList.remove('dragging');
    setDrag(null);
  };

  // Mouse and pen: start dragging after a few pixels of movement.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    const state = live.current;
    state.pending = { id, x: event.clientX, y: event.clientY, el: event.currentTarget };
    const onMove = (e: PointerEvent) => {
      if (!state.active && state.pending && Math.hypot(e.clientX - state.pending.x, e.clientY - state.pending.y) > 5) begin();
      if (state.active) {
        e.preventDefault();
        move(e.clientX, e.clientY);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      finish(true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Touch: press and hold to pick a card up, so ordinary scrolling still works.
  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>, id: string) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    const state = live.current;
    state.pending = { id, x: touch.clientX, y: touch.clientY, el: event.currentTarget };
    clearTimeout(state.timer);
    state.timer = window.setTimeout(begin, 260);
  };

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const state = live.current;
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (state.active) {
        event.preventDefault(); // keep the page from scrolling while a card is held
        move(touch.clientX, touch.clientY);
      } else if (state.pending && Math.hypot(touch.clientX - state.pending.x, touch.clientY - state.pending.y) > 10) {
        clearTimeout(state.timer); // it was a scroll, not a press-and-hold
        state.pending = null;
      }
    };
    const onTouchEnd = () => {
      if (state.active) finish(true);
      else {
        clearTimeout(state.timer);
        state.pending = null;
      }
    };
    board.addEventListener('touchmove', onTouchMove, { passive: false });
    board.addEventListener('touchend', onTouchEnd);
    board.addEventListener('touchcancel', onTouchEnd);
    return () => {
      board.removeEventListener('touchmove', onTouchMove);
      board.removeEventListener('touchend', onTouchEnd);
      board.removeEventListener('touchcancel', onTouchEnd);
      cancelAnimationFrame(state.raf);
      clearTimeout(state.timer);
      document.body.classList.remove('dragging');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (drag) placeGhost();
  });

  const dragged = drag ? tasks.find((task) => task.id === drag.id) : undefined;

  const stageMenu = (stage: Stage, index: number): MenuEntry[] => [
    { label: 'Edit stage', icon: <Icon.edit />, onSelect: () => setEditing(stage) },
    { label: 'Add task', icon: <Icon.add />, onSelect: () => setAddingTo(stage.id) },
    { separator: true },
    {
      label: 'Move left', icon: <Icon.back />, disabled: index === 0,
      onSelect: () => {
        const ids = stages.map((s) => s.id);
        [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
        reorderStages(ids);
      },
    },
    {
      label: 'Move right', icon: <Icon.forward />, disabled: index === stages.length - 1,
      onSelect: () => {
        const ids = stages.map((s) => s.id);
        [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
        reorderStages(ids);
      },
    },
    { separator: true },
    { label: 'Delete stage', icon: <Icon.trash />, destructive: true, disabled: stages.length < 2, onSelect: () => void removeStage(stage, stages, byStage.get(stage.id)?.length ?? 0) },
  ];

  return (
    <div className="board no-bar" ref={boardRef} data-dragging={drag ? true : undefined}>
      {stages.map((stage, stageIndex) => {
        const all = byStage.get(stage.id) ?? [];
        const over = drag?.overStage === stage.id;
        const overLimit = stage.wip_limit > 0 && all.length > stage.wip_limit;
        // The card being dragged stays in the page (hidden) so its touch events keep arriving.
        const visibleCount = all.filter((task) => task.id !== drag?.id).length;
        let slot = 0;
        return (
          <section key={stage.id} className="col glass" data-stage={stage.id} data-over={over || undefined} aria-label={stage.name}>
            <ColumnHead stage={stage} count={all.length} overLimit={overLimit} menu={stageMenu(stage, stageIndex)} onAdd={() => setAddingTo(stage.id)} />
            <div className="col-cards">
              {all.map((task) => {
                const held = drag?.id === task.id;
                const index = held ? -1 : slot++;
                return (
                  <CardSlot key={task.id} placeholder={over && drag && drag.overIndex === index ? drag.height : 0}>
                    <div
                      className="bcard" data-card={task.id} data-dragging={held || undefined} role="button" tabIndex={0}
                      onPointerDown={(event) => onPointerDown(event, task.id)}
                      onTouchStart={(event) => onTouchStart(event, task.id)}
                      onContextMenu={(event) => event.preventDefault()}
                      onClick={() => {
                        if (!live.current.suppressClick) openSheet('task', { id: task.id });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') openSheet('task', { id: task.id });
                      }}
                    >
                      <BoardCard task={task} tags={tags} h24={h24} isDone={!!stage.is_done} />
                    </div>
                  </CardSlot>
                );
              })}
              {over && drag && drag.overIndex >= visibleCount && <div className="bcard-placeholder" style={{ height: drag.height }} />}
              {addingTo === stage.id && <InlineAdd placeholder="Task title" onDone={() => setAddingTo(null)} onAdd={(title) => createTask({ title, stage_id: stage.id })} />}
              {!visibleCount && !over && addingTo !== stage.id && <div className="col-empty">No tasks</div>}
            </div>
            {addingTo !== stage.id && (
              <button type="button" className="col-add" onClick={() => setAddingTo(stage.id)}>
                <Icon.add />
                Add task
              </button>
            )}
          </section>
        );
      })}
      <section className="col col-new">
        {newStage === null ? (
          <button type="button" className="col-new-btn" onClick={() => setNewStage('')}>
            <Icon.add />
            Add stage
          </button>
        ) : (
          <InlineAdd
            placeholder="Stage name" onDone={() => setNewStage(null)} single
            onAdd={(name) => {
              const used = new Set(stages.map((stage) => stage.color.toUpperCase()));
              createStage(name, SWATCHES.find((hex) => !used.has(hex)) ?? SWATCHES[stages.length % SWATCHES.length]);
            }}
          />
        )}
      </section>
      {drag && dragged && createPortal(
        <div ref={ghostRef} className="bcard bcard-ghost" style={{ width: drag.width }}>
          <BoardCard task={dragged} tags={tags} h24={h24} isDone={false} />
        </div>,
        document.getElementById('overlays') as HTMLElement,
      )}
      <StageSheet stage={editing} stages={stages} onClose={() => setEditing(null)} />
    </div>
  );
}

function CardSlot({ placeholder, children }: { placeholder: number; children: ReactNode }) {
  return (
    <>
      {placeholder > 0 && <div className="bcard-placeholder" style={{ height: placeholder }} />}
      {children}
    </>
  );
}

function ColumnHead({ stage, count, overLimit, menu, onAdd }: { stage: Stage; count: number; overLimit: boolean; menu: MenuEntry[]; onAdd: () => void }) {
  const anchor = useAnchor();
  return (
    <header className="col-head">
      <i className="dot" style={{ background: stage.color }} />
      <h3 className="clamp-1">{stage.name}</h3>
      <span className="col-count round" data-over={overLimit || undefined}>
        {count}{stage.wip_limit > 0 ? `/${stage.wip_limit}` : ''}
      </span>
      {stage.is_done ? <Icon.checkCircle className="col-done" aria-label="Tasks here are done" /> : null}
      <button type="button" className="col-btn" aria-label={`Add task to ${stage.name}`} onClick={onAdd}><Icon.add /></button>
      <button type="button" className="col-btn" aria-label={`Options for ${stage.name}`} onClick={(event) => anchor.show(event.currentTarget)}><Icon.more /></button>
      <Menu open={anchor.open} anchor={anchor.anchor} onClose={anchor.hide} items={menu} />
    </header>
  );
}

function InlineAdd({ placeholder, onAdd, onDone, single }: { placeholder: string; onAdd: (text: string) => void; onDone: () => void; single?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = () => {
    if (text.trim()) onAdd(text.trim());
    setText('');
    if (single || !text.trim()) onDone();
  };
  return (
    <div className="inline-add">
      <input
        ref={ref} aria-label={placeholder} placeholder={placeholder} value={text} enterKeyHint="done"
        onChange={(event) => setText(event.currentTarget.value)}
        onBlur={() => {
          if (text.trim()) onAdd(text.trim());
          onDone();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          else if (event.key === 'Escape') {
            event.stopPropagation();
            setText('');
            onDone();
          }
        }}
      />
    </div>
  );
}

async function removeStage(stage: Stage, stages: Stage[], count: number): Promise<void> {
  const target = stages.find((s) => s.id !== stage.id);
  if (!target) return;
  const ok = await confirm({
    title: `Delete “${stage.name}”?`,
    message: count ? `Its ${count} task${count === 1 ? '' : 's'} will move to “${target.name}”.` : 'This stage has no tasks.',
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (ok) {
    deleteStage(stage.id, target.id);
    toast('Stage deleted');
  }
}

function StageSheet({ stage, stages, onClose }: { stage: Stage | null; stages: Stage[]; onClose: () => void }) {
  const [last, setLast] = useState(stage);
  useEffect(() => {
    if (stage) setLast(stage);
  }, [stage]);
  const current = stages.find((s) => s.id === (stage ?? last)?.id);
  if (!current) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  return (
    <Sheet open={!!stage} onClose={onClose} title="Edit stage" onConfirm={onClose}>
      <Group>
        <Row>
          <i className="dot" style={{ background: current.color, width: 12, height: 12 }} />
          <input aria-label="Stage name" className="row-input" value={current.name} placeholder="Stage name"
            onChange={(event) => updateStage(current.id, { name: event.currentTarget.value })} />
        </Row>
      </Group>
      <Group title="Colour">
        <div className="pad"><ColorPicker value={current.color} onChange={(color) => updateStage(current.id, { color })} /></div>
      </Group>
      <Group footer="Tasks moved into a done stage are ticked off. A limit shows a warning when a stage holds too many tasks at once.">
        <Row label="Tasks here are done" trailing={<Switch label="Tasks here are done" checked={!!current.is_done} onChange={(on) => setStageDone(current.id, on)} />} />
        <Row label="Limit" detail={current.wip_limit ? `Warn above ${current.wip_limit} tasks` : 'No limit'}
          trailing={
            <div className="stepper">
              <button type="button" aria-label="Lower limit" disabled={current.wip_limit === 0} onClick={() => updateStage(current.id, { wip_limit: Math.max(0, current.wip_limit - 1) })}><Icon.minus /></button>
              <span className="round">{current.wip_limit || '–'}</span>
              <button type="button" aria-label="Raise limit" onClick={() => updateStage(current.id, { wip_limit: current.wip_limit + 1 })}><Icon.add /></button>
            </div>
          }
        />
      </Group>
    </Sheet>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────────────────────

export function TasksScreen() {
  const settings = useSettings();
  const stages = useQuery(listStages);
  const allTasks = useQuery(listTasks);
  const tags = useTags();
  const tagMap = useTagMap();
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const board = settings.taskView === 'board';
  const tasks = useMemo(() => (tagFilter ? allTasks.filter((task) => task.tagIds.includes(tagFilter)) : allTasks), [allTasks, tagFilter]);
  const stageMap = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const usedTags = useMemo(() => tags.filter((tag) => allTasks.some((task) => task.tagIds.includes(tag.id))), [tags, allTasks]);
  const open = allTasks.filter((task) => task.completed_at === null).length;

  const toolbar = (
    <div className="filter-bar">
      <Segmented
        label="View" size="sm" value={settings.taskView} onChange={(taskView) => updateSettings({ taskView })}
        options={[{ value: 'list', label: 'List', icon: <Icon.list /> }, { value: 'board', label: 'Board', icon: <Icon.board /> }]}
      />
      <div className="chips-scroll no-bar">
        {usedTags.map((tag) => (
          <TagChip key={tag.id} tag={tag} active={tagFilter === tag.id} onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)} />
        ))}
      </div>
    </div>
  );
  const actions = (
    <IconButton variant="glass" icon={<Icon.add />} label="New task" onClick={() => openSheet('task', { draft: tagFilter ? { tagIds: [tagFilter] } : {} })} />
  );

  if (board) {
    return (
      <Screen title="Tasks" fill actions={actions}>
        <div className="board-toolbar">{toolbar}</div>
        <Board tasks={tasks} stages={stages} tags={tagMap} h24={settings.time24} />
      </Screen>
    );
  }
  return (
    <Screen title="Tasks" eyebrow={allTasks.length ? `${open} open · ${allTasks.length - open} done` : undefined} actions={actions}>
      {toolbar}
      <QuickAdd tags={tags} h24={settings.time24} />
      <TaskList tasks={tasks} stages={stageMap} tags={tagMap} h24={settings.time24} />
    </Screen>
  );
}
