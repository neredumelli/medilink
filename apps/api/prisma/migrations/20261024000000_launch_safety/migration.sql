-- Launch safety: Schedule X / narcotic blocking, admin 2-step login, and row-level security.

-- ---------------------------------------------------------------- 1. Schedule X and narcotic (NDPS) medicines
-- NDPS = Narcotic Drugs and Psychotropic Substances Act. These can never be ordered on MediLink.
ALTER TABLE "Product" ADD COLUMN "ndps" BOOLEAN NOT NULL DEFAULT false;

-- Last line of defence: even if app code has a bug, a blocked medicine can never enter a cart or an order.
CREATE OR REPLACE FUNCTION product_orderable_check() RETURNS trigger AS $$
DECLARE p RECORD;
BEGIN
  SELECT name, status, schedule, ndps INTO p FROM "Product" WHERE id = NEW."productId";
  IF p.schedule = 'X' OR p.ndps THEN
    RAISE EXCEPTION 'MEDILINK_BLOCKED: % is a Schedule X / narcotic medicine and cannot be ordered on MediLink', p.name
      USING ERRCODE = 'check_violation';
  END IF;
  IF p.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'MEDILINK_BLOCKED: % cannot be ordered (%)', p.name, lower(p.status::text)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_orderable BEFORE INSERT OR UPDATE OF "productId" ON "CartItem" FOR EACH ROW EXECUTE FUNCTION product_orderable_check();
CREATE TRIGGER product_orderable BEFORE INSERT ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION product_orderable_check();
-- Marking a medicine Schedule X or narcotic clears it from every shop's cart at once.
CREATE OR REPLACE FUNCTION product_controlled_clear() RETURNS trigger AS $$
BEGIN
  IF (NEW.schedule = 'X' OR NEW.ndps) AND NOT (OLD.schedule = 'X' OR OLD.ndps) THEN
    DELETE FROM "CartItem" WHERE "productId" = NEW.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER product_controlled_clear AFTER UPDATE OF schedule, ndps ON "Product" FOR EACH ROW EXECUTE FUNCTION product_controlled_clear();

-- ---------------------------------------------------------------- 2. Admin 2-step login (authenticator app)
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "totpLastStep" INTEGER;
ALTER TABLE "User" ADD COLUMN "recoveryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- A session remembers whether the second step was passed, so refreshing a token keeps it.
ALTER TABLE "Session" ADD COLUMN "mfa" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- 3. Row-level security
-- Shop and distributor requests run as the role medilink_tenant with the business id set for the
-- transaction. PostgreSQL then hides and protects every other business's rows, even if a query in the
-- app forgets its "where shop = me" filter. Admin screens, the scheduler and migrations do not switch
-- role, so they keep full access.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medilink_tenant') THEN
    CREATE ROLE medilink_tenant NOLOGIN;
  END IF;
END
$$;
GRANT medilink_tenant TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO medilink_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO medilink_tenant;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO medilink_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO medilink_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO medilink_tenant;

CREATE OR REPLACE FUNCTION app_retailer() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.retailer_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_distributor() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.distributor_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- Orders: the shop that placed it and the distributor it went to.
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON "Order" TO medilink_tenant
  USING ("retailerId" = app_retailer() OR "distributorId" = app_distributor())
  WITH CHECK ("retailerId" = app_retailer() OR "distributorId" = app_distributor());

ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON "OrderItem" TO medilink_tenant
  USING (EXISTS (SELECT 1 FROM "Order" o WHERE o.id = "orderId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Order" o WHERE o.id = "orderId"));

ALTER TABLE "OrderEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON "OrderEvent" TO medilink_tenant
  USING (EXISTS (SELECT 1 FROM "Order" o WHERE o.id = "orderId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Order" o WHERE o.id = "orderId"));

-- Shop working data: only the shop itself.
ALTER TABLE "CartItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON "CartItem" TO medilink_tenant USING ("retailerId" = app_retailer()) WITH CHECK ("retailerId" = app_retailer());
ALTER TABLE "ShortageItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON "ShortageItem" TO medilink_tenant USING ("retailerId" = app_retailer()) WITH CHECK ("retailerId" = app_retailer());
ALTER TABLE "RetailerProductPref" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON "RetailerProductPref" TO medilink_tenant USING ("retailerId" = app_retailer()) WITH CHECK ("retailerId" = app_retailer());

-- Links (credit limit, dues): the shop and the distributor on that link.
ALTER TABLE "RetailerDistributorLink" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON "RetailerDistributorLink" TO medilink_tenant
  USING ("retailerId" = app_retailer() OR "distributorId" = app_distributor())
  WITH CHECK ("retailerId" = app_retailer() OR "distributorId" = app_distributor());

-- Shops: a shop sees itself; a distributor sees shops linked to it (or asking to link).
ALTER TABLE "Retailer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "Retailer" FOR SELECT TO medilink_tenant
  USING (id = app_retailer() OR EXISTS (SELECT 1 FROM "RetailerDistributorLink" l WHERE l."retailerId" = "Retailer".id));
CREATE POLICY tenant_update ON "Retailer" FOR UPDATE TO medilink_tenant USING (id = app_retailer()) WITH CHECK (id = app_retailer());

-- Distributors: names and delivery times are public to shops; only the distributor can change its row.
ALTER TABLE "Distributor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "Distributor" FOR SELECT TO medilink_tenant USING (true);
CREATE POLICY tenant_update ON "Distributor" FOR UPDATE TO medilink_tenant USING (id = app_distributor()) WITH CHECK (id = app_distributor());

-- Stock and prices: readable for search; only the owning distributor (or its sync agent) can change them.
ALTER TABLE "DistributorItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "DistributorItem" FOR SELECT TO medilink_tenant USING (true);
CREATE POLICY tenant_insert ON "DistributorItem" FOR INSERT TO medilink_tenant WITH CHECK ("distributorId" = app_distributor());
CREATE POLICY tenant_update ON "DistributorItem" FOR UPDATE TO medilink_tenant USING ("distributorId" = app_distributor()) WITH CHECK ("distributorId" = app_distributor());
CREATE POLICY tenant_delete ON "DistributorItem" FOR DELETE TO medilink_tenant USING ("distributorId" = app_distributor());

ALTER TABLE "ItemBatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "ItemBatch" FOR SELECT TO medilink_tenant USING (true);
CREATE POLICY tenant_write ON "ItemBatch" FOR ALL TO medilink_tenant
  USING (EXISTS (SELECT 1 FROM "DistributorItem" di WHERE di.id = "distributorItemId" AND di."distributorId" = app_distributor()))
  WITH CHECK (EXISTS (SELECT 1 FROM "DistributorItem" di WHERE di.id = "distributorItemId" AND di."distributorId" = app_distributor()));

-- KYC documents and sync agents: only their own business.
ALTER TABLE "KycDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON "KycDocument" TO medilink_tenant
  USING ("retailerId" = app_retailer() OR "distributorId" = app_distributor())
  WITH CHECK ("retailerId" = app_retailer() OR "distributorId" = app_distributor());
ALTER TABLE "SyncAgent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON "SyncAgent" TO medilink_tenant USING ("distributorId" = app_distributor()) WITH CHECK ("distributorId" = app_distributor());

-- Duplicate-order protection keys: only the user who made them.
ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON "IdempotencyKey" TO medilink_tenant USING ("userId" = app_user()) WITH CHECK ("userId" = app_user());
