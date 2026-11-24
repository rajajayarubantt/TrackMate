// System notifications and the reminder chime. In-app banners are separate (shell/Banners).

export type NotifyStatus = 'granted' | 'denied' | 'default' | 'unsupported';

export function notifyStatus(): NotifyStatus {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export async function requestNotifyPermission(): Promise<NotifyStatus> {
  if (!('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return notifyStatus();
  }
}

/** Show a system notification. Goes through the service worker when one is active (needed on phones). */
export async function systemNotify(title: string, body: string, tag: string): Promise<void> {
  if (notifyStatus() !== 'granted') return;
  const options = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.active) {
      await registration.showNotification(title, options);
      return;
    }
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    /* notifications are best-effort */
  }
}

let audio: AudioContext | null = null;

/** A short two-note chime, synthesised so no sound file is needed. */
export function playChime(): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    void ctx.resume();
    const start = ctx.currentTime + 0.02;
    const notes: [number, number][] = [[987.77, 0], [1318.51, 0.14]];
    for (const [frequency, delay] of notes) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + delay);
      gain.gain.exponentialRampToValueAtTime(0.16, start + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.6);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start + delay);
      oscillator.stop(start + delay + 0.65);
    }
  } catch {
    /* audio is best-effort */
  }
}
