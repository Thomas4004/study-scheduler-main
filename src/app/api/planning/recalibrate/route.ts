import { NextRequest, NextResponse } from "next/server";
import { startOfDay } from "date-fns";

import prisma from "@/lib/prisma";
import { recalculateSchedule, SmartSchedulerEngine } from "@/lib/planning";

const schedulerEngine = new SmartSchedulerEngine(prisma);
const EPSILON = 0.001;

function parseBlockedDays(value: unknown): number | null {
  if (value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 30) {
    return null;
  }

  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      examId?: unknown;
      blockedDays?: unknown;
    };

    const blockedDays = parseBlockedDays(body.blockedDays);
    if (blockedDays === null) {
      return NextResponse.json(
        { error: "blockedDays must be an integer between 0 and 30" },
        { status: 400 },
      );
    }

    const user = await prisma.user.findFirst({
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (typeof body.examId === "string" && body.examId.trim().length > 0) {
      const exam = await prisma.exam.findFirst({
        where: {
          id: body.examId,
          userId: user.id,
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (!exam) {
        return NextResponse.json({ error: "Exam not found" }, { status: 404 });
      }

      const recalculation = await recalculateSchedule(exam.id, {
        blockedDays,
      });
      const triage = await schedulerEngine.buildPlan(exam.id, {
        includeProgress: true,
        preserveLoggedSessions: true,
        dryRun: true,
        blockedDays,
      });

      return NextResponse.json(
        {
          scope: "single",
          exam,
          blockedDays,
          recalculation,
          triage,
        },
        { status: 200 },
      );
    }

    const today = startOfDay(new Date());

    const exams = await prisma.exam.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
        exam_date: {
          gte: today,
        },
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        exam_date: "asc",
      },
    });

    const results = await Promise.all(
      exams.map(async (exam) => {
        const recalculation = await recalculateSchedule(exam.id, {
          blockedDays,
        });
        const triage = await schedulerEngine.buildPlan(exam.id, {
          includeProgress: true,
          preserveLoggedSessions: true,
          dryRun: true,
          blockedDays,
        });

        return {
          exam,
          recalculation,
          triage,
        };
      }),
    );

    return NextResponse.json(
      {
        scope: "all",
        blockedDays,
        recalculated: results.length,
        withGapCount: results.filter(
          (entry) => entry.triage.missingHours > EPSILON,
        ).length,
        results,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to recalibrate study plan:", error);
    return NextResponse.json(
      { error: "Failed to recalibrate study plan" },
      { status: 500 },
    );
  }
}
