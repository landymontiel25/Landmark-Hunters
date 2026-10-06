// Per-listener health, shared by every hook and shown by RealtimeStatus:
// subscribed, last update, errors, Firestore reads charged, and how long the
// last update took from snapshot to painted screen.

export interface ListenerState {
  subscribed: boolean;
  lastUpdate: number | null;
  errors: number;
  lastError: string | null;
  reads: number;
  lastPaintMs: number | null;
}

type Store = Record<string, ListenerState>;
let store: Store = {};
const subscribers = new Set<() => void>();
const emit = () => {
  store = { ...store };
  for (const fn of subscribers) fn();
};
const slot = (name: string): ListenerState => store[name] || { subscribed: false, lastUpdate: null, errors: 0, lastError: null, reads: 0, lastPaintMs: null };

export function reportSubscribed(name: string) {
  store[name] = { ...slot(name), subscribed: true };
  console.log(`[Dashboard] Listener subscribed: ${name}`);
  emit();
}
export function reportListenerUpdate(name: string, reads: number, at = Date.now()) {
  store[name] = { ...slot(name), subscribed: true, lastUpdate: at, reads: slot(name).reads + reads };
  console.log(`[Dashboard] ${name} update received at ${new Date(at).toISOString()} (${reads} reads)`);
  emit();
}
export function reportPaint(name: string, ms: number) {
  store[name] = { ...slot(name), lastPaintMs: Math.round(ms * 10) / 10 };
  emit();
}
export function reportListenerError(name: string, message: string) {
  store[name] = { ...slot(name), subscribed: false, errors: slot(name).errors + 1, lastError: message };
  console.error(`[Dashboard] Listener error on ${name}:`, message);
  emit();
}
export function reportUnsubscribed(name: string) {
  if (!store[name]) return;
  store[name] = { ...slot(name), subscribed: false };
  emit();
}

export const getHealth = (): Store => store;
export function subscribeHealth(fn: () => void) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
export function _resetHealth() {
  store = {};
}

export function healthSummary(s: Store = store, now = Date.now()) {
  const list = Object.entries(s);
  const live = list.filter(([, v]) => v.subscribed).length;
  const errors = list.reduce((n, [, v]) => n + v.errors, 0);
  const reads = list.reduce((n, [, v]) => n + v.reads, 0);
  const last = Math.max(0, ...list.map(([, v]) => v.lastUpdate || 0));
  return { listeners: list.length, live, errors, reads, lastUpdate: last || null, allLive: list.length > 0 && live === list.length, ageMs: last ? now - last : null };
}
