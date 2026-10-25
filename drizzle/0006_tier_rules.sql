ALTER TABLE "price_tiers" ADD COLUMN "discount_pct" numeric(5, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_tiers" ADD COLUMN "round_to" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_discount_pct_range" CHECK ("price_tiers"."discount_pct" > -100 and "price_tiers"."discount_pct" < 100);--> statement-breakpoint
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_round_to_non_negative" CHECK ("price_tiers"."round_to" >= 0);