import Link from "next/link";
import { addDays, format, isBefore, isSameDay, startOfDay } from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  GraduationCap,
  LibraryBig,
  Timer,
} from "lucide-react";

import { CollisionAlert } from "@/components/CollisionAlert";
import { TodayTaskList, type TodayTaskItem } from "@/components/TodayTaskList";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { calculateGlobalStats } from "@/lib/global-career-stats";
import prisma from "@/lib/prisma";
import { buildCollisionDashboardWarning } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

type FocusTopic = {
  id: string;
  name: string;
  courseName: string;
  examName: string;
  dueLabel: string;
  nextReview: string | null;
};

function buildDueLabel(nextReview: Date | null, today: Date) {
  if (!nextReview) {
    return "Nuovo topic";
  }

  if (isSameDay(nextReview, today)) {
    return "Due oggi";
  }

  if (isBefore(nextReview, today)) {
    return `In ritardo dal ${format(nextReview, "dd/MM")}`;
  }

  return `Ripasso ${format(nextReview, "dd/MM")}`;
}

async function getDashboardData() {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
      name: true,
    },
  });

  if (!user) {
    return {
      userId: null,
      userName: null,
      todayTasks: [] as TodayTaskItem[],
    };
  }

  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);

  const [collisionWarning, scheduledSessions] = await Promise.all([
    buildCollisionDashboardWarning(user.id, {
      referenceDate: today,
    }),
    prisma.studySession.findMany({
      where: {
        exam: {
          userId: user.id,
          status: "ACTIVE",
        },
        topic: {
          status: {
            in: ["TO_STUDY", "REVIEW"],
          },
        },
        planned_date: {
          lt: tomorrow,
        },
        is_placeholder: false,
        is_completed: false,
      },
      orderBy: [{ planned_date: "asc" }, { exam: { exam_date: "asc" } }],
      select: {
        examId: true,
        topicId: true,
        planned_date: true,
        topic: {
          select: {
            id: true,
            name: true,
            course: {
              select: {
                name: true,
              },
            },
          },
        },
        exam: {
          select: {
            course: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      take: 80,
    }),
  ]);

  const uniqueTodayTasks = new Map<string, TodayTaskItem>();

  for (const session of scheduledSessions) {
    if (!session.topic || !session.topicId) {
      continue;
    }

    const taskKey = `${session.examId}:${session.topicId}`;
    if (uniqueTodayTasks.has(taskKey)) {
      continue;
    }

    const courseName =
      session.topic.course?.name ??
      session.exam.course?.name ??
      "Corso non assegnato";

    uniqueTodayTasks.set(taskKey, {
      topicId: session.topic.id,
      topicTitle: session.topic.name,
      courseName,
      scheduledDate: session.planned_date.toISOString(),
    });
  }

  return {
    userId: user.id,
    userName: user.name,
    todayTasks: [...uniqueTodayTasks.values()],
    collisionWarning,
  };
}

export default async function DashboardPage() {
  const { userId, userName, todayTasks, collisionWarning } =
    await getDashboardData();

  if (!userId) {
    return (
      <Card className="border-zinc-900 bg-zinc-950/40 shadow-none">
        <CardHeader>
          <CardTitle>Esecuzione e Riflessione</CardTitle>
          <CardDescription>
            Crea un profilo utente e almeno un esame attivo per iniziare.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const careerStats = await calculateGlobalStats(userId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Workspace OS
        </p>
        <h1 className="text-2xl font-semibold text-zinc-100 sm:text-3xl">
          Ciao{userName ? `, ${userName}` : ""}
        </h1>
        <p className="text-sm text-zinc-400">
          {format(new Date(), "EEEE, dd MMMM")} • Panoramica veloce di oggi.
        </p>
      </section>

      <CollisionAlert warning={collisionWarning} />

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <TodayTaskList tasks={todayTasks} />

        <div className="space-y-5">
          <Card className="border-zinc-800 bg-zinc-900/70 shadow-none">
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2 text-zinc-100">
                <GraduationCap className="h-4 w-4" />
                Mini Libretto
              </CardTitle>
              <CardDescription className="text-zinc-400">
                Snapshot rapido della tua progressione universitaria.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Media
                </p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  {careerStats.weightedAverage !== null
                    ? careerStats.weightedAverage.toFixed(2)
                    : "-"}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                  CFU
                </p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  {careerStats.totalCfu}/{careerStats.graduationTargetCfu}
                </p>
              </div>
              <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>Progresso laurea</span>
                  <span>{careerStats.progressPercent.toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-emerald-400"
                    style={{ width: `${careerStats.progressPercent}%` }}
                  />
                </div>
              </div>
              <Button
                asChild
                variant="outline"
                className="col-span-2 border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-800"
              >
                <Link href="/libretto">
                  Apri Libretto
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/70 shadow-none">
            <CardHeader>
              <CardTitle className="text-zinc-100">Quick Links</CardTitle>
              <CardDescription className="text-zinc-400">
                Accessi veloci alle azioni operative principali.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button
                asChild
                className="justify-start bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
              >
                <Link href="/focus">
                  <Timer className="h-4 w-4" />
                  Avvia Focus
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="justify-start border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-800"
              >
                <Link href="/courses">
                  <LibraryBig className="h-4 w-4" />
                  Vai ai Corsi
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="justify-start border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-800"
              >
                <Link href="/add-exam">
                  <ArrowRight className="h-4 w-4" />
                  Aggiungi Esame
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="justify-start border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-800"
              >
                <Link href="/calendar">
                  <CalendarDays className="h-4 w-4" />
                  Apri Calendario
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
