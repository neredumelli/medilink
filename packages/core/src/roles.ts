/**
 * Who can do what, in plain words. The API enforces these with role checks on every request;
 * this list is what the admin "Users & Access" screen shows.
 */
export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN_OPS',
  'SUPPORT',
  'CALL_CENTER',
  'DISTRIBUTOR_ADMIN',
  'DISTRIBUTOR_STAFF',
  'RETAILER_OWNER',
  'RETAILER_STAFF',
  'SALES_REP',
] as const;
export type RoleName = (typeof ROLES)[number];

export const ROLE_LABEL: Record<RoleName, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN_OPS: 'Operations admin',
  SUPPORT: 'Support',
  CALL_CENTER: 'Call center',
  DISTRIBUTOR_ADMIN: 'Distributor admin',
  DISTRIBUTOR_STAFF: 'Distributor staff',
  RETAILER_OWNER: 'Shop owner',
  RETAILER_STAFF: 'Shop staff',
  SALES_REP: 'Sales rep',
};

const ACCESS: Record<RoleName, string[]> = {
  SUPER_ADMIN: ['See everything', 'Approve or reject shops and distributors', 'Manage users, roles and access', 'Issue sync-agent keys', 'Map products in the catalogue'],
  ADMIN_OPS: ['See everything', 'Approve or reject shops and distributors', 'Manage users, roles and access', 'Issue sync-agent keys', 'Map products in the catalogue'],
  SUPPORT: ['See overview, orders, users and activity', 'Cannot approve, change roles or suspend'],
  CALL_CENTER: ['Place orders for shops (Phase 4)'],
  DISTRIBUTOR_ADMIN: ['See and act on own orders', 'Accept, reject, bill, dispatch', 'Approve shop link requests and set credit limits'],
  DISTRIBUTOR_STAFF: ['See and act on own orders', 'Accept, reject, bill, dispatch', 'Cannot approve shops or change credit limits'],
  RETAILER_OWNER: ['Search, compare and order', 'Place orders and use credit', 'Request links to distributors', 'Manage shortage list'],
  RETAILER_STAFF: ['Search and compare', 'Add to cart and shortage list', 'Cannot place orders'],
  SALES_REP: ['Assigned shops and their orders (Phase 3)'],
};

export function permissionsFor(role: string): string[] {
  return ACCESS[role as RoleName] ?? [];
}

/** Roles an admin may assign, depending on the business the user belongs to. */
export function assignableRoles(business: 'shop' | 'distributor' | null): RoleName[] {
  if (business === 'shop') return ['RETAILER_OWNER', 'RETAILER_STAFF'];
  if (business === 'distributor') return ['DISTRIBUTOR_ADMIN', 'DISTRIBUTOR_STAFF'];
  return ['SUPER_ADMIN', 'ADMIN_OPS', 'SUPPORT', 'CALL_CENTER', 'SALES_REP'];
}
