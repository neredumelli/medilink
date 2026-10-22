-- Flexible data, part 1: aliases, several barcodes, batches, product status, licence expiry,
-- admin-defined custom fields and a change history written by the database itself.

CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'DISCONTINUED', 'BANNED', 'RECALLED');
CREATE TYPE "FieldEntity" AS ENUM ('PRODUCT', 'RETAILER', 'DISTRIBUTOR');
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'YESNO', 'CHOICE');

-- ---------------------------------------------------------------- new columns
ALTER TABLE "Retailer"
  ADD COLUMN "dl20bExpiry" DATE,
  ADD COLUMN "dl21bExpiry" DATE,
  ADD COLUMN "extra" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Distributor"
  ADD COLUMN "drugLicenceExpiry" DATE,
  ADD COLUMN "extra" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Product"
  ADD COLUMN "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "statusNote" TEXT,
  ADD COLUMN "statusAt" TIMESTAMP(3),
  ADD COLUMN "extra" JSONB NOT NULL DEFAULT '{}',
  ALTER COLUMN "searchText" SET DEFAULT '';
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- ---------------------------------------------------------------- new tables
CREATE TABLE "ProductAlias" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "alias" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductAlias_productId_alias_key" ON "ProductAlias"("productId", "alias");
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductBarcode" (
  "code" VARCHAR(20) NOT NULL,
  "productId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "ProductBarcode_productId_idx" ON "ProductBarcode"("productId");
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Move the old single barcode column into the new table, then drop it.
INSERT INTO "ProductBarcode" ("code", "productId") SELECT "barcode", "id" FROM "Product" WHERE "barcode" IS NOT NULL;
DROP INDEX IF EXISTS "Product_barcode_key";
ALTER TABLE "Product" DROP COLUMN "barcode";

