// Link Tracker: paste a link, get its title, description and banner, add your own note and tags.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useQuery, useTagMap, useTags } from '../db/hooks';
import { createLink, createTask, deleteLink, insertLink, listLinks, setItemTags, updateLink } from '../db/repo';
import type { LinkItem, Tag } from '../db/types';
import { ago } from '../lib/dates';
import { canonical, fetchLinkMeta, hostOf, parseUrl } from '../lib/linkmeta';
import { getSettings, updateSettings, useSettings } from '../lib/session';
import { createStore, useStore } from '../lib/store';
import { hueOf } from '../lib/tints';
import { Screen } from '../shell/Screen';
import { closeSheet, openSheet } from '../shell/sheets';
import type { SheetState } from '../shell/sheets';
import { Button, EmptyState, Group, IconButton, Row, Segmented, Switch, TextArea } from '../ui/controls';
import { Icon } from '../ui/icons';
import { Menu, Sheet, toast, useAnchor } from '../ui/overlay';
import type { MenuEntry } from '../ui/overlay';
import { TagChip, TagsField } from '../ui/pickers';
import { Favicon } from './rows';

const insertTags = (id: string, tagIds: string[]): void => setItemTags('link', id, tagIds);

// ── Loading previews ───────────────────────────────────────────────────────────────────────────

const loading = createStore<ReadonlySet<string>>(new Set());
const setLoading = (id: string, on: boolean) =>
  loading.set((current) => {
    const next = new Set(current);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });

/** Look up a link's title, description and banner. `replace` overwrites what is already there. */
export async function loadPreview(id: string, url: string, replace: boolean): Promise<void> {
  setLoading(id, true);
  try {
    const meta = await fetchLinkMeta(url, getSettings());
    const current = listLinks().find((link) => link.id === id);
    if (!current) return;
    updateLink(id, {
      title: replace || !current.title ? meta.title : current.title,
      description: replace || !current.description ? meta.description : current.description,
      image: replace || !current.image ? meta.image : current.image,
      favicon: meta.favicon || current.favicon,
      // A new link starts with its host as the site name; the page's own name replaces that placeholder.
      site_name: replace || !current.site_name || current.site_name === hostOf(url) ? meta.site_name : current.site_name,
    });
  } finally {
    setLoading(id, false);
  }
}

/** Save a link (or surface the existing one if it is already saved) and open its details. */
export function saveLink(input: string, extra: Partial<LinkItem> = {}): LinkItem | null {
  const url = parseUrl(input);
  if (!url) return null;
  const existing = listLinks().find((link) => canonical(link.url) === canonical(url));
  if (existing) {
    toast({ message: 'You already saved this link', tone: 'warning' });
    openSheet('link', { id: existing.id });
    return existing;
  }
  const link = createLink({ url, site_name: hostOf(url), ...extra });
  void loadPreview(link.id, url, false);
  openSheet('link', { id: link.id, fresh: true });
  return link;
}

/** Tags worth offering: ones used on other links from the same site, or named in the link itself. */
function suggestTags(link: LinkItem, links: LinkItem[], tags: Tag[]): Tag[] {
  const host = hostOf(link.url);
  const score = new Map<string, number>();
  for (const other of links) {
    if (other.id === link.id || hostOf(other.url) !== host) continue;
    for (const id of other.tagIds) score.set(id, (score.get(id) ?? 0) + 2);
  }
  const haystack = `${link.title} ${link.description} ${link.url}`.toLowerCase();
  for (const tag of tags) {
    if (tag.name.length > 2 && haystack.includes(tag.name.toLowerCase())) score.set(tag.id, (score.get(tag.id) ?? 0) + 3);
  }
  return tags.filter((tag) => score.has(tag.id) && !link.tagIds.includes(tag.id))
    .sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0)).slice(0, 3);
}

function openLink(link: LinkItem): void {
  window.open(link.url, '_blank', 'noopener,noreferrer');
  updateLink(link.id, { is_read: 1, opens: link.opens + 1 });
}

function removeLink(link: LinkItem): void {
  deleteLink(link.id);
  toast({ message: 'Link deleted', actionLabel: 'Undo', onAction: () => insertLink(link) });
}

