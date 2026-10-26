CREATE TYPE "public"."quotation_status" AS ENUM('open', 'converted', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."doc_type" ADD VALUE 'QUO';--> statement-breakpoint
CREATE TABLE "quotation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"part_id" uuid NOT NULL,
	"description" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"discount_type" text,
	"discount_value" numeric(12, 2),
	"discount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	CONSTRAINT "quotation_items_quotation_line_unique" UNIQUE("quotation_id","line_no"),
	CONSTRAINT "quotation_items_qty_positive" CHECK ("quotation_items"."qty" > 0),
	CONSTRAINT "quotation_items_price_non_negative" CHECK ("quotation_items"."unit_price" >= 0),
	CONSTRAINT "quotation_items_discount_pair" CHECK (("quotation_items"."discount_type" is null) = ("quotation_items"."discount_value" is null) and ("quotation_items"."discount_type" is null or "quotation_items"."discount_type" in ('amount', 'percent')))
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"quote_for_name" text,
	"quote_for_phone" text,
	"quotation_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"payment_type" "payment_type" NOT NULL,
	"tier_id" uuid NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"discount_total" numeric(12, 2) NOT NULL,
	"vat_amount" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"invoice_discount_type" text,
	"invoice_discount_value" numeric(12, 2),
	"note" text,
	"status" "quotation_status" DEFAULT 'open' NOT NULL,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"invoice_id" uuid,
	"converted_by" uuid,
	"converted_at" timestamp with time zone,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_number_unique" UNIQUE("number"),
	CONSTRAINT "quotations_valid_after_date" CHECK ("quotations"."valid_until" >= "quotations"."quotation_date"),
	CONSTRAINT "quotations_converted_has_invoice" CHECK (("quotations"."status" = 'converted') = ("quotations"."invoice_id" is not null)),
	CONSTRAINT "quotations_cancelled_has_reason" CHECK ("quotations"."status" <> 'cancelled' or "quotations"."cancel_reason" is not null),
	CONSTRAINT "quotations_discount_pair" CHECK (("quotations"."invoice_discount_type" is null) = ("quotations"."invoice_discount_value" is null) and ("quotations"."invoice_discount_type" is null or "quotations"."invoice_discount_type" in ('amount', 'percent')))
);
--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tier_id_price_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_cancelled_by_profiles_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_converted_by_profiles_user_id_fk" FOREIGN KEY ("converted_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_updated_by_profiles_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotation_items_quotation_idx" ON "quotation_items" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "quotations_date_idx" ON "quotations" USING btree ("quotation_date");--> statement-breakpoint
CREATE INDEX "quotations_status_valid_idx" ON "quotations" USING btree ("status","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_invoice_idx" ON "quotations" USING btree ("invoice_id") WHERE "quotations"."invoice_id" is not null;--> statement-breakpoint
-- RLS on with no policies, like every other app table (see 0001): the browser roles never read it.
ALTER TABLE "quotations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotation_items" ENABLE ROW LEVEL SECURITY;
