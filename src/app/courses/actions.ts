"use server";

import { revalidatePath } from "next/cache";
import { ExamStatus, TopicStatus } from "@prisma/client";
import { startOfDay } from "date-fns";

import { recalculateSchedule } from "@/lib/planning";
import prisma from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/prisma-compat";

type AddTopicResourceLinkInput = {
  topicId: string;
  resourceUrl: string;
};

type CreateCourseInput = {
  name: string;
  cfu: number;
  isPassFail?: boolean;
  resourceLink?: string;
};

type UpdateCourseInput = {
  courseId: string;
  name: string;
  cfu: number;
  isPassFail?: boolean;
  resourceLink?: string;
};

function normalizeHttpUrl(value: string) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) resource links are supported");
  }

  return parsed.toString();
}

function normalizeCourseName(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Course name is required");
  }

  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 120) {
    throw new Error("Course name must be between 2 and 120 characters");
  }

  return trimmed;
}

function normalizeCourseCfu(value: unknown) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? ""));

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) {
    throw new Error("Course CFU must be an integer between 1 and 60");
  }

  return parsed;
}

function normalizePassFail(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new Error("isPassFail must be a boolean");
  }

  return value;
}

function normalizeOptionalHttpUrl(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("resourceLink must be a valid URL");
  }

  if (value.trim().length === 0) {
    return null;
  }

  return normalizeHttpUrl(value);
}

function parseResourceList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export async function addTopicResourceLink(input: AddTopicResourceLinkInput) {
  if (!input.topicId || !input.resourceUrl) {
    throw new Error("topicId and resourceUrl are required");
  }

  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const normalizedUrl = normalizeHttpUrl(input.resourceUrl);

  const topic = await prisma.topic.findFirst({
    where: {
      id: input.topicId,
      course: {
        userId: user.id,
      },
    },
    select: {
      id: true,
      courseId: true,
      resources: true,
    },
  });

  if (!topic || !topic.courseId) {
    throw new Error("Topic not found");
  }

  const current = parseResourceList(topic.resources);
  const hasResource = current.some(
    (resource) => resource.toLowerCase() === normalizedUrl.toLowerCase(),
  );

  if (hasResource) {
    return {
      ok: true,
      created: false,
      resources: current,
    };
  }

  const resources = [...current, normalizedUrl];

  await prisma.topic.update({
    where: {
      id: topic.id,
    },
    data: {
      resources,
    },
  });

  revalidatePath("/courses");
  revalidatePath(`/courses/${topic.courseId}`);

  return {
    ok: true,
    created: true,
    resources,
  };
}

