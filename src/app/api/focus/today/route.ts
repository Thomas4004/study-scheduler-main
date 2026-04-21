import { NextResponse } from "next/server";
import { isBefore, isSameDay, startOfDay } from "date-fns";

import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

function buildDueLabel(nextReview: Date | null, today: Date) {
  if (!nextReview) {
    return "Nuovo topic";
  }

  if (isSameDay(nextReview, today)) {
    return "Due oggi";
  }

  if (isBefore(nextReview, today)) {
    return "In ritardo";
  }

  return "Programmato";
}

export async function GET() {
  try {
    const user = await prisma.user.findFirst({
      select: {
        id: true,
        max_focus_minutes: true,
        energy_curve: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const today = startOfDay(new Date());

    const topics = await prisma.topic.findMany({
      where: {
        status: {
          in: ["TO_STUDY", "REVIEW"],
        },
        exams: {
          some: {
            userId: user.id,
            status: "ACTIVE",
            exam_date: {
              gte: today,
            },
          },
        },
        OR: [
          {
            next_review: null,
          },
          {
            next_review: {
              lte: today,
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        next_review: true,
        difficulty_weight: true,
        exams: {
          where: {
            userId: user.id,
            status: "ACTIVE",
            exam_date: {
              gte: today,
            },
          },
          orderBy: {
            exam_date: "asc",
          },
          take: 1,
          select: {
            id: true,
            name: true,
            color_code: true,
            course: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [
        {
          next_review: "asc",
        },
        {
          difficulty_weight: "desc",
        },
      ],
      take: 30,
    });

    const queue = topics
      .map((topic) => {
        const exam = topic.exams[0];
        if (!exam) return null;

        return {
          id: topic.id,
          name: topic.name,
          dueLabel: buildDueLabel(topic.next_review, today),
          exam: {
            id: exam.id,
            name: exam.name,
            colorCode: exam.color_code,
            courseName: exam.course?.name ?? "Corso non assegnato",
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const nextTopic = queue[0] ?? null;

    return NextResponse.json(
      {
        maxFocusMinutes: user.max_focus_minutes,
        energyCurve: user.energy_curve,
        topicCount: queue.length,
        nextTopic,
        queue,
        // Legacy keys kept for compatibility while clients migrate.
        sessionCount: queue.length,
        nextSession: null,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to load focus mode data:", error);
    return NextResponse.json(
      { error: "Failed to load focus mode data" },
      { status: 500 },
    );
  }
}
