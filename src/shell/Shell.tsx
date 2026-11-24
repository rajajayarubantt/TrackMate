// The frame around every app: sidebar on wide screens, floating glass tab bar on phones.
import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { IconType } from 'react-icons';
import { useQuery, useTags } from '../db/hooks';
import { tagCounts, unseenReminderCount } from '../db/repo';
import { navigate, useRoute } from '../lib/router';
import type { AppName } from '../lib/router';
import { useUser } from '../lib/session';
import { APP_TINT } from '../lib/tints';
import { CalendarScreen } from '../modules/Calendar';
import { EventSheet } from '../modules/EventSheet';
import { LinkSheet, LinksScreen } from '../modules/Links';
import { NotesScreen } from '../modules/Notes';
import { TagSheet, TagsScreen } from '../modules/Tags';
import { TaskSheet } from '../modules/TaskSheet';
import { TasksScreen } from '../modules/Tasks';
import { TodayScreen } from '../modules/Today';
import { Icon, TagGlyph } from '../ui/icons';
import { AlertsSheet, useReminderEngine } from './Alerts';
import { CaptureSheet } from './Capture';
import { FocusPill } from './Focus';
import { initials } from './Screen';
import { SettingsSheet } from './Settings';
import { closeAllSheets, openSheet, useSheets } from './sheets';

interface AppDef {
  name: AppName;
  label: string;
  icon: IconType;
  activeIcon: IconType;
}

export const APPS: AppDef[] = [
  { name: 'today', label: 'Today', icon: Icon.todayOutline, activeIcon: Icon.today },
  { name: 'links', label: 'Links', icon: Icon.linkOutline, activeIcon: Icon.link },
  { name: 'tasks', label: 'Tasks', icon: Icon.checkCircleOutline, activeIcon: Icon.checkCircle },
  { name: 'notes', label: 'Notes', icon: Icon.noteOutline, activeIcon: Icon.note },
  { name: 'calendar', label: 'Calendar', icon: Icon.calendarOutline, activeIcon: Icon.calendar },
  { name: 'tags', label: 'Tags', icon: Icon.tagsOutline, activeIcon: Icon.tags },
];

function Sidebar({ current }: { current: AppName }) {
  const user = useUser();
  const tags = useTags();
  const counts = useQuery(tagCounts);
  const unseen = useQuery(unseenReminderCount);
  const route = useRoute();
  return (
    <aside className="sidebar glass">
      <div className="brand">
        <img src="icons/icon.svg" alt="" />
        <span>TrackMate</span>
      </div>
      <button type="button" className="side-search" onClick={() => openSheet('capture', {})}>
        <Icon.search />
        <span>Search or add</span>
        <kbd>⌘K</kbd>
      </button>
      <nav className="side-nav" aria-label="Apps">
        {APPS.map((app) => {
          const active = app.name === current;
          const Glyph = active ? app.activeIcon : app.icon;
          return (
            <button
              key={app.name} type="button" className="side-item" aria-current={active ? 'page' : undefined}
              style={{ '--c': `var(--${APP_TINT[app.name]}-ink, var(--${APP_TINT[app.name]}))` } as CSSProperties}
              onClick={() => navigate(app.name)}
            >
              <Glyph />
              <span>{app.label}</span>
            </button>
          );
        })}
      </nav>
      {tags.length > 0 && <div className="side-label">Tags</div>}
      <div className="side-tags">
        {tags.map((tag) => {
          const c = counts[tag.id];
          const total = c ? c.link + c.task + c.note + c.event : 0;
          return (
            <button
              key={tag.id} type="button" className="side-item"
              aria-current={route.app === 'tags' && route.id === tag.id ? 'page' : undefined}
              onClick={() => navigate('tags', tag.id)}
            >
              <span className="tag-dot" style={{ '--c': tag.color } as CSSProperties}><TagGlyph name={tag.icon} size={12} /></span>
              <span className="clamp-1">{tag.name}</span>
              {total > 0 && <span className="side-count">{total}</span>}
            </button>
          );
        })}
      </div>
      <div className="side-foot">
        <button type="button" className="side-user" onClick={() => openSheet('settings', true)}>
          <span className="avatar">{initials(user.name)}</span>
          <span className="side-user-text">
            <b>{user.name}</b>
            <span>{user.email}</span>
          </span>
        </button>
        <button type="button" className="icon-btn sm gray" aria-label="Reminders" onClick={() => openSheet('alerts', true)}>
          <Icon.bellOutline />
          {unseen > 0 && <span className="badge">{unseen > 9 ? '9+' : unseen}</span>}
        </button>
      </div>
    </aside>
  );
}

function TabBar({ current }: { current: AppName }) {
  const index = APPS.findIndex((app) => app.name === current);
  return (
    <nav className="tabbar glass" aria-label="Apps" style={{ '--i': index } as CSSProperties}>
      <span className="tab-lens" />
      {APPS.map((app) => {
        const active = app.name === current;
        const Glyph = active ? app.activeIcon : app.icon;
        return (
          <button key={app.name} type="button" className="tab" aria-current={active ? 'page' : undefined} onClick={() => navigate(app.name)}>
            <Glyph />
            <span>{app.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function Shell() {
  const route = useRoute();
  const user = useUser();
  const open = useSheets();
  const tint = user.settings.tint === 'multi' ? APP_TINT[route.app] : user.settings.tint;
  useReminderEngine();

  useEffect(() => {
    document.documentElement.dataset.tint = tint;
  }, [tint]);

  // Signing out (or importing another database) must not leave a sheet waiting to reopen.
  useEffect(() => closeAllSheets, []);

  // Keyboard shortcuts: ⌘K / Ctrl+K or "/" opens search and quick add; 1–6 switches app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSheet('capture', {});
      } else if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key === '/') {
          event.preventDefault();
          openSheet('capture', {});
        } else if (/^[1-6]$/.test(event.key) && !document.getElementById('overlays')?.childElementCount) {
          navigate(APPS[Number(event.key) - 1].name);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app" data-immersive={(route.app === 'notes' && !!route.id) || undefined}>
      <div className="wallpaper" />
      <Sidebar current={route.app} />
      <main className="stage">
        {route.app === 'today' && <TodayScreen />}
        {route.app === 'links' && <LinksScreen />}
        {route.app === 'tasks' && <TasksScreen />}
        {route.app === 'notes' && <NotesScreen noteId={route.id} />}
        {route.app === 'calendar' && <CalendarScreen />}
        {route.app === 'tags' && <TagsScreen tagId={route.id} />}
      </main>
      <TabBar current={route.app} />
      <FocusPill />
      <TaskSheet state={open.task} />
      <EventSheet state={open.event} />
      <LinkSheet state={open.link} />
      <TagSheet state={open.tag} />
      <CaptureSheet state={open.capture} />
      <AlertsSheet open={open.alerts} />
      <SettingsSheet open={open.settings} />
    </div>
  );
}
