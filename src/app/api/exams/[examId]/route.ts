import { NextRequest, NextResponse } from "next/server";
import { ExamStatus } from "@prisma/client";

import { recalculateSchedule } from "@/lib/planning";
import prisma from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/prisma-compat";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ examId: string }> },
) {
  try {
    const { examId } = await context.params;

    if (!examId || examId.trim().length === 0) {
      return NextResponse.json(
        { error: "examId is required" },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      status?: unknown;
    };

    const requestedStatus =
      typeof body.status === "string" ? body.status.trim().toUpperCase() : "";

    if (requestedStatus !== "ACTIVE") {
      return NextResponse.json(
        { error: "Only status=ACTIVE is supported for this endpoint" },
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

    const exam = await prisma.exam.findFirst({
      where: {
        id: examId.trim(),
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        status: true,
        courseId: true,
      },
    });

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    if (exam.status === ExamStatus.ACTIVE) {
      return NextResponse.json(
        {
          ok: true,
          restored: false,
          exam: {
            id: exam.id,
            name: exam.name,
            status: exam.status,
          },
        },
        { status: 200 },
      );
    }

    if (
      exam.status !== ExamStatus.COMPLETED &&
      exam.status !== ExamStatus.ARCHIVED
    ) {
      return NextResponse.json(
        { error: "Only completed or archived exams can be restored" },
        { status: 409 },
      );
    }

    const restored = await prisma.$transaction(async (tx) => {
      const updatedExam = await tx.exam.update({
        where: {
          id: exam.id,
        },
        data: {
          status: ExamStatus.ACTIVE,
          completedAt: null,
          grade: null,
        },
        select: {
          id: true,
          name: true,
          status: true,
          courseId: true,
        },
      });

      if (updatedExam.courseId) {
        const courseId = updatedExam.courseId;

        await tx.course
          .updateMany({
            where: {
              id: courseId,
              userId: user.id,
            },
            data: {
              isCompleted: false,
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
                userId: user.id,
              },
              data: {
                isCompleted: false,
              },
            });
          });
      }

      return {
        updatedExam,
        restoredTopicCount: 0,
      };
    });

    let recalculation: Awaited<ReturnType<typeof recalculateSchedule>> | null =
      null;
    let warning: string | null = null;

    try {
      recalculation = await recalculateSchedule(exam.id);
    } catch (error) {
      console.error("Failed to recalculate after exam restore:", error);
      warning =
        "Exam restored, but schedule recalculation failed. Please run recalibration.";
    }

    return NextResponse.json(
      {
        ok: true,
        restored: true,
        exam: {
          id: restored.updatedExam.id,
          name: restored.updatedExam.name,
          status: restored.updatedExam.status,
        },
        restoredTopicCount: restored.restoredTopicCount,
        recalculation,
        warning,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to restore exam:", error);
    return NextResponse.json(
      { error: "Failed to restore exam" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ examId: string }> },
) {
  try {
    const { examId } = await context.params;

    if (!examId || examId.trim().length === 0) {
      return NextResponse.json(
        { error: "examId is required" },
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

    const exam = await prisma.exam.findFirst({
      where: {
        id: examId.trim(),
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        courseId: true,
        _count: {
          select: {
            topics: true,
            study_sessions: true,
          },
        },
      },
    });

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.exam.delete({
        where: {
          id: exam.id,
        },
      });

      if (!exam.courseId) {
        return;
      }

      const [remainingExamCount, remainingIncompleteExamCount] =
        await Promise.all([
          tx.exam.count({
            where: {
              userId: user.id,
              courseId: exam.courseId,
            },
          }),
          tx.exam.count({
            where: {
              userId: user.id,
              courseId: exam.courseId,
              status: {
                not: "COMPLETED",
              },
            },
          }),
        ]);

      await tx.course.updateMany({
        where: {
          id: exam.courseId,
          userId: user.id,
        },
        data: {
          isCompleted:
            remainingExamCount > 0 && remainingIncompleteExamCount === 0,
        },
      });
    });

    return NextResponse.json(
      {
        ok: true,
        deleted: {
          id: exam.id,
          name: exam.name,
          topicsUnlinked: exam._count.topics,
          sessionsRemoved: exam._count.study_sessions,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to delete exam:", error);
    return NextResponse.json(
      { error: "Failed to delete exam" },
      { status: 500 },
    );
  }
}
