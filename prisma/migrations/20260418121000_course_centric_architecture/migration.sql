-- Create course entity used as parent container for multiple exams and topics.
CREATE TABLE IF NOT EXISTS "Course" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resourceLink" TEXT,
    "userId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- Add course and weighting metadata to exams.
ALTER TABLE "Exam"
ADD COLUMN IF NOT EXISTS "courseId" TEXT,
ADD COLUMN IF NOT EXISTS "weight" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- Move topic ownership to course and introduce resource link pool.
ALTER TABLE "Topic"
ADD COLUMN IF NOT EXISTS "courseId" TEXT,
ADD COLUMN IF NOT EXISTS "resources" JSONB NOT NULL DEFAULT '[]';

-- Implicit many-to-many join table between exams and topics.
CREATE TABLE IF NOT EXISTS "_ExamTopics" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "_ExamTopics_AB_unique" ON "_ExamTopics"("A", "B");
CREATE INDEX IF NOT EXISTS "_ExamTopics_B_index" ON "_ExamTopics"("B");

-- Backfill existing Topic->Exam one-to-many assignments into the new join table.
INSERT INTO "_ExamTopics" ("A", "B")
SELECT "examId", "id"
FROM "Topic"
WHERE "examId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Add indexes for course-centric queries.
CREATE INDEX IF NOT EXISTS "Course_userId_idx" ON "Course"("userId");
CREATE INDEX IF NOT EXISTS "Course_userId_name_idx" ON "Course"("userId", "name");
CREATE INDEX IF NOT EXISTS "Exam_courseId_exam_date_idx" ON "Exam"("courseId", "exam_date");
CREATE INDEX IF NOT EXISTS "Topic_courseId_status_idx" ON "Topic"("courseId", "status");
CREATE INDEX IF NOT EXISTS "Topic_courseId_next_review_idx" ON "Topic"("courseId", "next_review");

-- Foreign keys with cascade semantics.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Course_userId_fkey'
  ) THEN
    ALTER TABLE "Course"
    ADD CONSTRAINT "Course_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Exam_courseId_fkey'
  ) THEN
    ALTER TABLE "Exam"
    ADD CONSTRAINT "Exam_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Topic_courseId_fkey'
  ) THEN
    ALTER TABLE "Topic"
    ADD CONSTRAINT "Topic_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = '_ExamTopics_A_fkey'
  ) THEN
    ALTER TABLE "_ExamTopics"
    ADD CONSTRAINT "_ExamTopics_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Exam"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = '_ExamTopics_B_fkey'
  ) THEN
    ALTER TABLE "_ExamTopics"
    ADD CONSTRAINT "_ExamTopics_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Topic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Remove obsolete Topic->Exam one-to-many relationship.
ALTER TABLE "Topic" DROP CONSTRAINT IF EXISTS "Topic_examId_fkey";
DROP INDEX IF EXISTS "Topic_examId_status_idx";
DROP INDEX IF EXISTS "Topic_examId_next_review_idx";
ALTER TABLE "Topic" DROP COLUMN IF EXISTS "examId";
