import { ExamStatus, StudySessionType } from "@prisma/client";
import { startOfDay } from "date-fns";

import prisma from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/prisma-compat";

type PrismaClientLike = typeof prisma;

export type CompleteExamInput = {
  examId: string;
  userId: string;
  grade?: number | null;
  completedAt?: Date;
  notes?: string | null;
};

export type CompletedExamSummary = {
  exam: {
    id: string;
    name: string;
    status: ExamStatus;
    grade: number | null;
    completedAt: string | null;
    notes: string | null;
  };
  stats: {
    totalHoursStudied: number;
    totalFocusMinutes: number;
    reviewSessionsExecuted: number;
    averageConfidence: number | null;
    removedFutureSessions: number;
  };
};

export class CompleteExamError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "CompleteExamError";
  }
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

export async function completeExamAndSummarize(
  input: CompleteExamInput,
  prismaClient: PrismaClientLike = prisma,
): Promise<CompletedExamSummary> {
  const exam = await prismaClient.exam.findFirst({
    where: {
      id: input.examId,
      userId: input.userId,
    },
    select: {
      id: true,
      name: true,
      courseId: true,
      status: true,
    },
  });

  if (!exam) {
    throw new CompleteExamError("Exam not found", 404);
  }

  if (exam.status !== ExamStatus.ACTIVE) {
    throw new CompleteExamError("Only active exams can be completed", 409);
  }

  const completedAt = input.completedAt ?? new Date();
  const completionDay = startOfDay(completedAt);

  const [hoursAggregate, reviewSessionsExecuted, confidenceAggregate] =
    await Promise.all([
      prismaClient.studySession.aggregate({
        where: {
          examId: exam.id,
          actual_hours: {
            gt: 0,
          },
        },
        _sum: {
          actual_hours: true,
        },
      }),
      prismaClient.studySession.count({
        where: {
          examId: exam.id,
          type: StudySessionType.REVIEW,
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
      }),
      prismaClient.studySession.aggregate({
        where: {
          examId: exam.id,
          type: StudySessionType.REVIEW,
          confidence_score: {
            not: null,
          },
        },
        _avg: {
          confidence_score: true,
        },
      }),
    ]);

  const totalHoursStudied = roundHours(hoursAggregate._sum.actual_hours ?? 0);
  const totalFocusMinutes = Math.max(0, Math.round(totalHoursStudied * 60));
  const averageConfidenceRaw = confidenceAggregate._avg.confidence_score;
  const averageConfidence =
    averageConfidenceRaw === null
      ? null
      : roundHours(Number(averageConfidenceRaw));

  const txResult = await prismaClient.$transaction(async (tx) => {
    const removedFutureSessions = await tx.studySession.deleteMany({
      where: {
        examId: exam.id,
        planned_date: {
          gt: completionDay,
        },
      },
    });

    const updatedExam = await tx.exam.update({
      where: {
        id: exam.id,
      },
      data: {
        status: ExamStatus.COMPLETED,
        grade: input.grade ?? null,
        completedAt,
        notes: input.notes ?? null,
      },
      select: {
        id: true,
        name: true,
        courseId: true,
        status: true,
        grade: true,
        completedAt: true,
        notes: true,
      },
    });

    if (updatedExam.courseId) {
      const courseId = updatedExam.courseId;

      const incompleteExams = await tx.exam.count({
        where: {
          userId: input.userId,
          courseId,
          status: {
            not: ExamStatus.COMPLETED,
          },
        },
      });

      await tx.course
        .updateMany({
          where: {
            id: courseId,
            userId: input.userId,
          },
          data: {
            isCompleted: incompleteExams === 0,
            isArchived: false,
          },
        })
        .catch(async (error) => {
          if (!isMissingColumnError(error, "isArchived")) {
            throw error;
          }

          await tx.course.updateMany({
            where: {
              id: courseId,
              userId: input.userId,
            },
            data: {
              isCompleted: incompleteExams === 0,
            },
          });
        });
    }

    return {
      updatedExam,
      removedFutureSessions: removedFutureSessions.count,
    };
  });

  return {
    exam: {
      id: txResult.updatedExam.id,
      name: txResult.updatedExam.name,
      status: txResult.updatedExam.status,
      grade: txResult.updatedExam.grade,
      completedAt: txResult.updatedExam.completedAt?.toISOString() ?? null,
      notes: txResult.updatedExam.notes,
    },
    stats: {
      totalHoursStudied,
      totalFocusMinutes,
      reviewSessionsExecuted,
      averageConfidence,
      removedFutureSessions: txResult.removedFutureSessions,
    },
  };
}
