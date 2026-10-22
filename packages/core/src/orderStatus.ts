export const ORDER_STATUSES = ['PLACED', 'ACCEPTED', 'BILLED', 'DISPATCHED', 'DELIVERED', 'REJECTED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Actor = 'RETAILER' | 'DISTRIBUTOR' | 'SYNC_AGENT' | 'ADMIN';

/** Who may move an order from one status to another. */
const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, Actor[]>>> = {
  PLACED: {
    ACCEPTED: ['DISTRIBUTOR', 'SYNC_AGENT', 'ADMIN'],
    REJECTED: ['DISTRIBUTOR', 'ADMIN'],
    CANCELLED: ['RETAILER', 'ADMIN'],
  },
  ACCEPTED: {
    BILLED: ['DISTRIBUTOR', 'SYNC_AGENT', 'ADMIN'],
    CANCELLED: ['DISTRIBUTOR', 'ADMIN'],
  },
  BILLED: { DISPATCHED: ['DISTRIBUTOR', 'SYNC_AGENT', 'ADMIN'] },
  DISPATCHED: { DELIVERED: ['DISTRIBUTOR', 'RETAILER', 'ADMIN'] },
  DELIVERED: {},
  REJECTED: {},
  CANCELLED: {},
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return (TRANSITIONS[from][to] ?? []).includes(actor);
}

export function nextStatuses(from: OrderStatus, actor: Actor): OrderStatus[] {
  return (Object.keys(TRANSITIONS[from]) as OrderStatus[]).filter((to) => canTransition(from, to, actor));
}

export function isOpen(s: OrderStatus): boolean {
  return s === 'PLACED' || s === 'ACCEPTED' || s === 'BILLED' || s === 'DISPATCHED';
}

/** Credit is reserved when an order is placed and released if it never ships. */
export function releasesCredit(to: OrderStatus): boolean {
  return to === 'REJECTED' || to === 'CANCELLED';
}

/** Shop-friendly labels: the words a shop owner uses, not accounting terms. */
export const STATUS_LABEL_EN: Record<OrderStatus, string> = {
  PLACED: 'Placed',
  ACCEPTED: 'Accepted',
  BILLED: 'Billed',
  DISPATCHED: 'On the way',
  DELIVERED: 'Delivered',
  REJECTED: 'Not accepted',
  CANCELLED: 'Cancelled',
};

export const TRACKER_STEPS: OrderStatus[] = ['PLACED', 'ACCEPTED', 'BILLED', 'DISPATCHED', 'DELIVERED'];
