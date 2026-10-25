CREATE TABLE "invoice_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"payment_type" "payment_type" NOT NULL,
	"data" jsonb NOT NULL,
	"line_count" integer NOT NULL,
	"total" numeric(12, 2),
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_updated_by_profiles_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_drafts_updated_at_idx" ON "invoice_drafts" USING btree ("updated_at");--> statement-breakpoint
-- RLS on with no policies, like every other app table (see 0001): the browser roles never read it.
ALTER TABLE "invoice_drafts" ENABLE ROW LEVEL SECURITY;
