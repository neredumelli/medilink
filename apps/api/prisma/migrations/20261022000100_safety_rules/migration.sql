-- Order numbers: ML-10241, ML-10242 … from a database sequence (safe under concurrency).
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 10241;

-- Data rules the database itself enforces, so no bug in app code can break them.
ALTER TABLE "DistributorItem" ADD CONSTRAINT "DistributorItem_stock_nonneg" CHECK ("stockQty" >= 0);
ALTER TABLE "DistributorItem" ADD CONSTRAINT "DistributorItem_price_nonneg" CHECK ("ptrPaise" >= 0);
ALTER TABLE "DistributorItem" ADD CONSTRAINT "DistributorItem_discount_range" CHECK ("discountPct" >= 0 AND "discountPct" <= 100);
ALTER TABLE "DistributorItem" ADD CONSTRAINT "DistributorItem_scheme_pair" CHECK (("schemeBuy" IS NULL) = ("schemeFree" IS NULL) AND ("schemeBuy" IS NULL OR ("schemeBuy" > 0 AND "schemeFree" > 0)));
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_qty_range" CHECK ("qty" BETWEEN 1 AND 9999);
ALTER TABLE "ShortageItem" ADD CONSTRAINT "ShortageItem_qty_range" CHECK ("qty" BETWEEN 1 AND 9999);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_qty_range" CHECK ("qty" BETWEEN 1 AND 9999 AND "freeQty" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_billed_le_qty" CHECK ("billedQty" IS NULL OR ("billedQty" >= 0 AND "billedQty" <= "qty"));
ALTER TABLE "Order" ADD CONSTRAINT "Order_totals" CHECK ("totalPaise" = "subtotalPaise" + "gstPaise" AND "subtotalPaise" >= 0);
ALTER TABLE "RetailerDistributorLink" ADD CONSTRAINT "Link_money_nonneg" CHECK ("creditLimitPaise" >= 0 AND "reservedPaise" >= 0);
ALTER TABLE "User" ADD CONSTRAINT "User_mobile_format" CHECK ("mobile" ~ '^[6-9][0-9]{9}$');
ALTER TABLE "User" ADD CONSTRAINT "User_one_business" CHECK (NOT ("retailerId" IS NOT NULL AND "distributorId" IS NOT NULL));

-- The audit log is append-only: nobody (including the app) can edit or delete history.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
