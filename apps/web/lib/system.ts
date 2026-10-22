'use client';

/**
 * Tiny global store for "is the system usable right now?" The API client reports what it sees;
 * <SystemStatus /> shows the matching full-screen message and checks again automatically.
 */
export type SystemKind = 'ok' | 'offline' | 'down' | 'maintenance' | 'update';

export interface SystemState {
  kind: SystemKind;
  message?: string;
  until?: string | null;
  ref?: string;
}

let state: SystemState = { kind: 'ok' };
let slow = 0;
const listeners = new Set<() => void>();

export function getSystem(): SystemState {
  return state;
}
export function setSystem(next: SystemState) {
  if (next.kind === state.kind && next.message === state.message && next.until === state.until) return;
  state = next;
  listeners.forEach((l) => l());
}
export function isSlow(): boolean {
  return slow > 0;
}
export function slowStart() {
  slow++;
  listeners.forEach((l) => l());
}
export function slowEnd() {
  slow = Math.max(0, slow - 1);
  listeners.forEach((l) => l());
}
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
