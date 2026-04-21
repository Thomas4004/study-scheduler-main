import { Prisma } from "@prisma/client";

export function isMissingColumnError(error: unknown, columnName?: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2022") {
    return false;
  }

  if (!columnName || columnName.trim().length === 0) {
    return true;
  }

  const normalizedColumn = columnName.toLowerCase();
  const normalizedMessage = error.message.toLowerCase();
  if (normalizedMessage.includes(normalizedColumn)) {
    return true;
  }

  const meta = error.meta as { column?: unknown } | undefined;
  const rawMetaColumn =
    typeof meta?.column === "string" ? meta.column.toLowerCase() : "";

  if (rawMetaColumn.includes(normalizedColumn)) {
    return true;
  }

  return false;
}

export function isMissingTableError(error: unknown, tableName?: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2021") {
    return false;
  }

  if (!tableName || tableName.trim().length === 0) {
    return true;
  }

  const normalizedTable = tableName.toLowerCase();
  const normalizedMessage = error.message.toLowerCase();
  if (normalizedMessage.includes(normalizedTable)) {
    return true;
  }

  const meta = error.meta as { table?: unknown } | undefined;
  const rawMetaTable =
    typeof meta?.table === "string" ? meta.table.toLowerCase() : "";

  if (rawMetaTable.includes(normalizedTable)) {
    return true;
  }

  return false;
}
