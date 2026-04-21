-- Remove persisted risk flag from exams to keep scheduling UX neutral.
ALTER TABLE "Exam"
DROP COLUMN "at_risk";
