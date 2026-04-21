-- Add graduation-tracking fields to Course
ALTER TABLE "Course"
ADD COLUMN "cfu" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "isPassFail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isCompleted" BOOLEAN NOT NULL DEFAULT false;

-- Speed up global career stats queries
CREATE INDEX "Course_userId_isCompleted_idx" ON "Course"("userId", "isCompleted");
