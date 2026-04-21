-- CreateTable ExternalCalendar
CREATE TABLE "ExternalCalendar" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "color_code" TEXT NOT NULL DEFAULT '#8B5CF6',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalCalendar_userId_idx" ON "ExternalCalendar"("userId");

-- CreateIndex
CREATE INDEX "ExternalCalendar_userId_isEnabled_idx" ON "ExternalCalendar"("userId", "isEnabled");

-- AddForeignKey
ALTER TABLE "ExternalCalendar" ADD CONSTRAINT "ExternalCalendar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
