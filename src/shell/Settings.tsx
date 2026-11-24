import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { backupFile, restoreBackup } from '../db/backup';
import { useQuery } from '../db/hooks';
import { counts, removeSamples, sampleCount } from '../db/repo';
import { refresh, syncState } from '../db/store';
import type { Settings } from '../db/types';
import { ago } from '../lib/dates';
import { notifyStatus, playChime, requestNotifyPermission, systemNotify } from '../lib/notify';
import { navigate } from '../lib/router';
import { changePassword, deleteAccount, signOut, unsavedChanges, updateName, updateSettings, useUser } from '../lib/session';
import { useStore } from '../lib/store';
import { SYSTEM_COLORS } from '../lib/tints';
import { Button, Group, Row, Segmented, Select, Slider, Switch, TextInput } from '../ui/controls';
import { Icon } from '../ui/icons';
import { confirm, Sheet, toast } from '../ui/overlay';
import { pushBanner } from './Banners';
import { initials } from './Screen';
import { closeSheet } from './sheets';

function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const message = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

export function SettingsSheet({ open }: { open: boolean }) {
  const user = useUser();
  const settings = user.settings;
  const sync = useStore(syncState);
  const total = useQuery(counts);
  const samples = useQuery(sampleCount);
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user.name);
  const [notify, setNotify] = useState(notifyStatus());
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<Settings>) => updateSettings(change);
  const close = () => closeSheet('settings');

  const waiting = sync.pending === 1 ? '1 change waiting' : `${sync.pending} changes waiting`;
  const syncLabel =
    sync.health === 'offline' ? 'Offline'
      : sync.health === 'error' ? 'Couldn’t sync'
      : sync.pending > 0 ? 'Saving…' : 'Synced with MongoDB';
  const syncDetail =
    sync.health === 'offline' ? (sync.pending ? `${waiting} for a connection` : 'Showing the copy kept on this device')
      : sync.health === 'error' ? sync.error
      : `${total.links} links · ${total.tasks} tasks · ${total.notes} notes · ${total.events} events`;

  const syncNow = async () => {
    await refresh({ force: true });
    const state = syncState.get();
    toast(state.health === 'ok' ? 'Everything is up to date' : state.health === 'offline' ? 'Still offline' : state.error);
  };

  const exportBackup = () => {
    download(backupFile(), `trackmate-${new Date().toISOString().slice(0, 10)}.json`);
    toast('Backup downloaded');
  };

  const importBackup = async (picked: File) => {
    const ok = await confirm({
      title: 'Replace everything with this backup?',
      message: `“${picked.name}” will replace every link, task, note, event and tag in your account. Download a backup first if you want to keep what is here.`,
      confirmLabel: 'Replace',
      destructive: true,
    });
    if (!ok) return;
    try {
      restoreBackup(await picked.text());
      toast('Backup restored');
    } catch (reason) {
      await confirm({ title: 'That file could not be used', message: message(reason), alert: true });
    }
  };

  const leave = async () => {
    if (unsavedChanges() > 0 && syncState.get().health !== 'ok') {
      const ok = await confirm({
        title: 'Sign out before your changes sync?',
        message: 'Some changes have not reached the server yet. Signing out now removes them from this device.',
        confirmLabel: 'Sign out anyway',
        destructive: true,
      });
      if (!ok) return;
    }
    close();
    await signOut();
  };

  const removeAccount = async () => {
    setDeleteError('');
    setBusy(true);
    try {
      await deleteAccount(deletePassword);
      toast('Your account was deleted');
    } catch (reason) {
      setDeleteError(message(reason));
      setBusy(false);
    }
  };

  const enableNotifications = async () => {
    const status = await requestNotifyPermission();
    setNotify(status);
    set({ notify: status === 'granted' });
    if (status === 'denied') {
      await confirm({
        title: 'Notifications are blocked',
        message: 'Allow notifications for this site in your browser settings, then turn this on again.',
        alert: true,
      });
    }
  };

  const testAlert = () => {
    if (settings.chime) playChime();
    pushBanner({ id: 'test', title: 'This is how reminders look', text: 'They appear here while TrackMate is open.', color: 'var(--red)' });
    if (settings.notify) void systemNotify('TrackMate', 'This is how reminders look.', 'test');
  };

  const savePassword = async () => {
    setPasswordError('');
    try {
      await changePassword(current, next);
      setPasswordOpen(false);
      setCurrent('');
      setNext('');
      toast('Password changed');
    } catch (reason) {
      setPasswordError(message(reason));
    }
  };

  return (
    <Sheet open={open} onClose={close} title="Settings" size="md">
      <div className="profile">
        <span className="avatar avatar-lg">{initials(name || user.name)}</span>
        <input
          className="profile-name" aria-label="Your name" value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={() => (name.trim() ? updateName(name) : setName(user.name))}
        />
        <span className="profile-mail">{user.email}</span>
      </div>

      <Group>
        <Row
          icon={<Icon.tags />} iconColor="var(--purple)" label="Tag Manager" chevron
          value={`${total.tags}`}
          onClick={() => {
            close();
            navigate('tags');
          }}
        />
      </Group>

      <Group title="Appearance">
        <Row className="row-stack">
          <Segmented
            label="Theme" full value={settings.theme} onChange={(theme) => set({ theme })}
            options={[
              { value: 'auto', label: 'Automatic', icon: <Icon.contrast /> },
              { value: 'light', label: 'Light', icon: <Icon.sun /> },
              { value: 'dark', label: 'Dark', icon: <Icon.moon /> },
            ]}
          />
        </Row>
        <Row className="row-stack">
          <span className="row-label">Tint</span>
          <div className="tint-row no-bar" role="radiogroup" aria-label="Tint">
            <button
              type="button" role="radio" aria-checked={settings.tint === 'multi'} aria-label="Multicolour: each app has its own tint"
              className="tint-swatch multi" onClick={() => set({ tint: 'multi' })}
            />
            {SYSTEM_COLORS.map((color) => (
              <button
                key={color.key} type="button" role="radio" aria-checked={settings.tint === color.key} aria-label={color.name}
                className="tint-swatch" style={{ '--c': `var(--${color.key})` } as CSSProperties} onClick={() => set({ tint: color.key })}
              />
            ))}
          </div>
        </Row>
        <Row className="row-stack">
          <span className="row-label">Liquid Glass</span>
          <div className="glass-demo">
            <span className="glass">Glass</span>
          </div>
          <div className="slider-row">
            <span>Clear</span>
            <Slider label="Liquid Glass transparency" value={settings.glass} onChange={(glass) => set({ glass })} />
            <span>Tinted</span>
          </div>
        </Row>
        <Row label="Aurora background" trailing={<Switch label="Aurora background" checked={settings.aurora} onChange={(aurora) => set({ aurora })} />} />
      </Group>

      <Group title="Date and time">
        <Row label="Time format">
          <Select
            label="Time format" value={settings.time24 ? 24 : 12} onChange={(value) => set({ time24: value === 24 })}
            options={[{ value: 12, label: '12-hour' }, { value: 24, label: '24-hour' }]}
          />
        </Row>
        <Row label="Week starts on">
          <Select
            label="Week starts on" value={settings.weekStart} onChange={(weekStart) => set({ weekStart })}
            options={[{ value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }, { value: 6, label: 'Saturday' }]}
          />
        </Row>
        <Row label="Default alert for new events">
          <Select
            label="Default alert" value={settings.defaultAlert} onChange={(defaultAlert) => set({ defaultAlert })}
            options={[
              { value: null, label: 'None' }, { value: 0, label: 'At start' }, { value: 5, label: '5 min before' },
              { value: 10, label: '10 min before' }, { value: 15, label: '15 min before' }, { value: 30, label: '30 min before' },
              { value: 60, label: '1 hour before' },
            ]}
          />
        </Row>
      </Group>

      <Group
        title="Reminders"
        footer="Reminders appear while TrackMate is open in a tab or installed on your home screen. It can’t alert you while it is closed."
      >
        <Row
          label="System notifications"
          detail={
            notify === 'unsupported' ? 'Not available in this browser'
              : notify === 'denied' ? 'Blocked in browser settings'
              : notify === 'granted' ? 'Allowed' : 'Not turned on yet'
          }
          trailing={
            <Switch
              label="System notifications" checked={settings.notify && notify === 'granted'}
              onChange={(on) => (on ? void enableNotifications() : set({ notify: false }))}
            />
          }
        />
        <Row label="Chime" trailing={<Switch label="Chime" checked={settings.chime} onChange={(chime) => set({ chime })} />} />
        <Row label="Send a test alert" onClick={testAlert} className="ink-row" />
      </Group>

      <Group
        title="Link previews"
        footer="TrackMate’s own server reads the page’s title, description and banner. Some sites block that, so Automatic then asks Microlink, a preview service, and sends it the link’s address."
      >
        <Row label="Look up with">
          <Select
            label="Link preview service" value={settings.linkProvider} onChange={(linkProvider) => set({ linkProvider })}
            options={[
              { value: 'auto', label: 'Automatic' }, { value: 'server', label: 'TrackMate only' },
              { value: 'microlink', label: 'Microlink only' }, { value: 'off', label: 'Off' },
            ]}
          />
        </Row>
      </Group>

      <Group
        title="Data"
        footer="Your data lives in your MongoDB Atlas database. This device keeps a copy so TrackMate opens instantly and works offline; changes made offline are sent when you reconnect."
      >
        <Row
          icon={sync.health === 'ok' ? <Icon.saved /> : <Icon.cloudOff />} label={syncLabel} detail={syncDetail}
          value={sync.health === 'ok' && !sync.pending && sync.syncedAt ? (ago(sync.syncedAt) === 'now' ? 'just now' : ago(sync.syncedAt)) : ''}
          onClick={() => void syncNow()}
        />
        <Row icon={<Icon.share />} label="Download a backup" detail="Everything in your account as one .json file" onClick={exportBackup} />
        <Row icon={<Icon.cloudUp />} label="Restore a backup" detail="Replace everything with a backup file" onClick={() => fileInput.current?.click()} />
        {samples > 0 && (
          <Row
            icon={<Icon.sparkles />} label="Remove sample content" detail={`${samples} sample items`}
            onClick={() => {
              removeSamples();
              toast('Sample content removed');
            }}
          />
        )}
      </Group>
      <input
        ref={fileInput} type="file" accept=".json,application/json" hidden
        onChange={(event) => {
          const picked = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (picked) void importBackup(picked);
        }}
      />

      <Group title="Account">
        <Row icon={<Icon.key />} label="Change password" onClick={() => setPasswordOpen(!passwordOpen)} />
        {passwordOpen && (
          <div className="inline-form">
            <TextInput label="Current password" placeholder="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
            <TextInput label="New password" placeholder="New password" type="password" value={next} onChange={setNext} autoComplete="new-password" onEnter={() => void savePassword()} />
            {passwordError && <div className="auth-error" role="alert"><Icon.warning /><span>{passwordError}</span></div>}
            <div className="inline-actions">
              <Button size="sm" variant="gray" onClick={() => setPasswordOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={!current || !next} onClick={() => void savePassword()}>Change password</Button>
            </div>
          </div>
        )}
        <Row icon={<Icon.signOut />} label="Sign out" onClick={() => void leave()} />
        <Row icon={<Icon.personRemove />} label="Delete account" destructive onClick={() => setDeleteOpen(!deleteOpen)} />
        {deleteOpen && (
          <div className="inline-form">
            <span className="row-detail">This deletes your account and every link, task, note, event and tag in it, on every device. It can’t be undone.</span>
            <TextInput
              label="Your password" placeholder="Your password" type="password" value={deletePassword} onChange={setDeletePassword}
              autoComplete="current-password" onEnter={() => void removeAccount()}
            />
            {deleteError && <div className="auth-error" role="alert"><Icon.warning /><span>{deleteError}</span></div>}
            <div className="inline-actions">
              <Button size="sm" variant="gray" onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button size="sm" variant="destructive" disabled={!deletePassword || busy} onClick={() => void removeAccount()}>Delete account</Button>
            </div>
          </div>
        )}
      </Group>

      <p className="about">TrackMate 2.0 · React, TypeScript and MongoDB Atlas · runs on Vercel</p>
    </Sheet>
  );
}
