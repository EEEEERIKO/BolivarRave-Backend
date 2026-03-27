-- CreateTable
CREATE TABLE "ScheduleImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceFile" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowsRead" INTEGER NOT NULL,
    "classesCount" INTEGER NOT NULL,
    "slotsCount" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "faculty" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "teacher" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Class_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ScheduleImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    CONSTRAINT "ClassSlot_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Class_faculty_idx" ON "Class"("faculty");

-- CreateIndex
CREATE INDEX "Class_subject_idx" ON "Class"("subject");

-- CreateIndex
CREATE INDEX "Class_code_idx" ON "Class"("code");

-- CreateIndex
CREATE INDEX "ClassSlot_day_idx" ON "ClassSlot"("day");

-- CreateIndex
CREATE INDEX "ClassSlot_room_idx" ON "ClassSlot"("room");
