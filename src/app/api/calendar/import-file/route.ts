import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseICalEvents } from "@/lib/calendar-parser";

export async function POST(request: NextRequest) {
  try {
    const secretKey = request.headers.get("x-secret-key");

    const user = await prisma.user.findFirst({
      where: {
        secret_token: secretKey || "",
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const calendarName = formData.get("name") as string;

    if (!file) {
      return NextResponse.json(
        { error: "File is required" },
        { status: 400 }
      );
    }

    if (!calendarName || !calendarName.trim()) {
      return NextResponse.json(
        { error: "Calendar name is required" },
        { status: 400 }
      );
    }

    // Check file type
    if (!file.name.toLowerCase().endsWith(".ics")) {
      return NextResponse.json(
        { error: "File must be an .ics file" },
        { status: 400 }
      );
    }

    // Check file size (limit to 10MB)
    const fileSizeInMB = file.size / (1024 * 1024);
    if (fileSizeInMB > 10) {
      return NextResponse.json(
        { error: "File size must not exceed 10MB" },
        { status: 400 }
      );
    }

    // Read file content
    const fileContent = await file.text();

    // Validate iCalendar format
    if (!fileContent.includes("BEGIN:VCALENDAR")) {
      return NextResponse.json(
        { error: "File does not contain valid iCalendar data" },
        { status: 400 }
      );
    }

    // Create a special marker for file-based calendars
    // Store in database with file content encoded, parsed for events
    const events = parseICalEvents(fileContent);
    const fileMarker = `file://${calendarName}`;

    // Create the external calendar
    const externalCalendar = await prisma.externalCalendar.create({
      data: {
        userId: user.id,
        name: calendarName.trim(),
        url: fileMarker,
        color_code: "#" + Math.floor(Math.random()*16777215).toString(16),
      },
    });

    return NextResponse.json({
      id: externalCalendar.id,
      name: externalCalendar.name,
      url: fileMarker,
      color_code: externalCalendar.color_code,
      events: events.slice(0, 100),
    });
  } catch (error) {
    console.error("Calendar file import error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
