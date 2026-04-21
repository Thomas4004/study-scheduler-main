import prisma from "@/lib/prisma";

type PrismaClientLike = typeof prisma;

export type CourseGradeProjection = {
  courseId: string;
  completedExams: number;
  completedWeight: number;
  weightedContribution: number;
  projectedFinalGrade: number | null;
};

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export async function calculateCourseGrade(
  courseId: string,
  prismaClient: PrismaClientLike = prisma,
): Promise<CourseGradeProjection> {
  const completedExams = await prismaClient.exam.findMany({
    where: {
      courseId,
      status: "COMPLETED",
      grade: {
        not: null,
      },
    },
    select: {
      grade: true,
      weight: true,
    },
  });

  const normalized = completedExams.map((exam) => {
    const grade = exam.grade ?? 0;
    const weight = Number.isFinite(exam.weight) ? Math.max(0, exam.weight) : 0;
    return {
      grade,
      weight,
    };
  });

  const weightedContribution = normalized.reduce(
    (sum, exam) => sum + exam.grade * exam.weight,
    0,
  );
  const completedWeight = normalized.reduce(
    (sum, exam) => sum + exam.weight,
    0,
  );

  return {
    courseId,
    completedExams: normalized.length,
    completedWeight: round(completedWeight, 4),
    weightedContribution: round(weightedContribution, 4),
    projectedFinalGrade:
      completedWeight > 0
        ? round(weightedContribution / completedWeight, 2)
        : null,
  };
}
