import {
  PrismaClient as PrismaClientBase,
  type PrismaClient as PrismaClientType,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const FALLBACK_DEV_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/study_scheduler?schema=public";

const LEGACY_SSLMODE_ALIASES = new Set(["prefer", "require", "verify-ca"]);

function isPostgresConnectionString(value: string) {
  return /^postgres(ql)?:\/\//i.test(value);
}

function normalizePostgresConnectionString(value: string) {
  if (!isPostgresConnectionString(value)) {
    return value;
  }

  try {
    const parsed = new URL(value);
    const sslmode = parsed.searchParams.get("sslmode")?.toLowerCase();

    if (sslmode && LEGACY_SSLMODE_ALIASES.has(sslmode)) {
      // Keep strong certificate+hostname validation explicitly to avoid
      // pg-connection-string alias warnings and future behavior changes.
      parsed.searchParams.set("sslmode", "verify-full");
      return parsed.toString();
    }

    return value;
  } catch {
    return value;
  }
}

function resolveDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl && isPostgresConnectionString(databaseUrl)) {
    return normalizePostgresConnectionString(databaseUrl);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL must be a valid PostgreSQL connection string in production.",
    );
  }

  return FALLBACK_DEV_DATABASE_URL;
}

function getPrismaClient() {
  const databaseUrl = resolveDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;

  if (!globalThis.prismaClient) {
    const adapter = new PrismaPg({ connectionString: databaseUrl });
    globalThis.prismaClient = new PrismaClientBase({ adapter });
  }

  return globalThis.prismaClient;
}

declare global {
  var prismaClient: PrismaClientType | undefined;
}

const prisma = new Proxy({} as PrismaClientType, {
  get(_target, prop, receiver) {
    const client = getPrismaClient() as unknown as object;
    const value = Reflect.get(client, prop, receiver);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
});

export default prisma;
