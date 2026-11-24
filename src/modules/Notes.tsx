// Notes: a list on the left (or on its own on a phone) and the block editor.
import { useMemo, useState } from 'react';
import { useQuery, useTagMap, useTags } from '../db/hooks';
import { createNote, listNotes } from '../db/repo';
import type { Note, Tag } from '../db/types';
import { addDays, fmt, relDay, startOfDay } from '../lib/dates';
import { navigate } from '../lib/router';
import { useSettings } from '../lib/session';
import { Screen } from '../shell/Screen';
import { Button, EmptyState, IconButton } from '../ui/controls';
import { Icon } from '../ui/icons';
import { TagChip } from '../ui/pickers';
import { NoteEditor } from './NoteEditor';

export function newNote(tagIds: string[] = [], title = ''): void {
  const note = createNote({ tagIds, title });
  navigate('notes', note.id);
}

function NoteCard({ note, tags, active, h24 }: { note: Note; tags: Map<string, Tag>; active: boolean; h24: boolean }) {
  const today = startOfDay(Date.now());
  const when = note.updated_at >= today ? fmt.time(note.updated_at, h24) : relDay(note.updated_at);
  return (
    <button type="button" className="note-card" aria-current={active ? 'true' : undefined} onClick={() => navigate('notes', note.id)}>
      <span className="note-card-title clamp-1">
        {note.pinned ? <Icon.pin className="note-card-pin" /> : null}
        {note.title || 'Untitled'}
      </span>
      <span className="note-card-line clamp-2">
        <b>{when}</b>
        {note.plain ? ` ${note.plain.replace(/\n/g, ' · ').slice(0, 160)}` : ' No additional text'}
      </span>
      {note.tagIds.length > 0 && (
        <span className="chips note-card-tags">
          {note.tagIds.map((id) => {
            const tag = tags.get(id);
            return tag ? <TagChip key={id} tag={tag} size="sm" /> : null;
          })}
        </span>
      )}
    </button>
  );
}

export function NotesScreen({ noteId }: { noteId?: string }) {
  const notes = useQuery(listNotes);
  const tags = useTags();
  const tagMap = useTagMap();
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const exists = !!noteId && notes.some((note) => note.id === noteId);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = notes.filter((note) =>
      (!tagFilter || note.tagIds.includes(tagFilter)) && (!q || `${note.title}\n${note.plain}`.toLowerCase().includes(q)));
    const today = startOfDay(Date.now());
    const buckets: { title: string; items: Note[] }[] = [
      { title: 'Pinned', items: [] }, { title: 'Today', items: [] }, { title: 'Previous 7 days', items: [] }, { title: 'Earlier', items: [] },
    ];
    for (const note of shown) {
      if (note.pinned) buckets[0].items.push(note);
      else if (note.updated_at >= today) buckets[1].items.push(note);
      else if (note.updated_at >= addDays(today, -7)) buckets[2].items.push(note);
      else buckets[3].items.push(note);
    }
    return buckets.filter((bucket) => bucket.items.length);
  }, [notes, query, tagFilter]);

  const usedTags = useMemo(() => tags.filter((tag) => notes.some((note) => note.tagIds.includes(tag.id))), [tags, notes]);
  const create = () => newNote(tagFilter ? [tagFilter] : []);

  return (
    <div className="notes-layout" data-open={exists || undefined}>
      <div className="notes-list">
        <Screen
          title="Notes" eyebrow={notes.length ? `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}` : undefined}
          actions={<IconButton variant="glass" icon={<Icon.edit />} label="New note" onClick={create} />}
        >
          {notes.length > 0 && (
            <>
              <label className="input input-search notes-search">
                <span className="input-icon"><Icon.search /></span>
                <input aria-label="Search notes" placeholder="Search notes" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
                {query && <button type="button" className="input-action" aria-label="Clear" onClick={() => setQuery('')}><Icon.closeCircle /></button>}
              </label>
              {usedTags.length > 0 && (
                <div className="chips-scroll no-bar notes-tags">
                  {usedTags.map((tag) => (
                    <TagChip key={tag.id} tag={tag} active={tagFilter === tag.id} onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)} />
                  ))}
                </div>
              )}
            </>
          )}
          {notes.length === 0 ? (
            <EmptyState icon={<Icon.note />} title="No notes yet"
              text="Write with headings, lists and to-dos. Notes save themselves as you type."
              action={<Button icon={<Icon.edit />} onClick={create}>New note</Button>} />
          ) : groups.length === 0 ? (
            <EmptyState icon={<Icon.search />} title="No notes match" text="Try a different search, or clear the tag filter." />
          ) : (
            groups.map((group) => (
              <section key={group.title} className="group-wrap">
                <h3 className="group-title">{group.title}</h3>
                <div className="group note-group">
                  {group.items.map((note) => <NoteCard key={note.id} note={note} tags={tagMap} active={note.id === noteId} h24={settings.time24} />)}
                </div>
              </section>
            ))
          )}
        </Screen>
      </div>
      <div className="notes-editor">
        {exists && noteId ? (
          <NoteEditor key={noteId} id={noteId} />
        ) : (
          <div className="notes-blank">
            <EmptyState icon={<Icon.note />} title="Pick a note" text="Choose a note from the list, or start a new one."
              action={<Button icon={<Icon.edit />} onClick={create}>New note</Button>} />
          </div>
        )}
      </div>
    </div>
  );
}
