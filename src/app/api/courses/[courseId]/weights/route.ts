import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

type WeightPayload = {
  exams?: Array<{
    examId?: unknown;
    weightPercent?: unknown;
  }>;
};

function parsePercent(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 100) / 100;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await context.params;

    if (!courseId) {
      return NextResponse.json({ error: "Missing courseId" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as WeightPayload;

    if (!Array.isArray(body.exams) || body.exams.length === 0) {
      return NextResponse.json(
        { error: "exams array is required" },
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

    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        userId: user.id,
      },
      select: {
        id: true,
        exams: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!course) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }

    const validExamIds = new Set(course.exams.map((exam) => exam.id));
    const normalized = body.exams.map((entry) => {
      const examId =
        typeof entry.examId === "string" ? entry.examId.trim() : "";
      const weightPercent = parsePercent(entry.weightPercent);

      return {
        examId,
        weightPercent,
      };
    });

    for (const entry of normalized) {
      if (!entry.examId || !validExamIds.has(entry.examId)) {
        return NextResponse.json(
          { error: `Invalid examId '${entry.examId || "(empty)"}'` },
          { status: 400 },
        );
      }

      if (entry.weightPercent === null) {
        return NextResponse.json(
          { error: "Each weightPercent must be a number between 0 and 100" },
          { status: 400 },
        );
      }
    }

    const totalPercent = normalized.reduce(
      (sum, entry) => sum + (entry.weightPercent ?? 0),
      0,
    );

    if (totalPercent <= 0) {
      return NextResponse.json(
        { error: "The total weight must be greater than 0" },
        { status: 400 },
      );
    }

    await prisma.$transaction(
      normalized.map((entry) =>
        prisma.exam.update({
          where: {
            id: entry.examId,
          },
          data: {
            weight: (entry.weightPercent ?? 0) / 100,
          },
        }),
      ),
    );

    return NextResponse.json(
      {
        updated: normalized.length,
        totalPercent: Math.round(totalPercent * 100) / 100,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to update course exam weights:", error);
    return NextResponse.json(
      { error: "Failed to update course exam weights" },
      { status: 500 },
    );
  }
}
