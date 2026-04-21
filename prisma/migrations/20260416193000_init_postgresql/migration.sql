-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('TO_STUDY', 'REVIEW', 'MASTERED');

-- CreateEnum
CREATE TYPE "EnergyCurve" AS ENUM ('MORNING', 'AFTERNOON', 'NIGHT');

-- CreateEnum
CREATE TYPE "StudySessionType" AS ENUM ('FIRST_PASS', 'REVIEW');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "energy_curve" "EnergyCurve" NOT NULL DEFAULT 'MORNING',
    "weekly_hours_template" JSONB NOT NULL DEFAULT '{"monday":2,"tuesday":2,"wednesday":2,"thursday":2,"friday":2,"saturday":4,"sunday":0}',
    "secret_token" TEXT NOT NULL,
    "max_focus_minutes" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color_code" TEXT NOT NULL DEFAULT '#3B82F6',
    "total_cfu" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "exam_date" TIMESTAMP(3) NOT NULL,
    "buffer_days" INTEGER NOT NULL DEFAULT 2,
    "at_risk" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TopicStatus" NOT NULL DEFAULT 'TO_STUDY',
    "difficulty_weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "planned_date" TIMESTAMP(3) NOT NULL,
    "planned_hours" DOUBLE PRECISION NOT NULL,
    "actual_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "type" "StudySessionType" NOT NULL DEFAULT 'FIRST_PASS',
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_secret_token_key" ON "User"("secret_token");

-- CreateIndex
CREATE INDEX "User_secret_token_idx" ON "User"("secret_token");

-- CreateIndex
CREATE INDEX "Exam_userId_exam_date_idx" ON "Exam"("userId", "exam_date");

-- CreateIndex
CREATE INDEX "Topic_examId_status_idx" ON "Topic"("examId", "status");

-- CreateIndex
CREATE INDEX "StudySession_examId_planned_date_idx" ON "StudySession"("examId", "planned_date");

-- CreateIndex
CREATE INDEX "StudySession_topicId_planned_date_idx" ON "StudySession"("topicId", "planned_date");

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