CREATE TABLE "ItemBatch" (
  "id" UUID NOT NULL,
  "distributorItemId" UUID NOT NULL,
  "batchNo" VARCHAR(30) NOT NULL,
  "expiry" DATE NOT NULL,
  "stockQty" INTEGER NOT NULL DEFAULT 0,
  "mrpPaise" INTEGER,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ItemBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ItemBatch_distributorItemId_batchNo_key" ON "ItemBatch"("distributorItemId", "batchNo");
CREATE INDEX "ItemBatch_expiry_idx" ON "ItemBatch"("expiry");
ALTER TABLE "ItemBatch" ADD CONSTRAINT "ItemBatch_distributorItemId_fkey" FOREIGN KEY ("distributorItemId") REFERENCES "DistributorItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CustomField" (
  "id" UUID NOT NULL,
  "entity" "FieldEntity" NOT NULL,
  "key" VARCHAR(40) NOT NULL,
  "label" VARCHAR(60) NOT NULL,
  "type" "FieldType" NOT NULL,
  "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "required" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomField_entity_key_key" ON "CustomField"("entity", "key");

CREATE TABLE "RowHistory" (
  "id" BIGSERIAL NOT NULL,
  "tableName" TEXT NOT NULL,
  "rowId" TEXT NOT NULL,
  "op" VARCHAR(6) NOT NULL,
  "changes" JSONB NOT NULL,
  "actor" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RowHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RowHistory_tableName_rowId_changedAt_idx" ON "RowHistory"("tableName", "rowId", "changedAt");

-- ---------------------------------------------------------------- rules the database enforces
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_clean" CHECK ("alias" = lower(btrim("alias")) AND length("alias") >= 2);
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_format" CHECK ("code" ~ '^[0-9A-Za-z-]{6,20}$');
ALTER TABLE "ItemBatch" ADD CONSTRAINT "ItemBatch_values" CHECK ("stockQty" >= 0 AND ("mrpPaise" IS NULL OR "mrpPaise" >= 0) AND length(btrim("batchNo")) > 0);
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,39}$');
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_choice_has_options" CHECK ("type" <> 'CHOICE' OR cardinality("options") > 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_extra_object" CHECK (jsonb_typeof("extra") = 'object');
ALTER TABLE "Retailer" ADD CONSTRAINT "Retailer_extra_object" CHECK (jsonb_typeof("extra") = 'object');
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_extra_object" CHECK (jsonb_typeof("extra") = 'object');
ALTER TABLE "Product" ADD CONSTRAINT "Product_status_note" CHECK ("status" = 'ACTIVE' OR "statusAt" IS NOT NULL);

-- ---------------------------------------------------------------- search text includes aliases (always up to date)
CREATE OR REPLACE FUNCTION product_search_text() RETURNS trigger AS $$
BEGIN
  NEW."searchText" := lower(concat_ws(' ', NEW."name", NEW."salt", NEW."company",
    (SELECT string_agg("alias", ' ' ORDER BY "alias") FROM "ProductAlias" WHERE "productId" = NEW."id")));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER product_search_text BEFORE INSERT OR UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION product_search_text();

CREATE OR REPLACE FUNCTION product_alias_touch() RETURNS trigger AS $$
DECLARE pid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN pid := OLD."productId"; ELSE pid := NEW."productId"; END IF;
  UPDATE "Product" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = pid;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER product_alias_touch AFTER INSERT OR UPDATE OR DELETE ON "ProductAlias" FOR EACH ROW EXECUTE FUNCTION product_alias_touch();

-- ---------------------------------------------------------------- nearest expiry follows the batches
CREATE OR REPLACE FUNCTION item_batch_expiry() RETURNS trigger AS $$
DECLARE iid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN iid := OLD."distributorItemId"; ELSE iid := NEW."distributorItemId"; END IF;
  UPDATE "DistributorItem"
     SET "nearestExpiry" = (SELECT min("expiry") FROM "ItemBatch" WHERE "distributorItemId" = iid AND "stockQty" > 0)
   WHERE "id" = iid;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER item_batch_expiry AFTER INSERT OR UPDATE OR DELETE ON "ItemBatch" FOR EACH ROW EXECUTE FUNCTION item_batch_expiry();

-- ---------------------------------------------------------------- change history
-- record_history(idColumn, ignoredColumn...): stores only the fields that changed, as { field: [old, new] }.
-- The person is taken from the transaction setting app.actor when the app sets it.
CREATE OR REPLACE FUNCTION record_history() RETURNS trigger AS $$
DECLARE
  o JSONB; n JSONB; ch JSONB := '{}'::jsonb; k TEXT; rid TEXT;
  idcol TEXT := TG_ARGV[0];
  ign TEXT[] := ARRAY['updatedAt', 'createdAt', 'searchText'] || COALESCE(TG_ARGV[1:], ARRAY[]::TEXT[]);
BEGIN
  IF TG_OP = 'DELETE' THEN o := to_jsonb(OLD); n := '{}'::jsonb;
  ELSIF TG_OP = 'INSERT' THEN o := '{}'::jsonb; n := to_jsonb(NEW);
  ELSE o := to_jsonb(OLD); n := to_jsonb(NEW);
  END IF;
  FOR k IN SELECT jsonb_object_keys(o || n) LOOP
    CONTINUE WHEN k = ANY(ign);
    IF (o -> k) IS DISTINCT FROM (n -> k) THEN
      ch := ch || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
    END IF;
  END LOOP;
  IF ch = '{}'::jsonb THEN RETURN NULL; END IF;
  rid := COALESCE(n ->> idcol, o ->> idcol);
  INSERT INTO "RowHistory" ("tableName", "rowId", "op", "changes", "actor")
  VALUES (TG_TABLE_NAME, rid, TG_OP, ch, NULLIF(current_setting('app.actor', true), ''));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER history AFTER INSERT OR UPDATE OR DELETE ON "Product" FOR EACH ROW EXECUTE FUNCTION record_history('id');
CREATE TRIGGER history AFTER INSERT OR DELETE ON "ProductAlias" FOR EACH ROW EXECUTE FUNCTION record_history('productId', 'id');
CREATE TRIGGER history AFTER INSERT OR DELETE ON "ProductBarcode" FOR EACH ROW EXECUTE FUNCTION record_history('productId');
-- Stock moves every minute from the billing software: only price, discount and scheme changes are kept.
CREATE TRIGGER history AFTER UPDATE ON "DistributorItem" FOR EACH ROW EXECUTE FUNCTION record_history('id', 'stockQty', 'stockUpdatedAt', 'nearestExpiry', 'externalName', 'mapConfidence');
CREATE TRIGGER history AFTER INSERT OR UPDATE ON "RetailerDistributorLink" FOR EACH ROW EXECUTE FUNCTION record_history('id', 'outstandingPaise', 'reservedPaise');
CREATE TRIGGER history AFTER UPDATE ON "Retailer" FOR EACH ROW EXECUTE FUNCTION record_history('id');
CREATE TRIGGER history AFTER UPDATE ON "Distributor" FOR EACH ROW EXECUTE FUNCTION record_history('id', 'invoiceSeq');
CREATE TRIGGER history AFTER INSERT OR UPDATE OR DELETE ON "CustomField" FOR EACH ROW EXECUTE FUNCTION record_history('id');
CREATE TRIGGER history AFTER INSERT OR UPDATE ON "AppSetting" FOR EACH ROW EXECUTE FUNCTION record_history('key', 'updatedById');

-- History is append-only, like the audit log.
CREATE OR REPLACE FUNCTION row_history_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'RowHistory is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER row_history_no_update BEFORE UPDATE OR DELETE ON "RowHistory" FOR EACH ROW EXECUTE FUNCTION row_history_immutable();

-- Rebuild search text for existing medicines (fires the trigger; no history because only ignored columns change).
UPDATE "Product" SET "updatedAt" = "updatedAt";
