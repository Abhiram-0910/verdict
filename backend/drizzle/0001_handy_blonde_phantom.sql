CREATE TYPE "public"."agent_status" AS ENUM('pending', 'complete', 'failed');--> statement-breakpoint
ALTER TABLE "audit_score" ALTER COLUMN "overall" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_job" ADD COLUMN "visual_status" "agent_status";--> statement-breakpoint
ALTER TABLE "audit_job" ADD COLUMN "copy_status" "agent_status";--> statement-breakpoint
ALTER TABLE "capture_result" ADD COLUMN "rendered_text" text;