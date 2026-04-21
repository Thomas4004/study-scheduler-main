import { ExamStatus } from "@prisma/client";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import {
  addDays,
  differenceInCalendarDays,
  startOfDay,
  subDays,
} from "date-fns";
import { NextResponse } from "next/server";
import { z } from "zod";

import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYSTEM_PROMPT =
  "Sei StudyOS Copilot, l'assistente accademico dell'utente. Hai una Context Window enorme: sfrutta i tools per leggere i dati grezzi dal database e fai calcoli precisi prima di rispondere. Sii diretto e conciso.";

const DEFAULT_COLLISION_THRESHOLD = 5;
const LOW_DENSITY_DAY_THRESHOLD = 2;

const requestSchema = z.object({
  messages: z.array(z.unknown()).min(1),
});

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toIso(value: Date | null | undefined) {
  if (!value) return null;
  return value.toISOString();
}

function toDayKey(value: Date) {
  return startOfDay(value).toISOString().slice(0, 10);
}

function resolveGeminiApiKey() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ?? "";

  const looksLikePlaceholder =
    apiKey.length === 0 ||
    /^incolla-qui/i.test(apiKey) ||
    /^your[-_ ]?google[-_ ]?api[-_ ]?key$/i.test(apiKey);

  return {
    apiKey,
    looksLikePlaceholder,
  };
}

function resolveModelId() {
  const candidate = process.env.STUDY_COPILOT_MODEL?.trim();
  if (candidate && candidate.length > 0) {
    return candidate;
  }

  return "gemini-2.5-flash";
}

function calculateCourseFinalGrade(
  exams: Array<{ status: ExamStatus; grade: number | null; weight: number }>,
) {
  const completed = exams
    .filter(
      (exam) => exam.status === ExamStatus.COMPLETED && exam.grade !== null,
    )
    .map((exam) => ({
      grade: Math.max(0, Math.min(30, exam.grade ?? 0)),
      weight: Number.isFinite(exam.weight) ? Math.max(0, exam.weight) : 0,
    }));

  const totalWeight = completed.reduce((sum, exam) => sum + exam.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  const weightedSum = completed.reduce(
    (sum, exam) => sum + exam.grade * exam.weight,
    0,
  );

  return round(weightedSum / totalWeight, 2);
}

function calculateCareerStatsFromSnapshot(input: {
  graduationTargetCfu: number;
  courses: Array<{
    cfu: number;
    isPassFail: boolean;
    isCompleted: boolean;
    exams: Array<{ status: ExamStatus; grade: number | null; weight: number }>;
  }>;
}) {
  const completedCourses = input.courses.filter((course) => course.isCompleted);

  const normalizedCompletedCourses = completedCourses.map((course) => ({
    cfu: Math.max(0, course.cfu),
    isPassFail: course.isPassFail,
    finalGrade: calculateCourseFinalGrade(course.exams),
  }));

  const totalCfu = normalizedCompletedCourses.reduce(
    (sum, course) => sum + course.cfu,
    0,
  );

  const averageCourses = normalizedCompletedCourses.filter(
    (course) =>
      !course.isPassFail && course.cfu > 0 && course.finalGrade !== null,
  );

  const cfuForAverage = averageCourses.reduce(
    (sum, course) => sum + course.cfu,
    0,
  );
  const weightedNumerator = averageCourses.reduce(
    (sum, course) => sum + (course.finalGrade ?? 0) * course.cfu,
    0,
  );

  const weightedAverage =
    cfuForAverage > 0 ? round(weightedNumerator / cfuForAverage, 2) : null;
  const degreeBaseScore =
    weightedAverage === null ? null : round((weightedAverage * 110) / 30, 2);

  const graduationTargetCfu = Math.max(0, input.graduationTargetCfu);

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
  };
}

const getFullContextInputSchema = z.object({});

const detectCollisionsInputSchema = z.object({
  threshold: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(DEFAULT_COLLISION_THRESHOLD),
  horizonDays: z.number().int().min(7).max(30).default(14),
});

