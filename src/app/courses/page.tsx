import Link from "next/link";

import prisma from "@/lib/prisma";
import { calculateCourseGrade } from "@/lib/course-grade";
import { CreateCourseForm } from "@/components/create-course-form";
import { CourseCard } from "@/components/course-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isMissingColumnError } from "@/lib/prisma-compat";

export const dynamic = "force-dynamic";

async function getCourseHubData() {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    return [] as Array<{
      id: string;
      name: string;
      cfu: number;
      isPassFail: boolean;
      resourceLink: string | null;
      activeExams: Array<{
        id: string;
        name: string;
        exam_date: Date;
      }>;
      examCount: number;
      topicCount: number;
      projection: Awaited<ReturnType<typeof calculateCourseGrade>>;
    }>;
  }

  const fetchCourses = (where: { userId: string; isArchived?: boolean }) =>
    prisma.course.findMany({
      where,
      select: {
        id: true,
        name: true,
        cfu: true,
        isPassFail: true,
        resourceLink: true,
        exams: {
          where: {
            status: "ACTIVE",
          },
          select: {
            id: true,
            name: true,
            exam_date: true,
          },
          orderBy: {
            exam_date: "asc",
          },
        },
        _count: {
          select: {
            exams: true,
            topics: true,
          },
        },
      },
      orderBy: [{ updated_at: "desc" }, { name: "asc" }],
    });

  let courses: Awaited<ReturnType<typeof fetchCourses>>;

  try {
    courses = await fetchCourses({
      userId: user.id,
      isArchived: false,
    });
  } catch (error) {
    if (!isMissingColumnError(error, "isArchived")) {
      throw error;
    }

    courses = await fetchCourses({
      userId: user.id,
    });
  }

  return Promise.all(
    courses.map(async (course) => ({
      id: course.id,
      name: course.name,
      cfu: course.cfu,
      isPassFail: course.isPassFail,
      resourceLink: course.resourceLink,
      activeExams: course.exams,
      examCount: course._count.exams,
      topicCount: course._count.topics,
      projection: await calculateCourseGrade(course.id),
    })),
  );
}

export default async function CoursesPage() {
  const courses = await getCourseHubData();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Course Hub</h1>
          <p className="text-sm text-muted-foreground">
            Organize each course with its exam track (midterm/final), shared
            topic pool and weighted-grade projection.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/archive">Archive</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/add-exam">Add Exam</Link>
          </Button>
        </div>
      </div>

      <CreateCourseForm />

      {courses.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No courses yet</CardTitle>
            <CardDescription>
              Create your first course explicitly or add an exam and let the app
              create a placeholder automatically.
            </CardDescription>
            <div className="pt-2">
              <Button asChild>
                <Link href="/add-exam">Create First Exam</Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid auto-rows-[minmax(190px,auto)] grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => {
            const nextExam = course.activeExams[0];

            return (
              <CourseCard
                key={course.id}
                id={course.id}
                name={course.name}
                cfu={course.cfu}
                isPassFail={course.isPassFail}
                resourceLink={course.resourceLink}
                topicCount={course.topicCount}
                examCount={course.examCount}
                completedWeightPercent={course.projection.completedWeight * 100}
                projectedFinalGrade={course.projection.projectedFinalGrade}
                nextExam={
                  nextExam
                    ? {
                        id: nextExam.id,
                        name: nextExam.name,
                        examDate: nextExam.exam_date.toISOString(),
                      }
                    : null
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
