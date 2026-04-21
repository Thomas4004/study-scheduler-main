import prisma from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/prisma-compat";
import {
  simulateGraduation as runGraduationSimulation,
  type GraduationSimulationResult,
  type HypotheticalExamInput,
  type SimulationCurrentStats,
} from "@/lib/grade-simulation";

export const DEFAULT_GRADUATION_CFU_TARGET = 180;

type PrismaClientLike = typeof prisma;

type CompletedCourseStats = {
  id: string;
  name: string;
  cfu: number;
  isPassFail: boolean;
  finalGrade: number | null;
};

export type GlobalCareerStats = {
  graduationTargetCfu: number;
  totalCfu: number;
  cfuForAverage: number;
  cfuRemaining: number;
  progressPercent: number;
  weightedAverage: number | null;
  degreeBaseScore: number | null;
  completedCourses: CompletedCourseStats[];
};

export type {
  GraduationSimulationResult,
  HypotheticalExamInput,
  SimulationCurrentStats,
};

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeCourseGrade(value: number) {
  return Math.min(30, Math.max(0, value));
}

function calculateCourseFinalGrade(
  exams: Array<{ grade: number | null; weight: number }>,
) {
  const normalized = exams
    .filter((exam) => exam.grade !== null)
    .map((exam) => {
      const grade = normalizeCourseGrade(exam.grade ?? 0);
      const weight = Number.isFinite(exam.weight)
        ? Math.max(0, exam.weight)
        : 0;
      return { grade, weight };
    });

  const totalWeight = normalized.reduce((sum, exam) => sum + exam.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  const weightedSum = normalized.reduce(
    (sum, exam) => sum + exam.grade * exam.weight,
    0,
  );

  return round(weightedSum / totalWeight, 2);
}

export async function calculateGlobalStats(
  userId: string,
  prismaClient: PrismaClientLike = prisma,
): Promise<GlobalCareerStats> {
  let graduationTargetCfu = DEFAULT_GRADUATION_CFU_TARGET;

  try {
    const user = await prismaClient.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        degree_target_cfu: true,
      },
    });

    if (user?.degree_target_cfu && user.degree_target_cfu > 0) {
      graduationTargetCfu = user.degree_target_cfu;
    }
  } catch (error) {
    if (!isMissingColumnError(error, "degree_target_cfu")) {
      throw error;
    }
  }

  const completedCourses = await prismaClient.course.findMany({
    where: {
      userId,
      isCompleted: true,
    },
    select: {
      id: true,
      name: true,
      cfu: true,
      isPassFail: true,
      exams: {
        where: {
          status: "COMPLETED",
        },
        select: {
          grade: true,
          weight: true,
        },
      },
    },
    orderBy: [{ updated_at: "desc" }, { name: "asc" }],
  });

  const normalizedCourses: CompletedCourseStats[] = completedCourses.map(
    (course) => ({
      id: course.id,
      name: course.name,
      cfu: Math.max(0, course.cfu),
      isPassFail: course.isPassFail,
      finalGrade: calculateCourseFinalGrade(course.exams),
    }),
  );

  const totalCfu = normalizedCourses.reduce(
    (sum, course) => sum + course.cfu,
    0,
  );

  const averageCourses = normalizedCourses.filter(
    (course) =>
      !course.isPassFail && course.cfu > 0 && course.finalGrade !== null,
  );

  const weightedNumerator = averageCourses.reduce(
    (sum, course) => sum + (course.finalGrade ?? 0) * course.cfu,
    0,
  );
  const cfuForAverage = averageCourses.reduce(
    (sum, course) => sum + course.cfu,
    0,
  );

  const weightedAverage =
    cfuForAverage > 0 ? round(weightedNumerator / cfuForAverage, 2) : null;
  const degreeBaseScore =
    weightedAverage === null ? null : round((weightedAverage * 110) / 30, 2);

  return {
    graduationTargetCfu,
    totalCfu,
    cfuForAverage,
    cfuRemaining: Math.max(0, graduationTargetCfu - totalCfu),
    progressPercent:
      graduationTargetCfu > 0
        ? round(Math.min(100, (totalCfu / graduationTargetCfu) * 100), 2)
        : 0,
    weightedAverage,
    degreeBaseScore,
    completedCourses: normalizedCourses,
  };
}

export function simulateGraduation(
  currentStats: SimulationCurrentStats,
  hypotheticalExams: HypotheticalExamInput[],
): GraduationSimulationResult {
  return runGraduationSimulation(currentStats, hypotheticalExams);
}
