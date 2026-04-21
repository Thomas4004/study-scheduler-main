import { NextRequest, NextResponse } from "next/server";
import { startOfDay } from "date-fns";

import prisma from "@/lib/prisma";
import { recalculateSchedule } from "@/lib/planning";

export const dynamic = "force-dynamic";

function parseReferenceDate(value: unknown): Date | null {
  if (value === undefined || value === null) {
    return startOfDay(new Date());
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = startOfDay(new Date(value));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function parseExamIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (ids.length === 0) {
    return null;
  }

  return [...new Set(ids)];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      examIds?: unknown;
      referenceDate?: unknown;
    };

    const examIds = parseExamIds(body.examIds);
    if (!examIds) {
      return NextResponse.json(
        { error: "examIds must be a non-empty string array" },
        { status: 400 },
      );
    }

    const referenceDate = parseReferenceDate(body.referenceDate);
    if (!referenceDate) {
      return NextResponse.json(
        { error: "referenceDate must be a valid date string" },
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

    const exams = await prisma.exam.findMany({
      where: {
        id: {
          in: examIds,
        },
        userId: user.id,
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (exams.length === 0) {
      return NextResponse.json(
        { error: "No eligible exams found for optimization" },
        { status: 404 },
      );
    }

    const results = await Promise.allSettled(
      exams.map((exam) =>
        recalculateSchedule(exam.id, {
          referenceDate,
        }),
      ),
    );

    const optimized: Array<{
      examId: string;
      examName: string;
      missingHours: number;
      sessionsCreated: number;
    }> = [];

    const failed: Array<{
      examId: string;
      examName: string;
      message: string;
    }> = [];

    results.forEach((result, index) => {
      const exam = exams[index];

      if (result.status === "fulfilled") {
        optimized.push({
          examId: exam.id,
          examName: exam.name,
          missingHours: result.value.missingHours,
          sessionsCreated: result.value.sessionsCreated,
        });
        return;
      }

      failed.push({
        examId: exam.id,
        examName: exam.name,
        message:
          result.reason instanceof Error
            ? result.reason.message
            : "Unknown optimization error",
      });
    });

    return NextResponse.json(
      {
        referenceDate: referenceDate.toISOString(),
        optimized,
        failed,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to optimize calendar:", error);
    return NextResponse.json(
      { error: "Failed to optimize calendar" },
      { status: 500 },
    );
  }
}
