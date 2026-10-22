-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN_OPS', 'SUPPORT', 'CALL_CENTER', 'DISTRIBUTOR_ADMIN', 'DISTRIBUTOR_STAFF', 'RETAILER_OWNER', 'RETAILER_STAFF', 'SALES_REP');
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED');
CREATE TYPE "LinkStatus" AS ENUM ('PENDING', 'LINKED', 'DECLINED');
CREATE TYPE "BillingSoftware" AS ENUM ('MARG', 'TALLY', 'BUSY', 'GOFRUGAL', 'CSV', 'API');
CREATE TYPE "Schedule" AS ENUM ('NONE', 'H', 'H1', 'X');
CREATE TYPE "Category" AS ENUM ('FEVER_PAIN', 'GASTRO', 'ANTIBIOTIC', 'CARDIAC', 'DIABETES_THYROID', 'ALLERGY_RESPIRATORY', 'VITAMINS', 'OTHER');
CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'ACCEPTED', 'BILLED', 'DISPATCHED', 'DELIVERED', 'REJECTED', 'CANCELLED');
CREATE TYPE "OrderSource" AS ENUM ('APP', 'WEB', 'WHATSAPP', 'CALL_CENTER', 'SALES_REP', 'UPLOAD');
CREATE TYPE "ActorType" AS ENUM ('RETAILER', 'DISTRIBUTOR', 'SYNC_AGENT', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "userCode" TEXT NOT NULL,
    "mobile" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "lang" VARCHAR(2) NOT NULL DEFAULT 'en',
    "retailerId" UUID,
    "distributorId" UUID,
    "termsAcceptedAt" TIMESTAMP(3),
    "termsVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Retailer" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Hyderabad',
    "pincode" VARCHAR(6) NOT NULL,
    "address" TEXT NOT NULL,
    "gstin" VARCHAR(15),
    "dl20b" TEXT,
    "dl21b" TEXT,
    "pan" VARCHAR(10),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "kycNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Retailer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Distributor" (
    "id" UUID NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Hyderabad',
    "address" TEXT NOT NULL,
    "gstin" VARCHAR(15),
    "drugLicence" TEXT,
    "billingSoftware" "BillingSoftware" NOT NULL DEFAULT 'CSV',
    "deliveryLabel" TEXT NOT NULL DEFAULT 'Today',
    "etaHours" INTEGER NOT NULL DEFAULT 6,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "kycNote" TEXT,
    "invoiceSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Distributor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycDocument" (
    "id" UUID NOT NULL,
    "retailerId" UUID,
    "distributorId" UUID,
    "kind" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expiresOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetailerDistributorLink" (
    "id" UUID NOT NULL,
    "retailerId" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'PENDING',
    "partyCode" TEXT,
    "creditLimitPaise" INTEGER NOT NULL DEFAULT 0,
    "outstandingPaise" INTEGER NOT NULL DEFAULT 0,
    "reservedPaise" INTEGER NOT NULL DEFAULT 0,
    "creditDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RetailerDistributorLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "form" VARCHAR(16) NOT NULL,
    "pack" VARCHAR(24) NOT NULL,
    "salt" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "hsn" VARCHAR(8),
    "gstPct" INTEGER NOT NULL DEFAULT 5,
    "schedule" "Schedule" NOT NULL DEFAULT 'NONE',
    "category" "Category" NOT NULL DEFAULT 'OTHER',
    "mrpPaise" INTEGER NOT NULL,
    "barcode" TEXT,
    "searchText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DistributorItem" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "productId" UUID,
    "externalCode" TEXT NOT NULL,
    "externalName" TEXT NOT NULL,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "ptrPaise" INTEGER NOT NULL,
    "mrpPaise" INTEGER,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "schemeBuy" INTEGER,
    "schemeFree" INTEGER,
    "nearestExpiry" DATE,
    "mapConfidence" INTEGER,
    "stockUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DistributorItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CartItem" (
    "id" UUID NOT NULL,
    "retailerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShortageItem" (
    "id" UUID NOT NULL,
    "retailerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "addedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShortageItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetailerProductPref" (
    "retailerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "usualQty" INTEGER NOT NULL DEFAULT 10,
    "notifyWhenBack" BOOLEAN NOT NULL DEFAULT false,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RetailerProductPref_pkey" PRIMARY KEY ("retailerId","productId")
);

CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "retailerId" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "source" "OrderSource" NOT NULL DEFAULT 'APP',
    "placedById" UUID,
    "subtotalPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "invoiceNo" TEXT,
    "rejectReason" TEXT,
    "erpRef" TEXT,
    "erpPulledAt" TIMESTAMP(3),
    "timeToPlaceSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "distributorItemId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "ratePaise" INTEGER NOT NULL,
    "gstPct" INTEGER NOT NULL,
    "billedQty" INTEGER,
    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OtpChallenge" (
    "id" UUID NOT NULL,
    "mobile" VARCHAR(10) NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncAgent" (
    "id" UUID NOT NULL,
    "distributorId" UUID NOT NULL,
    "keyPrefix" VARCHAR(12) NOT NULL,
    "keyHash" TEXT NOT NULL,
    "software" "BillingSoftware" NOT NULL,
    "version" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastStockSyncAt" TIMESTAMP(3),
    "errorCount24h" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "mobile" VARCHAR(10),
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_userCode_key" ON "User"("userCode");
CREATE UNIQUE INDEX "User_mobile_key" ON "User"("mobile");
CREATE INDEX "User_retailerId_idx" ON "User"("retailerId");
CREATE INDEX "User_distributorId_idx" ON "User"("distributorId");
CREATE UNIQUE INDEX "Retailer_gstin_key" ON "Retailer"("gstin");
CREATE UNIQUE INDEX "Distributor_code_key" ON "Distributor"("code");
CREATE UNIQUE INDEX "Distributor_gstin_key" ON "Distributor"("gstin");
CREATE INDEX "RetailerDistributorLink_distributorId_status_idx" ON "RetailerDistributorLink"("distributorId", "status");
CREATE UNIQUE INDEX "RetailerDistributorLink_retailerId_distributorId_key" ON "RetailerDistributorLink"("retailerId", "distributorId");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE INDEX "Product_searchText_trgm_idx" ON "Product" USING GIN ("searchText" gin_trgm_ops);
CREATE INDEX "DistributorItem_productId_idx" ON "DistributorItem"("productId");
CREATE INDEX "DistributorItem_distributorId_productId_idx" ON "DistributorItem"("distributorId", "productId");
CREATE UNIQUE INDEX "DistributorItem_distributorId_externalCode_key" ON "DistributorItem"("distributorId", "externalCode");
CREATE UNIQUE INDEX "CartItem_retailerId_productId_key" ON "CartItem"("retailerId", "productId");
CREATE UNIQUE INDEX "ShortageItem_retailerId_productId_key" ON "ShortageItem"("retailerId", "productId");
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");
CREATE INDEX "Order_distributorId_status_createdAt_idx" ON "Order"("distributorId", "status", "createdAt");
CREATE INDEX "Order_retailerId_createdAt_idx" ON "Order"("retailerId", "createdAt");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");
CREATE INDEX "OtpChallenge_mobile_createdAt_idx" ON "OtpChallenge"("mobile", "createdAt");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE UNIQUE INDEX "SyncAgent_distributorId_key" ON "SyncAgent"("distributorId");
CREATE UNIQUE INDEX "SyncAgent_keyPrefix_key" ON "SyncAgent"("keyPrefix");
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "Notification_sentAt_idx" ON "Notification"("sentAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailerDistributorLink" ADD CONSTRAINT "RetailerDistributorLink_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailerDistributorLink" ADD CONSTRAINT "RetailerDistributorLink_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DistributorItem" ADD CONSTRAINT "DistributorItem_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DistributorItem" ADD CONSTRAINT "DistributorItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShortageItem" ADD CONSTRAINT "ShortageItem_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShortageItem" ADD CONSTRAINT "ShortageItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShortageItem" ADD CONSTRAINT "ShortageItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RetailerProductPref" ADD CONSTRAINT "RetailerProductPref_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetailerProductPref" ADD CONSTRAINT "RetailerProductPref_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_distributorItemId_fkey" FOREIGN KEY ("distributorItemId") REFERENCES "DistributorItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncAgent" ADD CONSTRAINT "SyncAgent_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