function linkMenu(link: LinkItem): MenuEntry[] {
  return [
    { label: 'Edit details', icon: <Icon.edit />, onSelect: () => openSheet('link', { id: link.id }) },
    {
      label: 'Copy link', icon: <Icon.copy />,
      onSelect: () => void navigator.clipboard?.writeText(link.url).then(() => toast('Link copied'), () => toast({ message: 'Copying is not allowed here', tone: 'warning' })),
    },
    { label: link.is_read ? 'Mark as unread' : 'Mark as read', icon: link.is_read ? <Icon.eyeOff /> : <Icon.eye />, onSelect: () => updateLink(link.id, { is_read: link.is_read ? 0 : 1 }) },
    { label: link.pinned ? 'Unpin' : 'Pin', icon: link.pinned ? <Icon.pinOutline /> : <Icon.pin />, onSelect: () => updateLink(link.id, { pinned: link.pinned ? 0 : 1 }) },
    { label: 'Refresh preview', icon: <Icon.refresh />, onSelect: () => void loadPreview(link.id, link.url, true) },
    {
      label: 'Add to Tasks', icon: <Icon.checkCircleOutline />,
      onSelect: () => {
        const task = createTask({ title: `Read: ${link.title || hostOf(link.url)}`, notes: link.url, tagIds: link.tagIds });
        toast({ message: 'Task added', actionLabel: 'Open', onAction: () => openSheet('task', { id: task.id }) });
      },
    },
    { separator: true },
    { label: 'Delete link', icon: <Icon.trash />, destructive: true, onSelect: () => removeLink(link) },
  ];
}

// ── Banner ─────────────────────────────────────────────────────────────────────────────────────

