import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const secretKey = request.headers.get("x-secret-key");

    const user = await prisma.user.findFirst({
      where: {
        secret_token: secretKey || "",
      },
    });

    if (!user) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { url, name } = body;

    if (!url || !name) {
      return Response.json(
        { error: "URL and name are required" },
        { status: 400 }
      );
    }

    // Verify the URL is accessible and contains iCal data
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "text/calendar, application/ics",
        },
        // timeout
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return Response.json(
          { error: `Failed to fetch calendar: ${response.statusText}` },
          { status: 400 }
        );
      }

      const text = await response.text();
      if (!text.includes("BEGIN:VCALENDAR")) {
        return Response.json(
          { error: "URL does not contain valid iCalendar data" },
          { status: 400 }
        );
      }
    } catch (error) {
      return Response.json(
        { error: `Failed to validate calendar URL: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 400 }
      );
    }

    // Create the external calendar
    const externalCalendar = await prisma.externalCalendar.create({
      data: {
        userId: user.id,
        name,
        url,
        color_code: "#" + Math.floor(Math.random()*16777215).toString(16),
      },
    });

    return Response.json({
      id: externalCalendar.id,
      name: externalCalendar.name,
      url: externalCalendar.url,
      color_code: externalCalendar.color_code,
    });
  } catch (error) {
    console.error("Calendar import error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
