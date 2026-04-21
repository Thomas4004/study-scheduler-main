import { NextRequest, NextResponse } from "next/server";
import { TopicStatus } from "@prisma/client";

import prisma from "@/lib/prisma";
import {
  recalculateSchedule,
  replaceGhostSessionsWithRealPlan,
} from "@/lib/planning";

export const dynamic = "force-dynamic";

function parseDifficulty(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 5) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function parseStatus(value: unknown): TopicStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();

  if (normalized === TopicStatus.TO_STUDY) return TopicStatus.TO_STUDY;
  if (normalized === TopicStatus.REVIEW || normalized === "REVIEWING") {
    return TopicStatus.REVIEW;
  }
  if (normalized === TopicStatus.MASTERED) return TopicStatus.MASTERED;

  return null;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ examId: string }> },
) {
  try {
    const { examId } = await context.params;

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        topics: {
          orderBy: [
            { status: "asc" },
            { difficulty_weight: "desc" },
            { name: "asc" },
          ],
        },
      },
    });

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    return NextResponse.json({ topics: exam.topics }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch topics:", error);
    return NextResponse.json(
      { error: "Failed to fetch topics" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ examId: string }> },
) {
  try {
    const { examId } = await context.params;

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        status: true,
        courseId: true,
        _count: {
          select: {
            topics: true,
          },
        },
      },
    });

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    if (exam.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Cannot add topics to a completed or archived exam" },
        { status: 409 },
      );
    }

    if (!exam.courseId) {
      return NextResponse.json(
        {
          error:
            "Exam is missing a course association. Run the migration backfill.",
        },
        { status: 409 },
      );
    }

    const topicCountBeforeCreate = exam._count.topics;

    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown;
      difficulty_weight?: unknown;
      difficulty?: unknown;
      status?: unknown;
    };

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: "Topic name is required" },
        { status: 400 },
      );
    }

    const difficultyWeight = parseDifficulty(
      body.difficulty_weight ?? body.difficulty,
    );
    if (difficultyWeight === null) {
      return NextResponse.json(
        { error: "difficulty_weight must be between 0.5 and 5" },
        { status: 400 },
      );
    }

    const parsedStatus = parseStatus(body.status);
    const status = parsedStatus ?? TopicStatus.TO_STUDY;

    const topic = await prisma.topic.create({
      data: {
        courseId: exam.courseId,
        name: body.name.trim(),
        difficulty_weight: difficultyWeight,
        status,
        exams: {
          connect: {
            id: exam.id,
          },
        },
      },
    });

    const recalculation =
      topicCountBeforeCreate === 0
        ? await replaceGhostSessionsWithRealPlan(examId)
        : await recalculateSchedule(examId);

    return NextResponse.json(
      {
        topic,
        recalculation,
        ghostReplaced: topicCountBeforeCreate === 0,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create topic:", error);
    return NextResponse.json(
      { error: "Failed to create topic" },
      { status: 500 },
    );
  }
}
