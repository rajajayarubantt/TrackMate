import { createStore, useStore } from './store';

export type AppName = 'today' | 'links' | 'tasks' | 'notes' | 'calendar' | 'tags';
export interface Route {
  app: AppName;
  id?: string;
}

const APPS: AppName[] = ['today', 'links', 'tasks', 'notes', 'calendar', 'tags'];

function parse(hash: string): Route {
  const [app, id] = hash.replace(/^#\/?/, '').split('/');
  return { app: APPS.includes(app as AppName) ? (app as AppName) : 'today', id: id || undefined };
}

const route = createStore<Route>(parse(location.hash));
window.addEventListener('hashchange', () => route.set(parse(location.hash)));

export function navigate(app: AppName, id?: string, replace = false): void {
  const hash = `#/${app}${id ? `/${id}` : ''}`;
  if (hash === location.hash) return;
  if (replace) {
    history.replaceState(null, '', hash);
    route.set(parse(hash));
  } else {
    location.hash = hash;
  }
}

export const useRoute = (): Route => useStore(route);
export const getRoute = (): Route => route.get();
