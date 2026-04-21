import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseICalEvents } from "@/lib/calendar-parser";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ calendarId: string }> }
) {
  try {
    const params = await context.params;
    const secretKey = request.headers.get("x-secret-key");

    const user = await prisma.user.findFirst({
      where: {
        secret_token: secretKey || "",
      },
    });

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const calendar = await prisma.externalCalendar.findFirst({
      where: {
        id: params.calendarId,
        userId: user.id,
      },
    });

    if (!calendar) {
      return Response.json(
        { error: "Calendar not found" },
        { status: 404 }
      );
    }

    if (!calendar.isEnabled) {
      return Response.json(
        { error: "Calendar is disabled" },
        { status: 400 }
      );
    }

    try {
      const response = await fetch(calendar.url, {
        method: "GET",
        headers: {
          Accept: "text/calendar, application/ics",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "it-IT,it;q=0.9",
          Referer: "https://www.google.com/",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const icsText = await response.text();
      const events = parseICalEvents(icsText);

      // Update sync timestamp
      await prisma.externalCalendar.update({
        where: { id: calendar.id },
        data: {
          syncedAt: new Date(),
          lastError: null,
        },
      });

      return Response.json({
        id: calendar.id,
        name: calendar.name,
        color_code: calendar.color_code,
        events: events.slice(0, 100), // Limit to 100 events
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Save error to database
      await prisma.externalCalendar.update({
        where: { id: calendar.id },
        data: {
          lastError: errorMessage,
        },
      });

      return Response.json(
        { error: `Failed to sync calendar: ${errorMessage}` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Calendar sync error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ calendarId: string }> }
) {
  try {
    const params = await context.params;
    const secretKey = request.headers.get("x-secret-key");

    const user = await prisma.user.findFirst({
      where: {
        secret_token: secretKey || "",
      },
    });

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const calendar = await prisma.externalCalendar.findFirst({
      where: {
        id: params.calendarId,
        userId: user.id,
      },
    });

    if (!calendar) {
      return Response.json(
        { error: "Calendar not found" },
        { status: 404 }
      );
    }

    await prisma.externalCalendar.delete({
      where: { id: calendar.id },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Calendar deletion error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
