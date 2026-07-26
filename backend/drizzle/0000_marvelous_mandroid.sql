CREATE TYPE "public"."audit_job_status" AS ENUM('pending', 'running', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "accessibility_finding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_job_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"impact" varchar(16) NOT NULL,
	"description" text NOT NULL,
	"help_url" text NOT NULL,
	"node_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_job_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"estimated_impact" varchar(16) NOT NULL,
	"finding_type" varchar(32) NOT NULL,
	"finding_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"status" "audit_job_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_job_id" uuid NOT NULL,
	"overall" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_score_audit_job_id_unique" UNIQUE("audit_job_id")
);
--> statement-breakpoint
CREATE TABLE "capture_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_job_id" uuid NOT NULL,
	"desktop_screenshot_url" text NOT NULL,
	"mobile_screenshot_url" text NOT NULL,
	"load_time_ms" integer NOT NULL,
	"lcp" integer,
	"cls" numeric(6, 4),
	"partial" boolean DEFAULT false NOT NULL,
	"partial_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copy_finding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_job_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"severity" varchar(16) NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visual_finding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_job_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"severity" varchar(16) NOT NULL,
	"screenshot_region" jsonb,
	"confidence" numeric(4, 3) NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accessibility_finding" ADD CONSTRAINT "accessibility_finding_audit_job_id_audit_job_id_fk" FOREIGN KEY ("audit_job_id") REFERENCES "public"."audit_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_audit_job_id_audit_job_id_fk" FOREIGN KEY ("audit_job_id") REFERENCES "public"."audit_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_score" ADD CONSTRAINT "audit_score_audit_job_id_audit_job_id_fk" FOREIGN KEY ("audit_job_id") REFERENCES "public"."audit_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_result" ADD CONSTRAINT "capture_result_audit_job_id_audit_job_id_fk" FOREIGN KEY ("audit_job_id") REFERENCES "public"."audit_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_finding" ADD CONSTRAINT "copy_finding_audit_job_id_audit_job_id_fk" FOREIGN KEY ("audit_job_id") REFERENCES "public"."audit_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_finding" ADD CONSTRAINT "visual_finding_audit_job_id_audit_job_id_fk" FOREIGN KEY ("audit_job_id") REFERENCES "public"."audit_job"("id") ON DELETE cascade ON UPDATE no action;