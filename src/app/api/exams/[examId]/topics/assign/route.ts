import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { recalculateSchedule } from "@/lib/planning";

export const dynamic = "force-dynamic";

type AssignPayload = {
  topicIds?: unknown;
};

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ examId: string }> },
) {
  try {
    const { examId } = await context.params;

    if (!examId) {
      return NextResponse.json({ error: "Missing examId" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as AssignPayload;
    if (!Array.isArray(body.topicIds)) {
      return NextResponse.json(
        { error: "topicIds must be an array" },
        { status: 400 },
      );
    }

    const topicIds = body.topicIds
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const uniqueTopicIds = Array.from(new Set(topicIds));

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        status: true,
        courseId: true,
      },
    });

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    if (exam.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Cannot modify topics for a completed or archived exam" },
        { status: 409 },
      );
    }

    if (!exam.courseId) {
      return NextResponse.json(
        { error: "Exam has no course assigned" },
        { status: 409 },
      );
    }

    if (uniqueTopicIds.length > 0) {
      const matchingTopics = await prisma.topic.findMany({
        where: {
          id: {
            in: uniqueTopicIds,
          },
          courseId: exam.courseId,
        },
        select: {
          id: true,
        },
      });

      if (matchingTopics.length !== uniqueTopicIds.length) {
        return NextResponse.json(
          {
            error:
              "One or more selected topics do not belong to this course and cannot be assigned",
          },
          { status: 400 },
        );
      }
    }

    await prisma.exam.update({
      where: {
        id: exam.id,
      },
      data: {
        topics: {
          set: uniqueTopicIds.map((topicId) => ({ id: topicId })),
        },
      },
    });

    const recalculation = await recalculateSchedule(exam.id);

    return NextResponse.json(
      {
        assignedCount: uniqueTopicIds.length,
        recalculation,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to assign course topics to exam:", error);
    return NextResponse.json(
      { error: "Failed to assign course topics to exam" },
      { status: 500 },
    );
  }
}
