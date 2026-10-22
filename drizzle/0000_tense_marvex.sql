CREATE TYPE "public"."adjustment_reason" AS ENUM('damage', 'count_correction', 'lost', 'other');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('INV', 'GRN', 'CRN', 'PAY', 'ADJ');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('GRN', 'SALE', 'SALE_CANCEL', 'RETURN', 'ADJUST');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank', 'cheque');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_type" AS ENUM('cash', 'credit');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'staff');--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "brands_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "price_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "price_tiers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "role" DEFAULT 'staff' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"tin" text DEFAULT '' NOT NULL,
	"logo_url" text,
	"vat_enabled" boolean DEFAULT false NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '18.00' NOT NULL,
	"staff_max_discount_pct" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"default_credit_days" integer DEFAULT 30 NOT NULL,
	"doc_prefix" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "vehicle_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year_from" integer,
	"year_to" integer
);
--> statement-breakpoint
CREATE TABLE "part_fitments" (
	"part_id" uuid NOT NULL,
	"vehicle_model_id" uuid NOT NULL,
	CONSTRAINT "part_fitments_part_id_vehicle_model_id_pk" PRIMARY KEY("part_id","vehicle_model_id")
);
--> statement-breakpoint
CREATE TABLE "part_prices" (
	"part_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	CONSTRAINT "part_prices_part_id_tier_id_pk" PRIMARY KEY("part_id","tier_id"),
	CONSTRAINT "part_prices_price_non_negative" CHECK ("part_prices"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"oem_part_no" text,
	"barcode" text,
	"name" text NOT NULL,
	"category_id" uuid,
	"brand_id" uuid,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"bin_location" text,
	"qty_on_hand" integer DEFAULT 0 NOT NULL,
	"avg_cost" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"reorder_qty" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parts_sku_unique" UNIQUE("sku"),
	CONSTRAINT "parts_barcode_unique" UNIQUE("barcode"),
	CONSTRAINT "parts_qty_on_hand_non_negative" CHECK ("parts"."qty_on_hand" >= 0),
	CONSTRAINT "parts_reorder_non_negative" CHECK ("parts"."reorder_level" >= 0 and "parts"."reorder_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"business_name" text,
	"phone" text,
	"address" text,
	"tin" text,
	"tier_id" uuid NOT NULL,
	"credit_limit" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"is_walk_in" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_credit_non_negative" CHECK ("customers"."credit_limit" >= 0 and "customers"."credit_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"address" text,
	"tin" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grn_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grn_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	CONSTRAINT "grn_items_qty_positive" CHECK ("grn_items"."qty" > 0),
	CONSTRAINT "grn_items_unit_cost_non_negative" CHECK ("grn_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "grns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_invoice_no" text,
	"received_date" date NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grns_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"part_id" uuid NOT NULL,
	"description" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	CONSTRAINT "invoice_items_qty_positive" CHECK ("invoice_items"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"payment_type" "payment_type" NOT NULL,
	"tier_id" uuid NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"discount_total" numeric(12, 2) NOT NULL,
	"vat_amount" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"credit_override" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	CONSTRAINT "payment_allocations_amount_positive" CHECK ("payment_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"is_refund" boolean DEFAULT false NOT NULL,
	"status" "payment_status" DEFAULT 'active' NOT NULL,
	"invoice_id" uuid,
	"return_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_number_unique" UNIQUE("number"),
	CONSTRAINT "payments_amount_sign" CHECK (("payments"."is_refund" and "payments"."amount" < 0) or (not "payments"."is_refund" and "payments"."amount" > 0))
);
--> statement-breakpoint
CREATE TABLE "sales_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"invoice_item_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"restock" boolean NOT NULL,
	CONSTRAINT "sales_return_items_qty_positive" CHECK ("sales_return_items"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"return_date" date NOT NULL,
	"reason" text NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_returns_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "stock_adjustment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"qty_change" integer NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	CONSTRAINT "stock_adjustment_items_qty_change_non_zero" CHECK ("stock_adjustment_items"."qty_change" <> 0)
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"reason" "adjustment_reason" NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_adjustments_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"doc_type" "doc_type" NOT NULL,
	"year" integer NOT NULL,
	"next_no" integer NOT NULL,
	CONSTRAINT "document_sequences_doc_type_year_pk" PRIMARY KEY("doc_type","year")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"qty_change" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_reconciliation_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"stored_qty" integer NOT NULL,
	"ledger_qty" integer NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "part_fitments" ADD CONSTRAINT "part_fitments_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_fitments" ADD CONSTRAINT "part_fitments_vehicle_model_id_vehicle_models_id_fk" FOREIGN KEY ("vehicle_model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_prices" ADD CONSTRAINT "part_prices_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_prices" ADD CONSTRAINT "part_prices_tier_id_price_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tier_id_price_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_items" ADD CONSTRAINT "grn_items_grn_id_grns_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."grns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_items" ADD CONSTRAINT "grn_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tier_id_price_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancelled_by_profiles_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_adjustment_id_stock_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."stock_adjustments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reconciliation_issues" ADD CONSTRAINT "stock_reconciliation_issues_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_tiers_one_default" ON "price_tiers" USING btree ("is_default") WHERE "price_tiers"."is_default";--> statement-breakpoint
CREATE INDEX "part_fitments_vehicle_model_idx" ON "part_fitments" USING btree ("vehicle_model_id");--> statement-breakpoint
CREATE INDEX "parts_oem_part_no_idx" ON "parts" USING btree ("oem_part_no");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_one_walk_in" ON "customers" USING btree ("is_walk_in") WHERE "customers"."is_walk_in";--> statement-breakpoint
CREATE INDEX "grn_items_grn_idx" ON "grn_items" USING btree ("grn_id");--> statement-breakpoint
CREATE INDEX "grn_items_part_idx" ON "grn_items" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_items_part_idx" ON "invoice_items" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "invoices_customer_status_idx" ON "invoices" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "invoices_invoice_date_idx" ON "invoices" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_return_items_return_idx" ON "sales_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "sales_return_items_invoice_item_idx" ON "sales_return_items" USING btree ("invoice_item_id");--> statement-breakpoint
CREATE INDEX "sales_returns_invoice_idx" ON "sales_returns" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_returns_customer_idx" ON "sales_returns" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "stock_adjustment_items_adjustment_idx" ON "stock_adjustment_items" USING btree ("adjustment_id");--> statement-breakpoint
CREATE INDEX "stock_movements_part_created_idx" ON "stock_movements" USING btree ("part_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_reconciliation_issues_part_idx" ON "stock_reconciliation_issues" USING btree ("part_id");