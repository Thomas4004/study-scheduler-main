import { NextRequest, NextResponse } from "next/server";

import {
  completeExamAndSummarize,
  CompleteExamError,
} from "@/lib/exam-completion";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

function parseGrade(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 110) {
    return Number.NaN;
  }

  return parsed;
}

function parseCompletedAt(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") {
    return new Date();
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function parseNotes(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalized.slice(0, 4000);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ examId: string }> },
) {
  try {
    const { examId } = await context.params;

    if (!examId || examId.trim().length === 0) {
      return NextResponse.json(
        { error: "examId is required" },
        { status: 400 },
      );
    }

    const user = await prisma.user.findFirst({
      select: {
        id: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      grade?: unknown;
      completedAt?: unknown;
      notes?: unknown;
    };

    const grade = parseGrade(body.grade);
    if (Number.isNaN(grade)) {
      return NextResponse.json(
        { error: "grade must be an integer between 0 and 110" },
        { status: 400 },
      );
    }

    const completedAt = parseCompletedAt(body.completedAt);
    if (!completedAt) {
      return NextResponse.json(
        { error: "completedAt must be a valid date" },
        { status: 400 },
      );
    }

    const notes = parseNotes(body.notes);
    if (body.notes !== undefined && body.notes !== null && notes === null) {
      return NextResponse.json(
        { error: "notes must be a string" },
        { status: 400 },
      );
    }

    const result = await completeExamAndSummarize({
      examId: examId.trim(),
      userId: user.id,
      grade,
      completedAt,
      notes,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof CompleteExamError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    console.error("Failed to complete exam:", error);
    return NextResponse.json(
      { error: "Failed to complete exam" },
      { status: 500 },
    );
  }
}
