import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    // Try different header names for the secret key
    const secretKey = 
      request.headers.get("x-secret-key") || 
      request.headers.get("x-api-key") || 
      request.headers.get("authorization")?.replace("Bearer ", "");

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

    const calendars = await prisma.externalCalendar.findMany({
      where: {
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        url: true,
        color_code: true,
        isEnabled: true,
        syncedAt: true,
        lastError: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return Response.json({
      calendars,
      count: calendars.length,
    });
  } catch (error) {
    console.error("Error fetching calendars:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
