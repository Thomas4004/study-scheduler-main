import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { format, startOfMonth } from "date-fns";
import { Sora, Space_Mono } from "next/font/google";

import {
  FullCalendarView,
  type CalendarCollisionArea,
  type CalendarExamMarker,
  type CalendarSessionItem,
} from "@/components/FullCalendarView";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GENERIC_STUDY_SESSION_NAME } from "@/lib/planning";
import prisma from "@/lib/prisma";
import { detectStudyLoadCollisions } from "@/lib/scheduler";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
});

function buildCalendarFeedUrl(token: string, incomingHeaders: Headers) {
  const forwardedProto = incomingHeaders.get("x-forwarded-proto");
  const proto =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : process.env.NODE_ENV === "production"
        ? "https"
        : "http";

  const host =
    incomingHeaders.get("x-forwarded-host") ??
    incomingHeaders.get("host") ??
    "localhost:3000";

  return `${proto}://${host}/api/calendar/${token}/feed.ics`;
}

async function getCalendarData() {
  const headerStore = await headers();

  const user = await prisma.user.findFirst({
    select: {
      id: true,
      calendar_feed_token: true,
    },
  });

  if (!user) {
    return null;
  }

  let feedToken = user.calendar_feed_token;
  if (!feedToken) {
    feedToken = randomUUID();
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        calendar_feed_token: feedToken,
      },
    });
  }

  const fromDate = startOfMonth(new Date());

  const [sessions, exams, collisions] = await Promise.all([
    prisma.studySession.findMany({
      where: {
        exam: {
          userId: user.id,
          status: "ACTIVE",
        },
        planned_date: {
          gte: fromDate,
        },
      },
      include: {
        exam: {
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
        topic: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ planned_date: "asc" }, { exam: { name: "asc" } }],
    }),
    prisma.exam.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
        exam_date: {
          gte: fromDate,
        },
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
    }),
    detectStudyLoadCollisions(user.id, {
      referenceDate: fromDate,
    }),
  ]);

  const initialSessions: CalendarSessionItem[] = sessions.map((session) => ({
    id: session.id,
    examId: session.examId,
    courseName: session.exam.course?.name ?? "Corso non assegnato",
    examName: session.exam.name,
    examColor: session.exam.color_code,
    topicId: session.topicId,
    topicName: session.is_placeholder
      ? GENERIC_STUDY_SESSION_NAME
      : (session.topic?.name ?? "General review"),
    isPlaceholder: session.is_placeholder,
    plannedDate: session.planned_date.toISOString(),
    plannedHours: session.planned_hours,
    type: session.type,
    isCompleted: session.is_completed,
  }));

  const examMarkers: CalendarExamMarker[] = exams.map((exam) => ({
    id: exam.id,
    name: exam.name,
    courseName: exam.course?.name ?? "Corso non assegnato",
    colorCode: exam.color_code,
    examDate: exam.exam_date.toISOString(),
  }));

  const collisionAreas: CalendarCollisionArea[] = collisions.map((entry) => ({
    dayKey: entry.dayKey,
    topicDensity: entry.topicDensity,
    threshold: entry.threshold,
    earlyStartSuggestionCount: entry.earlyStartSuggestions.length,
  }));

  return {
    initialSessions,
    examMarkers,
    collisionAreas,
    calendarFeedUrl: buildCalendarFeedUrl(feedToken, headerStore),
  };
}

export default async function CalendarPage() {
  const data = await getCalendarData();

  if (!data) {
    return (
      <Card className="border-zinc-900 bg-zinc-950/40 shadow-none">
        <CardHeader>
          <CardTitle>Calendar Studio</CardTitle>
          <CardDescription>
            Create a user profile and at least one exam to open your study
            calendar.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <h1
          className={cn(
            "text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl",
            sora.className,
          )}
        >
          Calendar Studio
        </h1>
        <p className="text-sm text-zinc-400">
          {format(new Date(), "EEEE, dd MMMM yyyy")}
        </p>
      </section>

      <section className="bento-rise">
        <FullCalendarView
          initialSessions={data.initialSessions}
          examMarkers={data.examMarkers}
          collisionAreas={data.collisionAreas}
          calendarFeedUrl={data.calendarFeedUrl}
          headingClassName={sora.className}
          monoClassName={spaceMono.className}
        />
      </section>
    </div>
  );
}
