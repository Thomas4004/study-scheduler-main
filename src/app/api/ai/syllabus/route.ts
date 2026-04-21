import type { NextRequest } from "next/server";

import { POST as scanSyllabusPost } from "@/app/api/scan-syllabus/route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return scanSyllabusPost(request);
}
