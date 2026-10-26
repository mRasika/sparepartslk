CREATE TABLE "closed_days" (
	"day" date PRIMARY KEY NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" date NOT NULL,
	"daily_target" numeric(12, 2) NOT NULL,
	"closed_weekdays" smallint[] DEFAULT '{}' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_targets_effective_from_unique" UNIQUE("effective_from"),
	CONSTRAINT "sales_targets_positive" CHECK ("sales_targets"."daily_target" > 0),
	CONSTRAINT "sales_targets_weekdays" CHECK ("sales_targets"."closed_weekdays" <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality("sales_targets"."closed_weekdays") < 7)
);
--> statement-breakpoint
ALTER TABLE "closed_days" ADD CONSTRAINT "closed_days_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- RLS on with no policies, like every other app table (see 0001): the browser roles never read it.
ALTER TABLE "sales_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "closed_days" ENABLE ROW LEVEL SECURITY;