/** The link's banner image, or a generated one when the site has none. */
export function LinkBanner({ link, busy }: { link: LinkItem; busy?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [link.image]);
  const host = hostOf(link.url);
  if (link.image && !failed) {
    return (
      <div className="banner-img">
        <img src={link.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div className={`banner-img generated ${busy ? 'skeleton' : ''}`} style={{ '--h': hueOf(host) } as CSSProperties}>
      {!busy && (
        <>
          <span className="banner-letter">{host.charAt(0).toUpperCase()}</span>
          <span className="banner-host">{host}</span>
        </>
      )}
    </div>
  );
}

// ── Cards ──────────────────────────────────────────────────────────────────────────────────────

function LinkCard({ link, tags, list, busy }: { link: LinkItem; tags: Map<string, Tag>; list: boolean; busy: boolean }) {
  const menu = useAnchor();
  return (
    <article className={`link-card card ${list ? 'as-row' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault();
        menu.show({ x: event.clientX, y: event.clientY });
      }}>
      <a className="link-hit" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${link.title || link.url}`}
        onClick={(event) => {
          event.preventDefault();
          openLink(link);
        }} />
      <LinkBanner link={link} busy={busy} />
      {link.pinned ? <span className="link-pin"><Icon.pin /></span> : null}
      <div className="link-body">
        <div className="link-site">
          <Favicon key={link.favicon} url={link.url} favicon={link.favicon} size={16} />
          <span className="clamp-1">{link.site_name || hostOf(link.url)}</span>
          <span className="link-age">· {ago(link.created_at)}</span>
          <button type="button" className="link-more" aria-label="Link options" onClick={(event) => menu.show(event.currentTarget)}>
            <Icon.more />
          </button>
        </div>
        <h3 className="link-title clamp-2">
          {!link.is_read && <i className="unread-dot" aria-label="Unread" />}
          {busy && !link.title ? 'Loading preview…' : link.title || hostOf(link.url)}
        </h3>
        {link.description && <p className="link-desc clamp-2">{link.description}</p>}
        {link.note && <p className="link-note clamp-2">{link.note}</p>}
        {link.tagIds.length > 0 && (
          <div className="chips link-tags">
            {link.tagIds.map((id) => {
              const tag = tags.get(id);
              return tag ? <TagChip key={id} tag={tag} size="sm" /> : null;
            })}
          </div>
        )}
      </div>
      <Menu open={menu.open} anchor={menu.anchor} onClose={menu.hide} items={linkMenu(link)} />
    </article>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────────────────────

type Show = 'all' | 'unread' | 'pinned';
type Sort = 'newest' | 'oldest' | 'title' | 'site';

export function LinksScreen() {
  const links = useQuery(listLinks);
  const tags = useTags();
  const tagMap = useTagMap();
  const settings = useSettings();
  const busy = useStore(loading);
  const [text, setText] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('newest');
  const menu = useAnchor();
  const url = parseUrl(text);
  const list = settings.linkView === 'list';

  const visible = useMemo(() => {
    const q = url ? '' : text.trim().toLowerCase();
    const filtered = links.filter((link) => {
      if (show === 'unread' && link.is_read) return false;
      if (show === 'pinned' && !link.pinned) return false;
      if (tagFilter && !link.tagIds.includes(tagFilter)) return false;
      if (!q) return true;
      return `${link.title} ${link.description} ${link.note} ${link.url} ${link.site_name}`.toLowerCase().includes(q);
    });
    const by: Record<Sort, (a: LinkItem, b: LinkItem) => number> = {
      newest: (a, b) => b.created_at - a.created_at,
      oldest: (a, b) => a.created_at - b.created_at,
      title: (a, b) => (a.title || a.url).localeCompare(b.title || b.url),
      site: (a, b) => hostOf(a.url).localeCompare(hostOf(b.url)) || b.created_at - a.created_at,
    };
    return filtered.sort((a, b) => b.pinned - a.pinned || by[sort](a, b));
  }, [links, text, url, show, tagFilter, sort]);

  const usedTags = useMemo(() => tags.filter((tag) => links.some((link) => link.tagIds.includes(tag.id))), [tags, links]);
  const unread = links.filter((link) => !link.is_read).length;

  const submit = () => {
    if (url && saveLink(url)) setText('');
  };
  const paste = async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (parseUrl(clip)) {
        if (saveLink(clip)) setText('');
      } else if (clip) {
        setText(clip);
        toast({ message: 'The clipboard does not hold a link', tone: 'warning' });
      }
    } catch {
      toast({ message: 'Paste into the field instead — clipboard access was not allowed', tone: 'warning' });
    }
  };

  const options: MenuEntry[] = [
    { header: 'View as' },
    { label: 'Cards', icon: <Icon.grid />, checked: !list, onSelect: () => updateSettings({ linkView: 'grid' }) },
    { label: 'List', icon: <Icon.list />, checked: list, onSelect: () => updateSettings({ linkView: 'list' }) },
    { separator: true },
    { header: 'Sort by' },
    { label: 'Newest first', checked: sort === 'newest', onSelect: () => setSort('newest') },
    { label: 'Oldest first', checked: sort === 'oldest', onSelect: () => setSort('oldest') },
    { label: 'Title', checked: sort === 'title', onSelect: () => setSort('title') },
    { label: 'Site', checked: sort === 'site', onSelect: () => setSort('site') },
  ];

  return (
    <Screen
      title="Links" wide
      eyebrow={links.length ? `${links.length} saved · ${unread} unread` : undefined}
      actions={<IconButton variant="glass" icon={<Icon.more />} label="View options" onClick={(target) => menu.show(target)} />}
    >
      <Menu open={menu.open} anchor={menu.anchor} onClose={menu.hide} items={options} />
      <div className="paste-bar glass" data-ready={url ? true : undefined}>
        <span className="paste-icon">{url ? <Icon.link /> : <Icon.search />}</span>
        <input
          aria-label="Paste a link or search" placeholder="Paste a link or search" value={text} inputMode="url" enterKeyHint={url ? 'done' : 'search'}
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
        />
        {text && !url && (
          <button type="button" className="paste-clear" aria-label="Clear" onClick={() => setText('')}><Icon.closeCircle /></button>
        )}
        {url ? (
          <button type="button" className="paste-go" aria-label="Save link" onClick={submit}><Icon.up /></button>
        ) : (
          !text && <button type="button" className="paste-btn" onClick={() => void paste()}><Icon.clipboard />Paste</button>
        )}
      </div>

      {links.length > 0 && (
        <div className="filter-bar">
          <Segmented
            label="Show" size="sm" value={show} onChange={setShow}
            options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }, { value: 'pinned', label: 'Pinned' }]}
          />
          <div className="chips-scroll no-bar">
            {usedTags.map((tag) => (
              <TagChip key={tag.id} tag={tag} active={tagFilter === tag.id} onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)} />
            ))}
          </div>
        </div>
      )}

      {links.length === 0 ? (
        <EmptyState icon={<Icon.link />} title="Save your first link"
          text="Paste an address above. TrackMate looks up its title, description and banner, and you can add your own note and tags." />
      ) : visible.length === 0 ? (
        <EmptyState icon={<Icon.search />} title="No links match" text="Try a different search, or clear the filters." />
      ) : (
        <div className={list ? 'link-list' : 'link-grid'}>
          {visible.map((link) => <LinkCard key={link.id} link={link} tags={tagMap} list={list} busy={busy.has(link.id)} />)}
        </div>
      )}
    </Screen>
  );
}

