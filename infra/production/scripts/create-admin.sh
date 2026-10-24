#!/usr/bin/env bash
# Creates a super admin who logs in with their mobile number (OTP) and then sets up 2-step login.
#   create-admin.sh <10-digit mobile> "<name>"
. "$(dirname "$0")/lib.sh"
mobile="${1:-}"; name="${2:-}"
[[ "$mobile" =~ ^[6-9][0-9]{9}$ ]] || { echo "Usage: create-admin.sh <10-digit mobile> \"<name>\"" >&2; exit 2; }
[ -n "$name" ] || { echo "Give the admin's name" >&2; exit 2; }
psql_ml -v mobile="$mobile" -v name="$name" <<'SQL'
INSERT INTO "User" (id, "userCode", mobile, name, role, status, "termsAcceptedAt", "termsVersion", "updatedAt")
SELECT gen_random_uuid(),
       'MLA-' || lpad((count(*) + 1)::text, 5, '0'),
       :'mobile', :'name', 'SUPER_ADMIN', 'ACTIVE', NOW(), 'admin', NOW()
FROM "User" WHERE "userCode" LIKE 'MLA-%'
ON CONFLICT (mobile) DO UPDATE SET role = 'SUPER_ADMIN', status = 'ACTIVE', "updatedAt" = NOW();
SQL
log "Super admin ready: $name (+91 $mobile). Log in at https://$DOMAIN/login; you will be asked to set up 2-step login."