const tools = {
  getFullContext: tool({
    description:
      "Recupera un contesto completo in un unico snapshot: corsi, esami attivi e statistiche aggregate del libretto.",
    inputSchema: getFullContextInputSchema,
    execute: async () => {
      const today = startOfDay(new Date());

      const user = await prisma.user.findFirst({
        select: {
          id: true,
          name: true,
          energy_curve: true,
          degree_target_cfu: true,
          weekly_hours_template: true,
          updated_at: true,
          courses: {
            where: {
              isArchived: false,
            },
            orderBy: [{ updated_at: "desc" }, { name: "asc" }],
            select: {
              id: true,
              name: true,
              cfu: true,
              isPassFail: true,
              isCompleted: true,
              isArchived: true,
              resourceLink: true,
              updated_at: true,
              topics: {
                orderBy: [{ difficulty_weight: "desc" }, { name: "asc" }],
                select: {
                  id: true,
                  name: true,
                  status: true,
                  difficulty_weight: true,
                  next_review: true,
                  interval_days: true,
                  ease_factor: true,
                },
              },
              exams: {
                where: {
                  status: {
                    in: [ExamStatus.ACTIVE, ExamStatus.COMPLETED],
                  },
                },
                orderBy: [{ exam_date: "asc" }, { name: "asc" }],
                select: {
                  id: true,
                  name: true,
                  status: true,
                  exam_date: true,
                  difficulty: true,
                  intensity: true,
                  buffer_days: true,
                  weight: true,
                  grade: true,
                  completedAt: true,
                  color_code: true,
                  updated_at: true,
                },
              },
            },
          },
          exams: {
            where: {
              status: ExamStatus.ACTIVE,
            },
            orderBy: [{ exam_date: "asc" }, { name: "asc" }],
            select: {
              id: true,
              name: true,
              status: true,
              exam_date: true,
              difficulty: true,
              intensity: true,
              buffer_days: true,
              weight: true,
              color_code: true,
              setup_source: true,
              updated_at: true,
              course: {
                select: {
                  id: true,
                  name: true,
                  cfu: true,
                },
              },
              topics: {
                orderBy: [{ difficulty_weight: "desc" }, { name: "asc" }],
                select: {
                  id: true,
                  name: true,
                  status: true,
                  difficulty_weight: true,
                  next_review: true,
                  interval_days: true,
                  ease_factor: true,
                },
              },
              study_sessions: {
                where: {
                  planned_date: {
                    gte: subDays(today, 1),
                    lte: addDays(today, 30),
                  },
                },
                orderBy: [{ planned_date: "asc" }],
                select: {
                  id: true,
                  planned_date: true,
                  planned_hours: true,
                  actual_hours: true,
                  type: true,
                  is_placeholder: true,
                  is_completed: true,
                  topicId: true,
                },
              },
            },
          },
        },
      });

      if (!user) {
        return {
          error: "User not found",
        };
      }

      const careerStats = calculateCareerStatsFromSnapshot({
        graduationTargetCfu: user.degree_target_cfu,
        courses: user.courses.map((course) => ({
          cfu: course.cfu,
          isPassFail: course.isPassFail,
          isCompleted: course.isCompleted,
          exams: course.exams.map((exam) => ({
            status: exam.status,
            grade: exam.grade,
            weight: exam.weight,
          })),
        })),
      });

      const serializedCourses = user.courses.map((course) => ({
        id: course.id,
        name: course.name,
        cfu: course.cfu,
        isPassFail: course.isPassFail,
        isCompleted: course.isCompleted,
        isArchived: course.isArchived,
        resourceLink: course.resourceLink,
        updatedAt: toIso(course.updated_at),
        topics: course.topics.map((topic) => ({
          id: topic.id,
          name: topic.name,
          status: topic.status,
          difficultyWeight: topic.difficulty_weight,
          nextReview: toIso(topic.next_review),
          intervalDays: topic.interval_days,
          easeFactor: topic.ease_factor,
        })),
        exams: course.exams.map((exam) => ({
          id: exam.id,
          name: exam.name,
          status: exam.status,
          examDate: toIso(exam.exam_date),
          difficulty: exam.difficulty,
          intensity: exam.intensity,
          bufferDays: exam.buffer_days,
          weight: exam.weight,
          grade: exam.grade,
          completedAt: toIso(exam.completedAt),
          colorCode: exam.color_code,
          updatedAt: toIso(exam.updated_at),
        })),
      }));

      const serializedActiveExams = user.exams.map((exam) => ({
        id: exam.id,
        name: exam.name,
        status: exam.status,
        examDate: toIso(exam.exam_date),
        difficulty: exam.difficulty,
        intensity: exam.intensity,
        bufferDays: exam.buffer_days,
        weight: exam.weight,
        colorCode: exam.color_code,
        setupSource: exam.setup_source,
        updatedAt: toIso(exam.updated_at),
        course: exam.course,
        topics: exam.topics.map((topic) => ({
          id: topic.id,
          name: topic.name,
          status: topic.status,
          difficultyWeight: topic.difficulty_weight,
          nextReview: toIso(topic.next_review),
          intervalDays: topic.interval_days,
          easeFactor: topic.ease_factor,
        })),
        studySessionsWindow: exam.study_sessions.map((session) => ({
          id: session.id,
          plannedDate: toIso(session.planned_date),
          plannedHours: session.planned_hours,
          actualHours: session.actual_hours,
          type: session.type,
          isPlaceholder: session.is_placeholder,
          isCompleted: session.is_completed,
          topicId: session.topicId,
        })),
      }));

      return {
        generatedAt: new Date().toISOString(),
        user: {
          id: user.id,
          name: user.name,
          energyCurve: user.energy_curve,
          graduationTargetCfu: user.degree_target_cfu,
          weeklyHoursTemplate: user.weekly_hours_template,
          updatedAt: toIso(user.updated_at),
        },
        summary: {
          totalCourses: serializedCourses.length,
          completedCourses: serializedCourses.filter(
            (course) => course.isCompleted,
          ).length,
          activeExamCount: serializedActiveExams.length,
          totalTopicCount: serializedCourses.reduce(
            (sum, course) => sum + course.topics.length,
            0,
          ),
        },
        careerStats,
        courses: serializedCourses,
        activeExams: serializedActiveExams,
      };
    },
  }),

  detectCollisions: tool({
    description:
      "Recupera i topic pianificati nei prossimi giorni e segnala le aree di collisione in base a una soglia topic/giorno.",
    inputSchema: detectCollisionsInputSchema,
    execute: async ({ threshold, horizonDays }) => {
      const today = startOfDay(new Date());
      const horizonEnd = startOfDay(addDays(today, horizonDays - 1));

      const user = await prisma.user.findFirst({
        select: {
          id: true,
        },
      });

      if (!user) {
        return {
          error: "User not found",
        };
      }

      const sessions = await prisma.studySession.findMany({
        where: {
          exam: {
            userId: user.id,
            status: ExamStatus.ACTIVE,
            exam_date: {
              gte: today,
            },
          },
          planned_date: {
            gte: today,
            lte: horizonEnd,
          },
          is_placeholder: false,
          is_completed: false,
          topicId: {
            not: null,
          },
        },
        orderBy: [{ planned_date: "asc" }],
        select: {
          examId: true,
          topicId: true,
          planned_date: true,
          exam: {
            select: {
              id: true,
              name: true,
              exam_date: true,
              course: {
                select: {
                  name: true,
                },
              },
            },
          },
          topic: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const dayBuckets = new Map<
        string,
        {
          date: Date;
          topicKeys: Set<string>;
          topics: Array<{
            examId: string;
            examName: string;
            courseName: string;
            examDate: string;
            topicId: string;
            topicName: string;
          }>;
        }
      >();

      for (const session of sessions) {
        if (!session.topicId || !session.topic) {
          continue;
        }

        const day = startOfDay(session.planned_date);
        const dayKey = toDayKey(day);
        const topicKey = `${session.examId}:${session.topicId}`;

        const current = dayBuckets.get(dayKey);
        if (!current) {
          dayBuckets.set(dayKey, {
            date: day,
            topicKeys: new Set([topicKey]),
            topics: [
              {
                examId: session.exam.id,
                examName: session.exam.name,
                courseName: session.exam.course?.name ?? "Corso non assegnato",
                examDate: session.exam.exam_date.toISOString(),
                topicId: session.topic.id,
                topicName: session.topic.name,
              },
            ],
          });
          continue;
        }

        if (current.topicKeys.has(topicKey)) {
          continue;
        }

        current.topicKeys.add(topicKey);
        current.topics.push({
          examId: session.exam.id,
          examName: session.exam.name,
          courseName: session.exam.course?.name ?? "Corso non assegnato",
          examDate: session.exam.exam_date.toISOString(),
          topicId: session.topic.id,
          topicName: session.topic.name,
        });
      }

      const dailyTimeline: Array<{
        dayKey: string;
        date: string;
        topicCount: number;
        topics: Array<{
          examId: string;
          examName: string;
          courseName: string;
          examDate: string;
          topicId: string;
          topicName: string;
        }>;
      }> = [];

      let cursor = new Date(today);
      while (differenceInCalendarDays(horizonEnd, cursor) >= 0) {
        const day = startOfDay(cursor);
        const dayKey = toDayKey(day);
        const bucket = dayBuckets.get(dayKey);

        dailyTimeline.push({
          dayKey,
          date: day.toISOString(),
          topicCount: bucket?.topicKeys.size ?? 0,
          topics: bucket?.topics ?? [],
        });

        cursor = addDays(cursor, 1);
      }

      const mutableDensity = new Map(
        dailyTimeline.map((day) => [day.dayKey, day.topicCount]),
      );

      const collisions = dailyTimeline
        .filter((day) => day.topicCount > threshold)
        .map((day) => {
          const sortedTopics = [...day.topics].sort(
            (a, b) =>
              new Date(b.examDate).getTime() - new Date(a.examDate).getTime(),
          );

          const earlyStartSuggestions: Array<{
            topicId: string;
            topicName: string;
            examId: string;
            examName: string;
            courseName: string;
            fromDate: string;
            suggestedDate: string;
            daysEarly: number;
          }> = [];

          for (const topic of sortedTopics) {
            const candidate = [...dailyTimeline]
              .filter(
                (entry) =>
                  new Date(entry.date).getTime() < new Date(day.date).getTime(),
              )
              .sort(
                (a, b) =>
                  new Date(b.date).getTime() - new Date(a.date).getTime(),
              )
              .find((entry) => {
                const density =
                  mutableDensity.get(entry.dayKey) ?? entry.topicCount;
                return density < LOW_DENSITY_DAY_THRESHOLD;
              });

            if (!candidate) {
              continue;
            }

            const density =
              mutableDensity.get(candidate.dayKey) ?? candidate.topicCount;
            mutableDensity.set(candidate.dayKey, density + 1);

            earlyStartSuggestions.push({
              topicId: topic.topicId,
              topicName: topic.topicName,
              examId: topic.examId,
              examName: topic.examName,
              courseName: topic.courseName,
              fromDate: day.date,
              suggestedDate: candidate.date,
              daysEarly: Math.max(
                0,
                differenceInCalendarDays(
                  new Date(day.date),
                  new Date(candidate.date),
                ),
              ),
            });

            if (earlyStartSuggestions.length >= 4) {
              break;
            }
          }

          return {
            dayKey: day.dayKey,
            date: day.date,
            topicCount: day.topicCount,
            threshold,
            overloadedBy: day.topicCount - threshold,
            topics: day.topics,
            earlyStartSuggestions,
          };
        });

      return {
        computedAt: new Date().toISOString(),
        horizonDays,
        threshold,
        dailyTimeline,
        collisions,
      };
    },
  }),
};

export async function POST(request: Request) {
  try {
    const { looksLikePlaceholder } = resolveGeminiApiKey();
    if (looksLikePlaceholder) {
      return NextResponse.json(
        {
          error:
            "GOOGLE_GENERATIVE_AI_API_KEY non configurata correttamente. Inserisci una chiave reale di Google AI Studio.",
        },
        { status: 500 },
      );
    }

    const rawBody = (await request.json().catch(() => null)) as unknown;
    const parsedBody = requestSchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "Payload chat non valido: messages obbligatorio.",
        },
        { status: 400 },
      );
    }

    const modelMessages = await convertToModelMessages(
      parsedBody.data.messages as Array<UIMessage>,
    );

    const maxSteps = 3;

    const result = streamText({
      model: google(resolveModelId()),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      tools,
      // In AI SDK v6 il limite step e gestito con stopWhen + stepCountIs.
      stopWhen: stepCountIs(maxSteps),
      temperature: 0.2,
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error("StudyOS Copilot stream error:", error);
        return "Errore durante la generazione della risposta del Copilot.";
      },
    });
  } catch (error) {
    console.error("Failed to handle /api/chat request:", error);

    return NextResponse.json(
      {
        error: "Impossibile completare la richiesta del Copilot.",
      },
      { status: 500 },
    );
  }
}
