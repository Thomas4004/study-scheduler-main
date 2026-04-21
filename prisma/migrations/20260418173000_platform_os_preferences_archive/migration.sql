-- Platform OS preferences + course archive support

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "pomodoro_focus_minutes" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN IF NOT EXISTS "pomodoro_short_break_minutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS "pomodoro_long_break_minutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN IF NOT EXISTS "degree_target_cfu" INTEGER NOT NULL DEFAULT 180;

ALTER TABLE "Course"
ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Course_userId_isArchived_idx" ON "Course"("userId", "isArchived");
