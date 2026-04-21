import Link from "next/link";

import { ArchivedCourseCard } from "@/components/archived-course-card";
import { ArchivedExamCard } from "@/components/archived-exam-card";
import { ArchivedTopicCard } from "@/components/archived-topic-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import prisma from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/prisma-compat";

export const dynamic = "force-dynamic";

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

async function getArchiveData() {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    return {
      archivedExams: [] as Array<{
        exam: {
          id: string;
          name: string;
          colorCode: string;
          status: "COMPLETED" | "ARCHIVED";
          grade: number | null;
          completedAt: string | null;
          notes: string | null;
          totalTopics: number;
        };
        stats: {
          totalStudyHours: number;
          totalFocusMinutes: number;
          reviewSessionsExecuted: number;
          averageFinalConfidence: number | null;
        };
      }>,
      archivedCourses: [] as Array<{
        id: string;
        name: string;
        cfu: number;
        isCompleted: boolean;
        examCount: number;
        topicCount: number;
        updatedAt: string;
      }>,
      archivedTopics: [] as Array<{
        id: string;
        name: string;
        courseName: string;
        linkedExams: number;
        updatedAt: string;
      }>,
    };
  }

  let archivedCourses: Array<{
    id: string;
    name: string;
    cfu: number;
    isCompleted: boolean;
    updated_at: Date;
    _count: {
      exams: number;
      topics: number;
    };
  }> = [];

  try {
    archivedCourses = await prisma.course.findMany({
      where: {
        userId: user.id,
        isArchived: true,
      },
      select: {
        id: true,
        name: true,
        cfu: true,
        isCompleted: true,
        updated_at: true,
        _count: {
          select: {
            exams: true,
            topics: true,
          },
        },
      },
      orderBy: [{ updated_at: "desc" }, { name: "asc" }],
    });
  } catch (error) {
    if (!isMissingColumnError(error, "isArchived")) {
      throw error;
    }
  }

  const archivedExams = await prisma.exam.findMany({
    where: {
      userId: user.id,
      status: {
        in: ["COMPLETED", "ARCHIVED"],
      },
    },
    select: {
      id: true,
      name: true,
      color_code: true,
      status: true,
      grade: true,
      completedAt: true,
      notes: true,
      exam_date: true,
      _count: {
        select: {
          topics: true,
        },
      },
    },
    orderBy: [{ completedAt: "desc" }, { exam_date: "desc" }],
  });

  const archivedTopics = await prisma.topic.findMany({
    where: {
      status: "ARCHIVED",
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
      updated_at: true,
      course: {
        select: {
          name: true,
        },
      },
      exams: {
        where: {
          userId: user.id,
        },
        take: 1,
        select: {
          course: {
            select: {
              name: true,
            },
          },
        },
      },
      _count: {
        select: {
          exams: true,
        },
      },
    },
    orderBy: [{ updated_at: "desc" }, { name: "asc" }],
  });

  const examIds = archivedExams.map((exam) => exam.id);

  const [studyHoursRows, reviewRows, confidenceRows] =
    examIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          prisma.studySession.groupBy({
            by: ["examId"],
            where: {
              examId: {
                in: examIds,
              },
            },
            _sum: {
              actual_hours: true,
            },
          }),
          prisma.studySession.groupBy({
            by: ["examId"],
            where: {
              examId: {
                in: examIds,
              },
              type: "REVIEW",
              OR: [
                {
                  actual_hours: {
                    gt: 0,
                  },
                },
                {
                  is_completed: true,
                },
              ],
            },
            _count: {
              _all: true,
            },
          }),
          prisma.studySession.groupBy({
            by: ["examId"],
            where: {
              examId: {
                in: examIds,
              },
              type: "REVIEW",
              confidence_score: {
                not: null,
              },
            },
            _avg: {
              confidence_score: true,
            },
          }),
        ]);

  const studyHoursByExam = new Map<string, number>();
  for (const row of studyHoursRows) {
    studyHoursByExam.set(row.examId, row._sum.actual_hours ?? 0);
  }

  const reviewCountByExam = new Map<string, number>();
  for (const row of reviewRows) {
    reviewCountByExam.set(row.examId, row._count._all ?? 0);
  }

  const confidenceByExam = new Map<string, number | null>();
  for (const row of confidenceRows) {
    confidenceByExam.set(
      row.examId,
      row._avg.confidence_score === null
        ? null
        : Number(row._avg.confidence_score),
    );
  }

  return {
    archivedExams: archivedExams.map((exam) => {
      const totalStudyHours = roundHours(studyHoursByExam.get(exam.id) ?? 0);
      const averageFinalConfidence = confidenceByExam.get(exam.id) ?? null;

      return {
        exam: {
          id: exam.id,
          name: exam.name,
          colorCode: exam.color_code,
          status: exam.status,
          grade: exam.grade,
          completedAt: exam.completedAt?.toISOString() ?? null,
          notes: exam.notes,
          totalTopics: exam._count.topics,
        },
        stats: {
          totalStudyHours,
          totalFocusMinutes: Math.max(0, Math.round(totalStudyHours * 60)),
          reviewSessionsExecuted: reviewCountByExam.get(exam.id) ?? 0,
          averageFinalConfidence:
            averageFinalConfidence === null
              ? null
              : roundHours(averageFinalConfidence),
        },
      };
    }),
    archivedCourses: archivedCourses.map((course) => ({
      id: course.id,
      name: course.name,
      cfu: course.cfu,
      isCompleted: course.isCompleted,
      examCount: course._count.exams,
      topicCount: course._count.topics,
      updatedAt: course.updated_at.toISOString(),
    })),
    archivedTopics: archivedTopics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      courseName:
        topic.course?.name ??
        topic.exams[0]?.course?.name ??
        "Corso non assegnato",
      linkedExams: topic._count.exams,
      updatedAt: topic.updated_at.toISOString(),
    })),
  };
}

