import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await context.params;

    if (!courseId || courseId.trim().length === 0) {
      return NextResponse.json(
        { error: "courseId is required" },
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

    const course = await prisma.course.findFirst({
      where: {
        id: courseId.trim(),
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            exams: true,
            topics: true,
          },
        },
      },
    });

    if (!course) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }

    await prisma.course.delete({
      where: {
        id: course.id,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        deleted: {
          id: course.id,
          name: course.name,
          examsRemoved: course._count.exams,
          topicsRemoved: course._count.topics,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to delete course:", error);
    return NextResponse.json(
      { error: "Failed to delete course" },
      { status: 500 },
    );
  }
}
