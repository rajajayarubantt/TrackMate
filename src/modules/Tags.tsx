// Tag Manager: create tags with an icon and colour, and see everything filed under a tag.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useQuery, useTagMap, useTags } from '../db/hooks';
import { createTag, deleteTag, listEvents, listLinks, listNotes, listStages, listTasks, tagCounts, updateTag } from '../db/repo';
import type { ItemType, Occurrence, Tag } from '../db/types';
import { nextOccurrence } from '../lib/events';
import { navigate } from '../lib/router';
import { useSettings } from '../lib/session';
import { SWATCHES } from '../lib/tints';
import { Screen } from '../shell/Screen';
import { closeSheet, openSheet } from '../shell/sheets';
import type { SheetState } from '../shell/sheets';
import { Button, EmptyState, Group, IconButton, Segmented } from '../ui/controls';
import { Icon, TagGlyph } from '../ui/icons';
import { confirm, Menu, Sheet, toast, useAnchor } from '../ui/overlay';
import { ColorPicker, IconPicker, TagChip } from '../ui/pickers';
import { EventRow, LinkRow, NoteRow, TaskRow } from './rows';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

async function removeTag(tag: Tag): Promise<boolean> {
  const ok = await confirm({
    title: `Delete “${tag.name}”?`,
    message: 'The tag is removed from everything that uses it. The items themselves are kept.',
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (ok) {
    deleteTag(tag.id);
    toast('Tag deleted');
  }
  return ok;
}

function TagCard({ tag, total, summary }: { tag: Tag; total: number; summary: string }) {
  const menu = useAnchor();
  return (
    <div className="tag-card card" role="button" tabIndex={0} style={{ '--c': tag.color } as CSSProperties}
      onClick={() => navigate('tags', tag.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) navigate('tags', tag.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        menu.show({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="tag-card-top">
        <span className="tag-tile" style={{ '--s': '44px' } as CSSProperties}><TagGlyph name={tag.icon} size={22} /></span>
        <span className="tag-card-count round">{total}</span>
      </div>
      <div className="tag-card-name clamp-1">{tag.name}</div>
      <div className="tag-card-sub clamp-1">{summary}</div>
      <button type="button" className="tag-card-more" aria-label={`Options for ${tag.name}`}
        onClick={(event) => {
          event.stopPropagation();
          menu.show(event.currentTarget);
        }}>
        <Icon.more />
      </button>
      <Menu open={menu.open} anchor={menu.anchor} onClose={menu.hide} items={[
        { label: 'Edit tag', icon: <Icon.edit />, onSelect: () => openSheet('tag', { id: tag.id }) },
        { separator: true },
        { label: 'Delete tag', icon: <Icon.trash />, destructive: true, onSelect: () => void removeTag(tag) },
      ]} />
    </div>
  );
}

function TagList() {
  const tags = useTags();
  const counts = useQuery(tagCounts);
  return (
    <Screen
      title="Tags"
      eyebrow={tags.length ? `${plural(tags.length, 'tag')} across all your apps` : undefined}
      actions={<IconButton variant="glass" icon={<Icon.add />} label="New tag" onClick={() => openSheet('tag', {})} />}
    >
      {tags.length === 0 ? (
        <EmptyState icon={<Icon.tags />} title="No tags yet"
          text="Tags group links, tasks, notes and events together. Give each one a colour and an icon."
          action={<Button icon={<Icon.add />} onClick={() => openSheet('tag', {})}>New tag</Button>} />
      ) : (
        <div className="tag-grid">
          {tags.map((tag) => {
            const c = counts[tag.id] ?? { link: 0, task: 0, note: 0, event: 0 };
            const parts = [
              c.link && plural(c.link, 'link'), c.task && plural(c.task, 'task'),
              c.note && plural(c.note, 'note'), c.event && plural(c.event, 'event'),
            ].filter(Boolean);
            return <TagCard key={tag.id} tag={tag} total={c.link + c.task + c.note + c.event} summary={parts.join(' · ') || 'Not used yet'} />;
          })}
          <button type="button" className="tag-card tag-card-new" onClick={() => openSheet('tag', {})}>
            <Icon.add />
            <span>New tag</span>
          </button>
        </div>
      )}
    </Screen>
  );
}

/** Everything filed under one tag, across every app. */
function TagHub({ tagId }: { tagId: string }) {
  const tags = useTagMap();
  const tag = tags.get(tagId);
  const settings = useSettings();
  const [filter, setFilter] = useState<'all' | ItemType>('all');
  const data = useQuery(() => {
    const has = (item: { tagIds: string[] }) => item.tagIds.includes(tagId);
    const now = Date.now();
    const occurrences = listEvents().filter(has)
      .map((event): Occurrence => nextOccurrence(event, now) ?? { event, start: event.start_at, end: event.end_at })
      .sort((a, b) => a.start - b.start);
    return {
      links: listLinks().filter(has),
      tasks: listTasks().filter(has).sort((a, b) => Number(a.completed_at !== null) - Number(b.completed_at !== null)),
      notes: listNotes().filter(has),
      occurrences,
      stages: new Map(listStages().map((stage) => [stage.id, stage])),
    };
  }, [tagId]);

  useEffect(() => {
    if (!tag) navigate('tags', undefined, true);
  }, [tag]);
  if (!tag) return null;

  const total = data.links.length + data.tasks.length + data.notes.length + data.occurrences.length;
  const show = (type: ItemType) => filter === 'all' || filter === type;
  return (
    <Screen
      title={tag.name}
      leading={
        <button type="button" className="back-btn glass" onClick={() => navigate('tags')}>
          <Icon.chevronBack />
          Tags
        </button>
      }
      actions={<IconButton variant="glass" icon={<Icon.edit />} label="Edit tag" onClick={() => openSheet('tag', { id: tag.id })} />}
      eyebrow={
        <span className="hub-eyebrow" style={{ '--c': tag.color } as CSSProperties}>
          <span className="tag-tile" style={{ '--s': '26px' } as CSSProperties}><TagGlyph name={tag.icon} size={14} /></span>
          {plural(total, 'item')}
        </span>
      }
    >
      <div className="filter-bar">
        <Segmented
          label="Show" value={filter} onChange={setFilter} full
          options={[
            { value: 'all', label: 'All' }, { value: 'link', label: 'Links' }, { value: 'task', label: 'Tasks' },
            { value: 'note', label: 'Notes' }, { value: 'event', label: 'Events' },
          ]}
        />
      </div>
      {total === 0 && (
        <EmptyState icon={<TagGlyph name={tag.icon} size={32} />} title="Nothing here yet"
          text={`Add the “${tag.name}” tag to a link, task, note or event and it will show up here.`} />
      )}
      {show('task') && data.tasks.length > 0 && (
        <Group title="Tasks">
          {data.tasks.map((task) => <TaskRow key={task.id} task={task} tags={tags} h24={settings.time24} stage={data.stages.get(task.stage_id)} />)}
        </Group>
      )}
      {show('event') && data.occurrences.length > 0 && (
        <Group title="Events">
          {data.occurrences.map((occ) => <EventRow key={occ.event.id} occ={occ} tags={tags} h24={settings.time24} showDay />)}
        </Group>
      )}
      {show('link') && data.links.length > 0 && (
        <Group title="Links">
          {data.links.map((link) => <LinkRow key={link.id} link={link} />)}
        </Group>
      )}
      {show('note') && data.notes.length > 0 && (
        <Group title="Notes">
          {data.notes.map((note) => <NoteRow key={note.id} note={note} />)}
        </Group>
      )}
    </Screen>
  );
}

export function TagsScreen({ tagId }: { tagId?: string }) {
  return tagId ? <TagHub key={tagId} tagId={tagId} /> : <TagList />;
}

// ── Create / edit ──────────────────────────────────────────────────────────────────────────────

export function TagSheet({ state }: { state: SheetState['tag'] }) {
  const tags = useTags();
  const editing = useMemo(() => tags.find((tag) => tag.id === state?.id), [tags, state?.id]);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[7]);
  const [icon, setIcon] = useState('pricetag');

  // Load the tag being edited (or sensible defaults) each time the sheet opens.
  useEffect(() => {
    if (!state) return;
    const used = new Set(tags.map((tag) => tag.color.toUpperCase()));
    setName(editing?.name ?? '');
    setColor(editing?.color ?? SWATCHES.find((hex) => !used.has(hex)) ?? SWATCHES[7]);
    setIcon(editing?.icon ?? 'pricetag');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const close = () => closeSheet('tag');
  const clash = tags.some((tag) => tag.id !== editing?.id && tag.name.toLowerCase() === name.trim().toLowerCase());
  const save = () => {
    if (!name.trim() || clash) return;
    if (editing) updateTag(editing.id, { name: name.trim(), color, icon });
    else createTag({ name, color, icon });
    close();
    toast(editing ? 'Tag updated' : 'Tag created');
  };

  return (
    <Sheet open={!!state} onClose={close} title={editing ? 'Edit tag' : 'New tag'} onConfirm={save} confirmDisabled={!name.trim() || clash} confirmLabel="Save tag">
      <div className="tag-preview" style={{ '--c': color } as CSSProperties}>
        <span className="tag-tile" style={{ '--s': '76px' } as CSSProperties}><TagGlyph name={icon} size={38} /></span>
        <input
          className="tag-name-input" aria-label="Tag name" placeholder="Tag name" value={name} maxLength={40}
          data-autofocus={!editing || undefined}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
          }}
        />
        {clash ? (
          <span className="tag-clash">You already have a tag with this name.</span>
        ) : (
          <TagChip tag={{ id: '', name: name.trim() || 'Preview', color, icon, sort: 0, created_at: 0 }} />
        )}
      </div>
      <Group title="Colour">
        <div className="pad"><ColorPicker value={color} onChange={setColor} /></div>
      </Group>
      <Group title="Icon">
        <div className="pad"><IconPicker value={icon} onChange={setIcon} color={color} /></div>
      </Group>
      {editing && (
        <div className="sheet-foot">
          <Button variant="destructive" full icon={<Icon.trash />}
            onClick={() => void removeTag(editing).then((ok) => ok && close())}>
            Delete tag
          </Button>
        </div>
      )}
    </Sheet>
  );
}
