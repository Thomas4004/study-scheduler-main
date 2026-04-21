-- Add archived topic state used by exam completion flow.
ALTER TYPE "TopicStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- Add exam lifecycle enum and archive metadata columns.
DO $$
BEGIN
  CREATE TYPE "ExamStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Exam"
ADD COLUMN "status" "ExamStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "grade" INTEGER,
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "notes" TEXT,
ADD COLUMN "totalFocusMinutes" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Exam_userId_status_exam_date_idx"
ON "Exam"("userId", "status", "exam_date");
