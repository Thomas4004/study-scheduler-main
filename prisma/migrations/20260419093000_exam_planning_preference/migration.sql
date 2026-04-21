-- Optional per-exam planning preferences used by Just-in-Time scheduling.
CREATE TABLE IF NOT EXISTS "ExamPlanningPreference" (
    "examId" TEXT NOT NULL,
    "earliest_start_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamPlanningPreference_pkey" PRIMARY KEY ("examId")
);

CREATE INDEX IF NOT EXISTS "ExamPlanningPreference_earliest_start_date_idx"
ON "ExamPlanningPreference"("earliest_start_date");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ExamPlanningPreference_examId_fkey'
  ) THEN
    ALTER TABLE "ExamPlanningPreference"
    ADD CONSTRAINT "ExamPlanningPreference_examId_fkey"
    FOREIGN KEY ("examId") REFERENCES "Exam"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
