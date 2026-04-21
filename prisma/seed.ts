import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const LEGACY_SSLMODE_ALIASES = new Set(["prefer", "require", "verify-ca"]);
const PLACEHOLDER_COURSE_CFU = 6;

function normalizePostgresConnectionString(value: string) {
  try {
    const parsed = new URL(value);
    const sslmode = parsed.searchParams.get("sslmode")?.toLowerCase();

    if (sslmode && LEGACY_SSLMODE_ALIASES.has(sslmode)) {
      parsed.searchParams.set("sslmode", "verify-full");
      return parsed.toString();
    }

    return value;
  } catch {
    return value;
  }
}

const rawDatabaseUrl = process.env.DATABASE_URL?.trim();

if (!rawDatabaseUrl) {
  throw new Error("DATABASE_URL is required to run prisma seed.");
}

const databaseUrl = normalizePostgresConnectionString(rawDatabaseUrl);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

function buildPlaceholderCourseName(examName: string, examId: string) {
  const baseName =
    examName.trim().length > 0 ? examName.trim() : "Untitled Exam";
  const suffix = examId.slice(-6);
  const prefix = "Corso - ";
  const maxNameLength = 120;
  const reserved = suffix.length + 3; // space + parentheses

  const available = Math.max(1, maxNameLength - prefix.length - reserved);
  const trimmedBase = baseName.slice(0, available);

  return `${prefix}${trimmedBase} (${suffix})`;
}

async function backfillLegacyCourseStructure() {
  const legacyExams = await prisma.exam.findMany({
    where: {
      courseId: null,
    },
    select: {
      id: true,
      name: true,
      userId: true,
      topics: {
        select: {
          id: true,
          courseId: true,
        },
      },
    },
  });

  if (legacyExams.length === 0) {
    console.log("No legacy exams without courseId found. Backfill skipped.");
  }

  for (const exam of legacyExams) {
    const placeholderCourse = await prisma.course.create({
      data: {
        name: buildPlaceholderCourseName(exam.name, exam.id),
        cfu: PLACEHOLDER_COURSE_CFU,
        isPassFail: false,
        isCompleted: false,
        userId: exam.userId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    await prisma.exam.update({
      where: {
        id: exam.id,
      },
      data: {
        courseId: placeholderCourse.id,
      },
    });

    const topicIds = exam.topics.map((topic) => topic.id);

    if (topicIds.length > 0) {
      await prisma.topic.updateMany({
        where: {
          id: {
            in: topicIds,
          },
          courseId: null,
        },
        data: {
          courseId: placeholderCourse.id,
        },
      });

      await prisma.exam.update({
        where: {
          id: exam.id,
        },
        data: {
          topics: {
            connect: topicIds.map((topicId) => ({ id: topicId })),
          },
        },
      });
    }

    console.log(
      `Backfilled legacy exam ${exam.id} -> ${placeholderCourse.name} (${topicIds.length} topic links).`,
    );
  }

  const examsWithCourse = await prisma.exam.findMany({
    where: {
      courseId: {
        not: null,
      },
    },
    select: {
      id: true,
      courseId: true,
      topics: {
        where: {
          courseId: null,
        },
        select: {
          id: true,
        },
      },
    },
  });

  for (const exam of examsWithCourse) {
    if (!exam.courseId || exam.topics.length === 0) {
      continue;
    }

    await prisma.topic.updateMany({
      where: {
        id: {
          in: exam.topics.map((topic) => topic.id),
        },
      },
      data: {
        courseId: exam.courseId,
      },
    });
  }
}

async function main() {
  // Seed is idempotent and safe for repeated runs.
  const TEST_USER_ID = "clxzw75h9000014ut33z1xtu1";
  const secretToken = process.env.PERSONAL_SECRET_KEY ?? "change-me-in-prod";

  const weeklyTemplate = {
    monday: 2,
    tuesday: 2,
    wednesday: 2,
    thursday: 2,
    friday: 2,
    saturday: 4,
    sunday: 0,
  };

  const user = await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: {
      weekly_hours_template: weeklyTemplate,
      secret_token: secretToken,
    },
    create: {
      id: TEST_USER_ID,
      name: "Test User",
      weekly_hours_template: weeklyTemplate,
      secret_token: secretToken,
    },
  });

  console.log(`Ensured user: ${user.name ?? "(no name)"} (ID: ${user.id})`);
  console.log(`Magic token configured from PERSONAL_SECRET_KEY`);

  await backfillLegacyCourseStructure();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
