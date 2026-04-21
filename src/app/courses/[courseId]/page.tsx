import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";

import prisma from "@/lib/prisma";
import { calculateCourseGrade } from "@/lib/course-grade";
import { CourseTopicAssignmentModal } from "@/components/course-topic-assignment-modal";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { ExamWeightManager } from "@/components/exam-weight-manager";
import { TopicResourceLinkForm } from "@/components/topic-resource-link-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

function toResourceList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function getCourseData(courseId: string) {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    return null;
  }

  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      userId: user.id,
    },
    select: {
      id: true,
      name: true,
      resourceLink: true,
      topics: {
        select: {
          id: true,
          name: true,
          status: true,
          resources: true,
        },
        orderBy: [{ status: "asc" }, { name: "asc" }],
      },
      exams: {
        select: {
          id: true,
          name: true,
          status: true,
          exam_date: true,
          weight: true,
          grade: true,
          topics: {
            select: {
              id: true,
              name: true,
            },
            orderBy: {
              name: "asc",
            },
          },
        },
        orderBy: [{ exam_date: "asc" }, { name: "asc" }],
      },
    },
  });

  if (!course) {
    return null;
  }

  return {
    ...course,
    topics: course.topics.map((topic) => ({
      ...topic,
      resources: toResourceList(topic.resources),
    })),
    projection: await calculateCourseGrade(course.id),
  };
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const course = await getCourseData(courseId);

  if (!course) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Course Hub
          </p>
          <h1 className="text-2xl font-bold">{course.name}</h1>
          <p className="text-sm text-muted-foreground">
            Course-level topic pool, exam assignment matrix, and weighted
            final-grade projection.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/courses">Back to Courses</Link>
          </Button>
          <DeleteEntityButton
            endpoint={`/api/courses/${course.id}`}
            entityLabel="course"
            buttonLabel="Delete Course"
            redirectTo="/courses"
            size="sm"
            confirmMessage={`Delete course \"${course.name}\"? This will also delete all linked exams and topics.`}
          />
          {course.resourceLink ? (
            <Button asChild>
              <a href={course.resourceLink} target="_blank" rel="noreferrer">
                Open Course Resource
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Topic Sidebar</CardTitle>
            <CardDescription>
              Shared course topic pool with quick resource-link management.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {course.topics.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 px-3 py-5 text-sm text-muted-foreground">
                No topics in this course yet.
              </p>
            ) : (
              course.topics.map((topic) => (
                <div
                  key={topic.id}
                  className="space-y-2 rounded-xl border border-border/70 bg-background px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{topic.name}</p>
                    <div className="flex items-start gap-2">
                      <span className="rounded-md border border-border/70 bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {topic.status}
                      </span>
                      <DeleteEntityButton
                        endpoint={`/api/topics/${topic.id}`}
                        entityLabel="topic"
                        buttonLabel="Delete"
                        size="xs"
                        confirmMessage={`Delete topic \"${topic.name}\"? It will be removed from this course and all linked exams.`}
                      />
                    </div>
                  </div>

                  {topic.resources.length > 0 ? (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {topic.resources.map((resource) => (
                        <li key={`${topic.id}-${resource}`}>
                          <a
                            href={resource}
                            target="_blank"
                            rel="noreferrer"
                            className="whitespace-normal break-all text-sky-300 hover:text-sky-200"
                          >
                            {resource}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No resources linked.
                    </p>
                  )}

                  <TopicResourceLinkForm topicId={topic.id} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <ExamWeightManager
            courseId={course.id}
            exams={course.exams.map((exam) => ({
              id: exam.id,
              name: exam.name,
              weight: exam.weight,
            }))}
          />

          <Card className="border-border/70 bg-card/80">
            <CardHeader>
              <CardTitle>Exam Grid</CardTitle>
              <CardDescription>
                Assign which course topics belong to each exam (midterm/final
                style).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {course.exams.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-sm text-muted-foreground">
                  No exams for this course yet.
                </p>
              ) : (
                <div className="grid items-stretch gap-3 md:grid-cols-2">
                  {course.exams.map((exam) => (
                    <div
                      key={exam.id}
                      className="flex h-full min-h-[12rem] flex-col gap-3 rounded-xl border border-border/70 bg-background px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-balance break-words text-sm font-semibold">
                            {exam.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(exam.exam_date), "dd/MM/yyyy")} ·{" "}
                            {exam.status}
                          </p>
                        </div>
                        <span className="rounded-md border border-border/70 bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {(exam.weight * 100).toFixed(1)}%
                        </span>
                      </div>

                      <div className="flex-1 space-y-1">
                        {exam.topics.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No topics assigned to this exam.
                          </p>
                        ) : (
                          <ul className="space-y-1 text-xs text-muted-foreground">
                            {exam.topics.map((topic) => (
                              <li
                                key={`${exam.id}-${topic.id}`}
                                className="whitespace-normal break-words"
                              >
                                • {topic.name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="mt-auto flex flex-wrap items-center gap-2">
                        <CourseTopicAssignmentModal
                          examId={exam.id}
                          examName={exam.name}
                          courseTopics={course.topics.map((topic) => ({
                            id: topic.id,
                            name: topic.name,
                            resources: topic.resources,
                          }))}
                          assignedTopicIds={exam.topics.map(
                            (topic) => topic.id,
                          )}
                        />

                        <Button asChild variant="ghost">
                          <Link href={`/exam/${exam.id}`}>Open Exam View</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/80">
            <CardHeader>
              <CardTitle>Weighted Grade Projection</CardTitle>
              <CardDescription>
                Projection from completed exams only.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Completed Exams
                </p>
                <p className="text-xl font-semibold">
                  {course.projection.completedExams}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Weight Covered
                </p>
                <p className="text-xl font-semibold">
                  {(course.projection.completedWeight * 100).toFixed(2)}%
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Projected Final Grade
                </p>
                <p className="text-xl font-semibold">
                  {course.projection.projectedFinalGrade !== null
                    ? course.projection.projectedFinalGrade.toFixed(2)
                    : "N/A"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