export default async function ArchivePage() {
  const { archivedExams, archivedCourses, archivedTopics } =
    await getArchiveData();

  const totalHours = archivedExams.reduce(
    (sum, item) => sum + item.stats.totalStudyHours,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Archive</h1>
          <p className="text-sm text-muted-foreground">
            Completed exams with final metrics and reflective notes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border/70 bg-card px-3 py-1 text-xs text-muted-foreground">
            {archivedCourses.length} archived course(s)
          </span>
          <span className="rounded-full border border-border/70 bg-card px-3 py-1 text-xs text-muted-foreground">
            {archivedExams.length} archived exam(s)
          </span>
          <span className="rounded-full border border-border/70 bg-card px-3 py-1 text-xs text-muted-foreground">
            {archivedTopics.length} archived topic(s)
          </span>
          <span className="rounded-full border border-border/70 bg-card px-3 py-1 text-xs text-muted-foreground">
            {roundHours(totalHours).toFixed(1)}h total study
          </span>
        </div>
      </div>

      {archivedCourses.length === 0 &&
      archivedExams.length === 0 &&
      archivedTopics.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Archive is empty</CardTitle>
            <CardDescription>
              Complete an exam to move it here with final study stats.
            </CardDescription>
            <div className="pt-2">
              <Button asChild variant="outline">
                <Link href="/exams">Go to Exams</Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-6">
          {archivedCourses.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Archived Courses</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {archivedCourses.map((course) => (
                  <ArchivedCourseCard key={course.id} course={course} />
                ))}
              </div>
            </section>
          ) : null}

          {archivedExams.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Archived Exams</h2>
              <div className="grid gap-4">
                {archivedExams.map((item) => (
                  <ArchivedExamCard
                    key={item.exam.id}
                    exam={item.exam}
                    stats={item.stats}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {archivedTopics.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Archived Topics</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {archivedTopics.map((topic) => (
                  <ArchivedTopicCard key={topic.id} topic={topic} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
