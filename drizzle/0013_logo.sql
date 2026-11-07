CREATE TABLE "logo" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "logo_single_row" CHECK ("logo"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "logo" ENABLE ROW LEVEL SECURITY;
