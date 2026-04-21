import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
      calendar_feed_token: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let feedToken = user.calendar_feed_token;
  if (!feedToken) {
    feedToken = randomUUID();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        calendar_feed_token: feedToken,
      },
    });
  }

  const redirectUrl = new URL(
    `/api/calendar/${feedToken}/feed.ics`,
    request.url,
  );

  return NextResponse.redirect(redirectUrl, { status: 307 });
}