// ── Details sheet ──────────────────────────────────────────────────────────────────────────────

export function LinkSheet({ state }: { state: SheetState['link'] }) {
  const links = useQuery(listLinks);
  const tags = useTags();
  const busy = useStore(loading);
  const link = links.find((item) => item.id === state?.id);
  const [last, setLast] = useState<LinkItem | undefined>(link);
  useEffect(() => {
    if (link) setLast(link);
  }, [link]);
  const shown = link ?? last;
  const close = () => closeSheet('link');
  if (!shown) return <Sheet open={false} onClose={close}>{null}</Sheet>;
  const isBusy = busy.has(shown.id);
  const suggestions = suggestTags(shown, links, tags);

  return (
    <Sheet open={!!state && !!link} onClose={close} title={state?.fresh ? 'Link saved' : 'Link'} onConfirm={close}>
      <div className="link-preview card">
        <LinkBanner link={shown} busy={isBusy} />
        <div className="link-body">
          <div className="link-site">
            <Favicon key={shown.favicon} url={shown.url} favicon={shown.favicon} size={16} />
            <span className="clamp-1">{shown.site_name || hostOf(shown.url)}</span>
            {isBusy && <span className="spinner small" role="status" aria-label="Loading preview" />}
          </div>
          <input
            className="link-title-input" aria-label="Title" placeholder={isBusy ? 'Loading preview…' : 'Title'} value={shown.title}
            onChange={(event) => updateLink(shown.id, { title: event.currentTarget.value })}
          />
          {shown.description && <p className="link-desc">{shown.description}</p>}
          <a className="link-url clamp-1" href={shown.url} target="_blank" rel="noopener noreferrer">{shown.url}</a>
        </div>
      </div>

      <Group title="Your description">
        <div className="pad">
          <TextArea label="Your description" placeholder="Why you saved this, or what to remember about it"
            value={shown.note} onChange={(note) => updateLink(shown.id, { note })} />
        </div>
      </Group>

      <Group title="Tags">
        <div className="pad">
          <TagsField value={shown.tagIds} onChange={(tagIds) => insertTags(shown.id, tagIds)} />
          {suggestions.length > 0 && (
            <div className="suggest">
              <span><Icon.sparkles /> Suggested</span>
              {suggestions.map((tag) => (
                <TagChip key={tag.id} tag={tag} size="sm" onClick={() => insertTags(shown.id, [...shown.tagIds, tag.id])} />
              ))}
            </div>
          )}
        </div>
      </Group>

      <Group>
        <Row icon={<Icon.pin />} label="Pinned" trailing={<Switch label="Pinned" checked={!!shown.pinned} onChange={(on) => updateLink(shown.id, { pinned: on ? 1 : 0 })} />} />
        <Row icon={<Icon.eye />} label="Read" trailing={<Switch label="Read" checked={!!shown.is_read} onChange={(on) => updateLink(shown.id, { is_read: on ? 1 : 0 })} />} />
        <Row icon={<Icon.refresh />} label="Refresh preview" detail={isBusy ? 'Looking up title and banner…' : undefined}
          onClick={() => void loadPreview(shown.id, shown.url, true)} />
      </Group>

      <div className="sheet-foot split">
        <Button icon={<Icon.open />} onClick={() => openLink(shown)}>Open link</Button>
        <Button variant="destructive" icon={<Icon.trash />}
          onClick={() => {
            close();
            removeLink(shown);
          }}>
          Delete
        </Button>
      </div>
    </Sheet>
  );
}
