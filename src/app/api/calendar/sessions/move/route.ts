import { NextRequest, NextResponse } from "next/server";
import { startOfDay } from "date-fns";

import { GENERIC_STUDY_SESSION_NAME } from "@/lib/planning";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

function parseTargetDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = startOfDay(new Date(value));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: unknown;
      targetDate?: unknown;
    };

    if (
      typeof body.sessionId !== "string" ||
      body.sessionId.trim().length === 0
    ) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    const targetDate = parseTargetDate(body.targetDate);
    if (!targetDate) {
      return NextResponse.json(
        { error: "targetDate must be a valid date string" },
        { status: 400 },
      );
    }

    const user = await prisma.user.findFirst({
      select: {
        id: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const session = await prisma.studySession.findFirst({
      where: {
        id: body.sessionId,
        exam: {
          userId: user.id,
          status: "ACTIVE",
        },
      },
      select: {
        id: true,
        examId: true,
        planned_date: true,
        is_completed: true,
        actual_hours: true,
        exam: {
          select: {
            exam_date: true,
            status: true,
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Study session not found" },
        { status: 404 },
      );
    }

    if (session.is_completed || session.actual_hours > 0) {
      return NextResponse.json(
        {
          error:
            "Completed or logged sessions cannot be moved. Recalculate the plan instead.",
        },
        { status: 400 },
      );
    }

    if (targetDate.getTime() > startOfDay(session.exam.exam_date).getTime()) {
      return NextResponse.json(
        { error: "targetDate cannot be after the exam date" },
        { status: 400 },
      );
    }

    const updated = await prisma.studySession.update({
      where: {
        id: session.id,
      },
      data: {
        planned_date: targetDate,
      },
      include: {
        exam: {
          select: {
            id: true,
            name: true,
            color_code: true,
            exam_date: true,
            status: true,
            course: {
              select: {
                name: true,
              },
            },
          },
        },
        topic: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        session: {
          id: updated.id,
          examId: updated.examId,
          topicId: updated.topicId,
          topicName: updated.is_placeholder
            ? GENERIC_STUDY_SESSION_NAME
            : (updated.topic?.name ?? "General review"),
          isPlaceholder: updated.is_placeholder,
          plannedDate: updated.planned_date.toISOString(),
          plannedHours: updated.planned_hours,
          type: updated.type,
          isCompleted: updated.is_completed,
          exam: {
            id: updated.exam.id,
            name: updated.exam.name,
            colorCode: updated.exam.color_code,
            examDate: updated.exam.exam_date.toISOString(),
            status: updated.exam.status,
            courseName: updated.exam.course?.name ?? "Corso non assegnato",
          },
          topic: updated.topic
            ? {
                id: updated.topic.id,
                name: updated.topic.name,
              }
            : null,
        },
        previousDate: startOfDay(session.planned_date).toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to move study session:", error);
    return NextResponse.json(
      { error: "Failed to move study session" },
      { status: 500 },
    );
  }
}