export async function createCourse(input: CreateCourseInput) {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const name = normalizeCourseName(input.name);
  const cfu = normalizeCourseCfu(input.cfu);
  const isPassFail = normalizePassFail(input.isPassFail);
  const resourceLink = normalizeOptionalHttpUrl(input.resourceLink);

  const existing = await prisma.course.findFirst({
    where: {
      userId: user.id,
      name,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (existing) {
    return {
      ok: true,
      created: false,
      courseId: existing.id,
      name: existing.name,
    };
  }

  const course = await prisma.course.create({
    data: {
      name,
      cfu,
      isPassFail,
      resourceLink,
      userId: user.id,
    },
    select: {
      id: true,
      name: true,
    },
  });

  revalidatePath("/courses");

  return {
    ok: true,
    created: true,
    courseId: course.id,
    name: course.name,
  };
}

export async function updateCourse(input: UpdateCourseInput) {
  const normalizedCourseId =
    typeof input.courseId === "string" ? input.courseId.trim() : "";

  if (normalizedCourseId.length === 0) {
    throw new Error("courseId is required");
  }

  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const existingCourse = await prisma.course.findFirst({
    where: {
      id: normalizedCourseId,
      userId: user.id,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!existingCourse) {
    throw new Error("Course not found");
  }

  const name = normalizeCourseName(input.name);
  const cfu = normalizeCourseCfu(input.cfu);
  const isPassFail = normalizePassFail(input.isPassFail);
  const resourceLink = normalizeOptionalHttpUrl(input.resourceLink);

  const conflict = await prisma.course.findFirst({
    where: {
      userId: user.id,
      name,
      id: {
        not: existingCourse.id,
      },
    },
    select: {
      id: true,
    },
  });

  if (conflict) {
    throw new Error("A course with this name already exists");
  }

  const updatedCourse = await prisma.course.update({
    where: {
      id: existingCourse.id,
    },
    data: {
      name,
      cfu,
      isPassFail,
      resourceLink,
    },
    select: {
      id: true,
      name: true,
      cfu: true,
      isPassFail: true,
      resourceLink: true,
    },
  });

  revalidatePath("/courses");
  revalidatePath(`/courses/${updatedCourse.id}`);
  revalidatePath("/exams");
  revalidatePath("/calendar");
  revalidatePath("/focus");

  return {
    ok: true,
    updated: true,
    course: updatedCourse,
  };
}

export async function archiveCourse(courseId: string) {
  const normalizedCourseId =
    typeof courseId === "string" ? courseId.trim() : "";

  if (normalizedCourseId.length === 0) {
    throw new Error("courseId is required");
  }

  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  let supportsArchiveFlag = true;
  let courseRecord: { id: string; name: string; isArchived: boolean } | null =
    null;

  try {
    courseRecord = await prisma.course.findFirst({
      where: {
        id: normalizedCourseId,
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        isArchived: true,
      },
    });
  } catch (error) {
    if (!isMissingColumnError(error, "isArchived")) {
      throw error;
    }

    supportsArchiveFlag = false;

    const legacyCourse = await prisma.course.findFirst({
      where: {
        id: normalizedCourseId,
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (legacyCourse) {
      courseRecord = {
        id: legacyCourse.id,
        name: legacyCourse.name,
        isArchived: false,
      };
    }
  }

  if (!courseRecord) {
    throw new Error("Course not found");
  }

  if (supportsArchiveFlag && courseRecord.isArchived) {
    return {
      ok: true,
      alreadyArchived: true,
      courseId: courseRecord.id,
      name: courseRecord.name,
      archivedExams: 0,
      archivedTopics: 0,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const archivedExams = await tx.exam.updateMany({
      where: {
        userId: user.id,
        courseId: courseRecord.id,
        status: {
          not: ExamStatus.ARCHIVED,
        },
      },
      data: {
        status: ExamStatus.ARCHIVED,
      },
    });

    if (supportsArchiveFlag) {
      await tx.course.update({
        where: {
          id: courseRecord.id,
        },
        data: {
          isArchived: true,
          isCompleted: true,
        },
      });
    } else {
      await tx.course.update({
        where: {
          id: courseRecord.id,
        },
        data: {
          isCompleted: true,
        },
      });
    }

    return {
      archivedExams: archivedExams.count,
      archivedTopics: 0,
    };
  });

  revalidatePath("/");
  revalidatePath("/courses");
  revalidatePath(`/courses/${courseRecord.id}`);
  revalidatePath("/exams");
  revalidatePath("/focus");
  revalidatePath("/calendar");
  revalidatePath("/archive");
  revalidatePath("/libretto");

  return {
    ok: true,
    alreadyArchived: false,
    courseId: courseRecord.id,
    name: courseRecord.name,
    archivedExams: result.archivedExams,
    archivedTopics: result.archivedTopics,
  };
}

export async function unarchiveCourse(courseId: string) {
  const normalizedCourseId =
    typeof courseId === "string" ? courseId.trim() : "";

  if (normalizedCourseId.length === 0) {
    throw new Error("courseId is required");
  }

  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  let supportsArchiveFlag = true;
  let courseRecord: { id: string; name: string; isArchived: boolean } | null =
    null;

  try {
    courseRecord = await prisma.course.findFirst({
      where: {
        id: normalizedCourseId,
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        isArchived: true,
      },
    });
  } catch (error) {
    if (!isMissingColumnError(error, "isArchived")) {
      throw error;
    }

    supportsArchiveFlag = false;

    const legacyCourse = await prisma.course.findFirst({
      where: {
        id: normalizedCourseId,
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (legacyCourse) {
      courseRecord = {
        id: legacyCourse.id,
        name: legacyCourse.name,
        isArchived: false,
      };
    }
  }

  if (!courseRecord) {
    throw new Error("Course not found");
  }

  if (supportsArchiveFlag && !courseRecord.isArchived) {
    return {
      ok: true,
      restored: false,
      courseId: courseRecord.id,
      name: courseRecord.name,
    };
  }

  if (supportsArchiveFlag) {
    await prisma.course.update({
      where: {
        id: courseRecord.id,
      },
      data: {
        isArchived: false,
        isCompleted: false,
      },
    });
  } else {
    await prisma.course.update({
      where: {
        id: courseRecord.id,
      },
      data: {
        isCompleted: false,
      },
    });
  }

  revalidatePath("/courses");
  revalidatePath(`/courses/${courseRecord.id}`);
  revalidatePath("/archive");
  revalidatePath("/exams");
  revalidatePath("/calendar");
  revalidatePath("/focus");
  revalidatePath("/libretto");

  return {
    ok: true,
    restored: true,
    courseId: courseRecord.id,
    name: courseRecord.name,
  };
}

export async function unarchiveTopic(topicId: string) {
  const normalizedTopicId = typeof topicId === "string" ? topicId.trim() : "";

  if (normalizedTopicId.length === 0) {
    throw new Error("topicId is required");
  }

  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const topic = await prisma.topic.findFirst({
    where: {
      id: normalizedTopicId,
      OR: [
        {
          course: {
            userId: user.id,
          },
        },
        {
          exams: {
            some: {
              userId: user.id,
            },
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      courseId: true,
      exams: {
        where: {
          userId: user.id,
          status: ExamStatus.ACTIVE,
        },
        select: {
          id: true,
        },
      },
    },
  });

  if (!topic) {
    throw new Error("Topic not found");
  }

  if (topic.status !== TopicStatus.ARCHIVED) {
    return {
      ok: true,
      restored: false,
      topic: {
        id: topic.id,
        name: topic.name,
        status: topic.status,
      },
    };
  }

  const restoredTopic = await prisma.topic.update({
    where: {
      id: topic.id,
    },
    data: {
      // "Active" topic state is represented by TO_STUDY in the current enum.
      status: TopicStatus.TO_STUDY,
      next_review: startOfDay(new Date()),
      interval_days: 1,
    },
    select: {
      id: true,
      name: true,
      status: true,
      next_review: true,
    },
  });

  await Promise.allSettled(
    topic.exams.map((exam) => recalculateSchedule(exam.id)),
  );

  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  revalidatePath("/focus");
  revalidatePath("/archive");
  revalidatePath("/courses");

  if (topic.courseId) {
    revalidatePath(`/courses/${topic.courseId}`);
  }

  for (const exam of topic.exams) {
    revalidatePath(`/exam/${exam.id}`);
  }

  return {
    ok: true,
    restored: true,
    topic: {
      id: restoredTopic.id,
      name: restoredTopic.name,
      status: restoredTopic.status,
      nextReview: restoredTopic.next_review?.toISOString() ?? null,
    },
  };
}
