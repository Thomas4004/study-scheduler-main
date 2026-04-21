import { ZenFocusMode } from "@/components/zen-focus-mode";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getZenFocusData(topicId: string, preferredExamId?: string) {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
      max_focus_minutes: true,
    },
  });

  if (!user) {
    return null;
  }

  const topic = await prisma.topic.findFirst({
    where: {
      id: topicId,
      exams: {
        some: {
          userId: user.id,
          status: "ACTIVE",
        },
      },
    },
    select: {
      id: true,
      name: true,
      exams: {
        where: {
          ...(preferredExamId
            ? {
                id: preferredExamId,
              }
            : {}),
          userId: user.id,
          status: "ACTIVE",
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
  });

  const primaryExam =
    topic?.exams.find((exam) => exam.id === preferredExamId) ??
    topic?.exams[0] ??
    null;

  if (!topic || !primaryExam) {
    return null;
  }

  return {
    maxFocusMinutes: user.max_focus_minutes,
    topic: {
      id: topic.id,
      name: topic.name,
    },
    exam: {
      id: primaryExam.id,
      name: primaryExam.name,
      colorCode: primaryExam.color_code,
    },
    courseName: primaryExam.course?.name ?? "Corso non assegnato",
  };
}

export default async function TopicZenFocusPage({
  params,
  searchParams,
}: {
  params: Promise<{ topicId: string }>;
  searchParams?: Promise<{ autostart?: string; examId?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const data = await getZenFocusData(
    resolvedParams.topicId,
    resolvedSearchParams?.examId,
  );

  if (!data) {
    return (
      <section className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950 px-6 text-center text-zinc-100">
        <div className="max-w-md space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <h1 className="text-xl font-semibold">Zen Mode non disponibile</h1>
          <p className="text-sm text-zinc-400">
            Questo topic non e collegato a un esame attivo oppure non esiste.
          </p>
        </div>
      </section>
    );
  }

  return (
    <ZenFocusMode
      topic={data.topic}
      exam={data.exam}
      courseName={data.courseName}
      maxFocusMinutes={data.maxFocusMinutes}
      autoStart={resolvedSearchParams?.autostart === "1"}
    />
  );
}
