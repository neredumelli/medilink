/** App-wide "is MediLink reachable?" state, shared by the API client and the full-screen status screen. */
export type SystemKind = 'ok' | 'offline' | 'down' | 'maintenance' | 'update';
export interface SystemState {
  kind: SystemKind;
  message?: string;
  until?: string | null;
  ref?: string;
}

let state: SystemState = { kind: 'ok' };
const listeners = new Set<() => void>();

export const getSystem = () => state;
export function setSystem(next: SystemState) {
  if (next.kind === state.kind && next.message === state.message && next.until === state.until && next.ref === state.ref) return;
  state = next;
  listeners.forEach((l) => l());
}
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
