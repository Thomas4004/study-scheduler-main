import { NextRequest, NextResponse } from "next/server";
import { startOfDay } from "date-fns";

import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await prisma.user.findFirst({
      select: {
        id: true,
      },
    });

    if (!user) {
      return NextResponse.json({ exams: [], topics: [] }, { status: 200 });
    }

    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const today = startOfDay(new Date());

    const exams = await prisma.exam.findMany({
      where: {
        userId: user.id,
        exam_date: {
          gte: today,
        },
        status: "ACTIVE",
        ...(q
          ? {
              name: {
                contains: q,
                mode: "insensitive" as const,
              },
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        color_code: true,
        exam_date: true,
        course: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        exam_date: "asc",
      },
      take: 30,
    });

    const topicRows = await prisma.topic.findMany({
      where: {
        exams: {
          some: {
            userId: user.id,
            status: "ACTIVE",
            exam_date: {
              gte: today,
            },
          },
        },
        ...(q
          ? {
              OR: [
                {
                  name: {
                    contains: q,
                    mode: "insensitive" as const,
                  },
                },
                {
                  exams: {
                    some: {
                      userId: user.id,
                      status: "ACTIVE",
                      exam_date: {
                        gte: today,
                      },
                      name: {
                        contains: q,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
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
      orderBy: [{ name: "asc" }],
      take: 80,
    });

    const topics = topicRows
      .map((topic) => {
        const primaryExam = topic.exams[0];
        if (!primaryExam) return null;

        return {
          id: topic.id,
          name: topic.name,
          examId: primaryExam.id,
          exam: {
            name: primaryExam.name,
            color_code: primaryExam.color_code,
            courseName: primaryExam.course?.name ?? "Corso non assegnato",
          },
        };
      })
      .filter((topic): topic is NonNullable<typeof topic> => topic !== null);

    const mappedExams = exams.map((exam) => ({
      id: exam.id,
      name: exam.name,
      color_code: exam.color_code,
      exam_date: exam.exam_date,
      courseName: exam.course?.name ?? "Corso non assegnato",
    }));

    return NextResponse.json(
      {
        exams: mappedExams,
        topics,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to load command palette data:", error);
    return NextResponse.json(
      { error: "Failed to load command palette data" },
      { status: 500 },
    );
  }
}
