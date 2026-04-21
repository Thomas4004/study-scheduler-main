import { NextRequest, NextResponse } from "next/server";
import { TopicStatus } from "@prisma/client";

import prisma from "@/lib/prisma";
import { recalculateSchedule } from "@/lib/planning";

export const dynamic = "force-dynamic";

const validStatuses = new Set<TopicStatus>([
  TopicStatus.TO_STUDY,
  TopicStatus.REVIEW,
  TopicStatus.MASTERED,
]);

function parseDifficulty(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 5) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ topicId: string }> },
) {
  try {
    const { topicId } = await context.params;
    if (!topicId) {
      return NextResponse.json({ error: "Missing topicId" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown;
      difficulty_weight?: unknown;
      difficulty?: unknown;
      status?: unknown;
    };

    const existingTopic = await prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        exams: {
          orderBy: {
            exam_date: "asc",
          },
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!existingTopic) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    const activeExamIds = existingTopic.exams
      .filter((exam) => exam.status === "ACTIVE")
      .map((exam) => exam.id);

    if (activeExamIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "Cannot update topics that are only linked to completed or archived exams",
        },
        { status: 409 },
      );
    }

    const data: {
      name?: string;
      difficulty_weight?: number;
      status?: TopicStatus;
    } = {};

    if (typeof body.name === "string") {
      const trimmed = body.name.trim();
      if (!trimmed) {
        return NextResponse.json(
          { error: "Topic name cannot be empty" },
          { status: 400 },
        );
      }
      data.name = trimmed;
    }

    const incomingDifficulty =
      body.difficulty_weight !== undefined
        ? body.difficulty_weight
        : body.difficulty;

    if (incomingDifficulty !== undefined) {
      const parsedDifficulty = parseDifficulty(incomingDifficulty);
      if (parsedDifficulty === null) {
        return NextResponse.json(
          { error: "difficulty_weight must be between 0.5 and 5" },
          { status: 400 },
        );
      }
      data.difficulty_weight = parsedDifficulty;
    }

    if (body.status !== undefined) {
      if (typeof body.status !== "string") {
        return NextResponse.json(
          { error: "Invalid status value" },
          { status: 400 },
        );
      }

      const raw = body.status.trim().toUpperCase();
      const candidate = raw === "REVIEWING" ? "REVIEW" : raw;
      if (!validStatuses.has(candidate as TopicStatus)) {
        return NextResponse.json(
          { error: "Invalid topic status" },
          { status: 400 },
        );
      }

      data.status = candidate as TopicStatus;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No valid fields provided" },
        { status: 400 },
      );
    }

    const topic = await prisma.topic.update({
      where: { id: topicId },
      data,
    });

    const recalculation = await Promise.all(
      activeExamIds.map((examId) => recalculateSchedule(examId)),
    );

    return NextResponse.json(
      {
        topic,
        recalculatedExamIds: activeExamIds,
        recalculation,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to update topic:", error);
    return NextResponse.json(
      { error: "Failed to update topic" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ topicId: string }> },
) {
  try {
    const { topicId } = await context.params;
    if (!topicId) {
      return NextResponse.json({ error: "Missing topicId" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      select: {
        id: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const topic = await prisma.topic.findFirst({
      where: {
        id: topicId,
        OR: [
          {
            course: {
              userId: user.id,
            },
          },
          {
            exams: {
              some: {
                userId: user.id,
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        exams: {
          where: {
            userId: user.id,
          },
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!topic) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    const activeExamIds = topic.exams
      .filter((exam) => exam.status === "ACTIVE")
      .map((exam) => exam.id);

    await prisma.topic.delete({
      where: {
        id: topic.id,
      },
    });

    const recalculation =
      activeExamIds.length > 0
        ? await Promise.all(
            activeExamIds.map((examId) => recalculateSchedule(examId)),
          )
        : [];

    return NextResponse.json(
      {
        ok: true,
        deleted: {
          id: topic.id,
          name: topic.name,
        },
        recalculatedExamIds: activeExamIds,
        recalculation,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to delete topic:", error);
    return NextResponse.json(
      { error: "Failed to delete topic" },
      { status: 500 },
    );
  }
}
