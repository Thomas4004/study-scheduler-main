import Link from "next/link";

import prisma from "@/lib/prisma";
import { estimateTotalStudyHours } from "@/lib/planning";
import {
  ExamQuickActionsGrid,
  type ExamQuickActionItem,
} from "@/components/exam-quick-actions-grid";
import { QuickAddExamEntry } from "@/components/quick-add-exam-entry";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

async function getExamsData() {
  const user = await prisma.user.findFirst({
    select: { id: true },
  });

  if (!user) {
    return {
      exams: [] as ExamQuickActionItem[],
    };
  }

  const exams = await prisma.exam.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
    },
    include: {
      course: {
        select: {
          cfu: true,
          name: true,
        },
      },
      _count: {
        select: {
          topics: true,
        },
      },
    },
    orderBy: {
      exam_date: "asc",
    },
  });

  const studied = await prisma.studySession.groupBy({
    by: ["examId"],
    where: {
      examId: {
        in: exams.map((exam) => exam.id),
      },
    },
    _sum: {
      actual_hours: true,
    },
  });

  const studiedByExam = new Map<string, number>();
  for (const row of studied) {
    studiedByExam.set(row.examId, row._sum.actual_hours ?? 0);
  }

  return {
    exams: exams.map((exam) => {
      const weightedCourseCfu = (exam.course?.cfu ?? 6) * exam.weight;
      const required = estimateTotalStudyHours(
        weightedCourseCfu,
        exam.difficulty,
      );
      const completed = studiedByExam.get(exam.id) ?? 0;
      const progress =
        required > 0 ? Math.min(100, (completed / required) * 100) : 0;

      return {
        id: exam.id,
        name: exam.name,
        courseName: exam.course?.name ?? null,
        colorCode: exam.color_code,
        examDate: exam.exam_date.toISOString(),
        topicCount: exam._count.topics,
        requiredHours: required,
        completedHours: completed,
        progressPercent: progress,
      };
    }),
  };
}

export default async function ExamsPage() {
  const { exams } = await getExamsData();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Exams</h1>
          <p className="text-sm text-muted-foreground">
            Centralized view of all exams, workload and triage status.
          </p>
        </div>

        <Button asChild>
          <Link href="/add-exam">Add Exam</Link>
        </Button>
      </div>

      <QuickAddExamEntry />

      {exams.length === 0 ? (
        <Card className="rounded-xl border border-border bg-card text-card-foreground">
          <CardHeader>
            <CardTitle>No active exams</CardTitle>
            <CardDescription>
              Create a new exam or review completed ones in the archive.
            </CardDescription>
            <div className="pt-2">
              <Button asChild variant="outline">
                <Link href="/archive">Open Archive</Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : (
        <ExamQuickActionsGrid initialExams={exams} />
      )}
    </div>
  );
}
