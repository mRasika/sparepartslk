ALTER TABLE "parts" ADD COLUMN "keywords" text;--> statement-breakpoint
-- Trigram index so keyword search stays fast, like parts_name_trgm_idx (0001).
CREATE INDEX IF NOT EXISTS "parts_keywords_trgm_idx" ON "parts" USING gin ("keywords" gin_trgm_ops);
