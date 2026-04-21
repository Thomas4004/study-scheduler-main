import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  syllabusText: z.string().min(60).max(50000),
});

const topicSchema = z.object({
  name: z.string().min(2).max(140),
  difficulty: z.number().int().min(1).max(5),
});

const syllabusScanSchema = z.object({
  examTitle: z.string().min(3).max(120),
  estimatedCfu: z.number().int().min(1).max(30),
  cfuSource: z.enum(["EXPLICIT", "INFERRED"]),
  topics: z.array(topicSchema).min(3).max(120),
});

function resolveGeminiApiKey() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ?? "";

  // Guard against common placeholder values left in .env.
  const looksLikePlaceholder =
    apiKey.length === 0 ||
    /^incolla-qui/i.test(apiKey) ||
    /^your[-_ ]?google[-_ ]?api[-_ ]?key$/i.test(apiKey);

  return {
    apiKey,
    looksLikePlaceholder,
  };
}

function toProviderErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("api key") ||
    normalized.includes("authentication") ||
    normalized.includes("unauthorized") ||
    normalized.includes("permission")
  ) {
    return {
      status: 500,
      error:
        "Chiave Gemini non valida o senza permessi. Verifica GOOGLE_GENERATIVE_AI_API_KEY su Google AI Studio.",
    };
  }

  if (
    normalized.includes("quota") ||
    normalized.includes("rate") ||
    normalized.includes("429")
  ) {
    return {
      status: 429,
      error:
        "Quota Gemini esaurita o rate limit raggiunto. Riprova tra poco oppure controlla il piano API.",
    };
  }

  return {
    status: 500,
    error: "Failed to scan syllabus",
  };
}

function dedupeTopics(topics: z.infer<typeof topicSchema>[]) {
  const seen = new Set<string>();

  return topics.filter((topic) => {
    const normalized = topic.name.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = (await request.json().catch(() => null)) as unknown;
    const parsedBody = requestSchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error:
            "Incolla un syllabus piu completo (almeno 60 caratteri) per l'analisi AI.",
        },
        { status: 400 },
      );
    }

    const { looksLikePlaceholder } = resolveGeminiApiKey();

    if (looksLikePlaceholder) {
      return NextResponse.json(
        {
          error:
            "GOOGLE_GENERATIVE_AI_API_KEY non configurata correttamente. Inserisci una chiave reale (non placeholder) nel file .env.",
        },
        { status: 500 },
      );
    }

    const { object } = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: syllabusScanSchema,
      temperature: 0.1,
      system:
        "Sei un assistente accademico. Analizza un programma d'esame universitario e genera un output rigoroso conforme allo schema. " +
        "I topic devono essere granulari, non duplicati, in ordine logico. " +
        "Se i CFU non sono presenti esplicitamente, deducili in modo realistico e marca cfuSource come INFERRED.",
      prompt:
        "Analizza il seguente syllabus e restituisci: examTitle, estimatedCfu, cfuSource e topics completi. " +
        "Ogni topic deve avere difficulty (1-5 intero).\n\n" +
        `Syllabus:\n${parsedBody.data.syllabusText.slice(0, 30000)}`,
    });

    const topics = dedupeTopics(object.topics);
    if (topics.length < 3) {
      return NextResponse.json(
        {
          error:
            "AI ha prodotto troppi topic duplicati. Riprova con un syllabus piu dettagliato.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        ...object,
        topics,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to scan syllabus with Gemini:", error);

    const providerError = toProviderErrorMessage(error);
    return NextResponse.json(
      { error: providerError.error },
      { status: providerError.status },
    );
  }
}
