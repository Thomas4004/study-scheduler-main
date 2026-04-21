import { AddExamForm } from "@/components/add-exam-form";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getAddExamData() {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    return {
      userId: null as string | null,
      courses: [] as Array<{
        id: string;
        name: string;
        topics: Array<{
          id: string;
          name: string;
          difficulty_weight: number;
          status: "TO_STUDY" | "REVIEW" | "MASTERED" | "ARCHIVED";
        }>;
      }>,
    };
  }

  const courses = await prisma.course.findMany({
    where: {
      userId: user.id,
    },
    orderBy: [{ name: "asc" }, { created_at: "asc" }],
    select: {
      id: true,
      name: true,
      topics: {
        orderBy: [{ status: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          difficulty_weight: true,
          status: true,
        },
      },
    },
  });

  return {
    userId: user.id,
    courses,
  };
}

export default async function AddExamPage() {
  const data = await getAddExamData();

  return (
    <div>
      <AddExamForm userId={data.userId} courses={data.courses} />
    </div>
  );
}
