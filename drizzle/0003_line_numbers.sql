-- Backfill existing rows with 1, then require callers to set it.
ALTER TABLE "grn_items" ADD COLUMN "line_no" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "grn_items" ALTER COLUMN "line_no" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stock_adjustment_items" ADD COLUMN "line_no" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "stock_adjustment_items" ALTER COLUMN "line_no" DROP DEFAULT;
