import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ topicId: string; materialId: string }> },
) {
  try {
    const { topicId, materialId } = await context.params;
    if (!topicId || !materialId) {
      return NextResponse.json(
        { error: "Missing topicId or materialId" },
        { status: 400 },
      );
    }

    const existing = await prisma.material.findFirst({
      where: {
        id: materialId,
        topicId,
      },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Material not found" },
        { status: 404 },
      );
    }

    await prisma.material.delete({
      where: { id: materialId },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to delete material:", error);
    return NextResponse.json(
      { error: "Failed to delete material" },
      { status: 500 },
    );
  }
}
