import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";

function parseTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) return null;
  return trimmed;
}

function parseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function parseType(value: unknown): string {
  if (typeof value !== "string") return "REFERENCE";
  const normalized = value.trim().toUpperCase();
  if (!normalized) return "REFERENCE";
  return normalized.slice(0, 32);
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ topicId: string }> },
) {
  try {
    const { topicId } = await context.params;
    if (!topicId) {
      return NextResponse.json({ error: "Missing topicId" }, { status: 400 });
    }

    const materials = await prisma.material.findMany({
      where: { topicId },
      orderBy: [{ type: "asc" }, { title: "asc" }],
    });

    return NextResponse.json({ materials }, { status: 200 });
  } catch (error) {
    console.error("Failed to list materials:", error);
    return NextResponse.json(
      { error: "Failed to list materials" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ topicId: string }> },
) {
  try {
    const { topicId } = await context.params;
    if (!topicId) {
      return NextResponse.json({ error: "Missing topicId" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      title?: unknown;
      url?: unknown;
      type?: unknown;
    };

    const title = parseTitle(body.title);
    if (!title) {
      return NextResponse.json(
        { error: "title is required (max 120 chars)" },
        { status: 400 },
      );
    }

    const url = parseUrl(body.url);
    if (!url) {
      return NextResponse.json(
        { error: "url must be a valid http(s) URL" },
        { status: 400 },
      );
    }

    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });

    if (!topic) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    const material = await prisma.material.create({
      data: {
        topicId,
        title,
        url,
        type: parseType(body.type),
      },
    });

    return NextResponse.json({ material }, { status: 201 });
  } catch (error) {
    console.error("Failed to create material:", error);
    return NextResponse.json(
      { error: "Failed to create material" },
      { status: 500 },
    );
  }
}
