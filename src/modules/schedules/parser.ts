import XLSX from "xlsx";
import { z } from "zod";
import { ParsedScheduleRow } from "./types";

const REQUIRED_FIELDS = [
  "faculty",
  "code",
  "subject",
  "teacher",
  "startDate",
  "endDate",
  "day",
  "room",
  "startTime",
  "endTime",
] as const;

const COLUMN_ALIASES: Record<(typeof REQUIRED_FIELDS)[number], string[]> = {
  faculty: ["facultad", "faculty"],
  code: ["codigo", "code", "codigo materia", "nrc"],
  subject: ["materia", "asignatura", "subject", "nombre materia"],
  teacher: ["docente", "profesor", "teacher"],
  startDate: ["fecha inicio", "inicio", "start date"],
  endDate: ["fecha fin", "fin", "end date"],
  day: ["dia", "dia semana", "day"],
  room: ["salon", "aula", "room", "espacio"],
  startTime: ["hora inicio", "inicio hora", "start time"],
  endTime: ["hora fin", "fin hora", "end time"],
};

const rowSchema = z.object({
  faculty: z.string().min(1),
  code: z.string().min(1),
  subject: z.string().min(1),
  teacher: z.string().min(1),
  startDate: z.date(),
  endDate: z.date(),
  day: z.string().min(1),
  room: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const excelSerialToDate = (serial: number) => {
  const date = new Date(Date.UTC(1899, 11, 30));
  date.setUTCDate(date.getUTCDate() + serial);
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const parseDate = (value: unknown): Date => {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value === "number") {
    return excelSerialToDate(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, y, m, d] = isoMatch;
      return new Date(Number(y), Number(m) - 1, Number(d));
    }

    const latinMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (latinMatch) {
      const [, d, m, y] = latinMatch;
      return new Date(Number(y), Number(m) - 1, Number(d));
    }

    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    const parts = trimmed.split(/[\/-]/).map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      const [a, b, c] = parts as [number, number, number];
      if (a > 1900) return new Date(a, b - 1, c);
      return new Date(c, b - 1, a);
    }
  }

  throw new Error(`No se pudo interpretar la fecha: ${String(value)}`);
};

const toHHMM = (value: unknown): string => {
  if (typeof value === "number") {
    const totalMinutes = Math.round(value * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const hours = String(Number(match[1])).padStart(2, "0");
      return `${hours}:${match[2]}`;
    }
  }

  throw new Error(`No se pudo interpretar la hora: ${String(value)}`);
};

const recoverMojibake = (value: string) => {
  if (!/[ÃÂ]/.test(value)) return value;

  try {
    const recovered = Buffer.from(value, "latin1").toString("utf8");
    return recovered;
  } catch {
    return value;
  }
};

const toRangeStartHHMM = (value: unknown): string => {
  if (typeof value === "string" && value.includes("-")) {
    const [start] = value.split("-");
    return toHHMM((start ?? "").trim());
  }

  return toHHMM(value);
};

const findColumnMap = (headers: string[]) => {
  const normalizedHeaders = headers.map((h) => normalize(h));
  const map = new Map<(typeof REQUIRED_FIELDS)[number], string>();

  REQUIRED_FIELDS.forEach((field) => {
    const aliases = COLUMN_ALIASES[field].map(normalize);
    const idx = normalizedHeaders.findIndex((header) => aliases.includes(header));
    if (idx >= 0) {
      const headerName = headers[idx];
      if (headerName) map.set(field, headerName);
    }
  });

  const missing = REQUIRED_FIELDS.filter((field) => !map.has(field));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas requeridas en Excel: ${missing.join(", ")}`);
  }

  return map;
};

const normalizeDay = (value: string): string => {
  const day = normalize(value);
  if (day.startsWith("lun")) return "Lunes";
  if (day.startsWith("mar")) return "Martes";
  if (day.startsWith("mie")) return "Miercoles";
  if (day.startsWith("jue")) return "Jueves";
  if (day.startsWith("vie")) return "Viernes";
  if (day.startsWith("sab")) return "Sabado";
  if (day.startsWith("dom")) return "Domingo";
  return value.trim();
};

export const parseScheduleExcel = (buffer: Buffer): ParsedScheduleRow[] => {
  return parseScheduleWorkbook(buffer);
};

const normalizeSheetDay = (sheetName: string, fallbackDay?: string) => {
  const fromSheet = normalizeDay(sheetName);
  const validDays = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"];

  if (validDays.includes(fromSheet)) return fromSheet;
  if (fallbackDay) {
    const normalizedFallback = normalizeDay(fallbackDay);
    if (validDays.includes(normalizedFallback)) return normalizedFallback;
  }

  throw new Error(
    `No se pudo determinar el dia para la hoja '${sheetName}'. Usa nombres de hoja Lunes..Viernes o envia el campo 'day' en la solicitud.`
  );
};

const parseNormalizedSheet = (sheet: XLSX.WorkSheet, contextLabel: string): ParsedScheduleRow[] => {
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: true,
  });

  if (rawRows.length === 0) return [];

  const firstRow = rawRows[0];
  if (!firstRow) return [];

  const headers = Object.keys(firstRow);
  const columnMap = findColumnMap(headers);

  return rawRows.map((row, idx) => {
    const parsed = {
      faculty: String(row[columnMap.get("faculty")!] ?? "").trim(),
      code: String(row[columnMap.get("code")!] ?? "").trim(),
      subject: String(row[columnMap.get("subject")!] ?? "").trim(),
      teacher: String(row[columnMap.get("teacher")!] ?? "").trim(),
      startDate: parseDate(row[columnMap.get("startDate")!]),
      endDate: parseDate(row[columnMap.get("endDate")!]),
      day: normalizeDay(String(row[columnMap.get("day")!] ?? "")),
      room: String(row[columnMap.get("room")!] ?? "").trim(),
      startTime: toHHMM(row[columnMap.get("startTime")!]),
      endTime: toHHMM(row[columnMap.get("endTime")!]),
    };

    const validation = rowSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(
        `Fila ${idx + 2} invalida en ${contextLabel}: ${validation.error.issues[0]?.message ?? "error de validacion"}`
      );
    }

    return validation.data;
  });
};

const parseCellClassValue = (value: string) => {
  const parts = value
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 5) return null;

  const head = parts[0] ?? "";
  const separatorIdx = head.indexOf(":");
  if (separatorIdx < 0) return null;

  const faculty = recoverMojibake(head.slice(0, separatorIdx).trim());
  const code = recoverMojibake(head.slice(separatorIdx + 1).trim());
  const subject = recoverMojibake((parts[1] ?? "").trim());
  const teacher = recoverMojibake((parts[2] ?? "").trim());
  const startDateRaw = parts[3];
  const endDateRaw = parts[4];

  if (!faculty || !code || !subject || !teacher || !startDateRaw || !endDateRaw) return null;

  return {
    faculty,
    code,
    subject,
    teacher,
    startDate: parseDate(startDateRaw),
    endDate: parseDate(endDateRaw),
  };
};

const parseMatrixSheet = (sheet: XLSX.WorkSheet, sheetName: string, fallbackDay?: string): ParsedScheduleRow[] => {
  const grid = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  if (grid.length < 2) return [];

  const headerRow = grid[0] ?? [];
  const normalizedHeaders = headerRow.map((cell) => normalize(String(cell ?? "")));
  const hourColIndex = normalizedHeaders.findIndex((h) => h === "hora");
  if (hourColIndex < 0) {
    throw new Error(`La hoja '${sheetName}' no tiene columna HORA`);
  }

  const day = normalizeSheetDay(sheetName, fallbackDay);
  const rows: ParsedScheduleRow[] = [];

  for (let rowIndex = 1; rowIndex < grid.length; rowIndex++) {
    const row = grid[rowIndex] ?? [];
    const startTimeRaw = row[hourColIndex];
    if (!String(startTimeRaw ?? "").trim()) continue;

    let startTime: string;
    try {
      startTime = toRangeStartHHMM(startTimeRaw);
    } catch {
      continue;
    }

    const [h = 0, m = 0] = startTime.split(":").map(Number);
    const endMinutes = h * 60 + m + 30;
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;

    for (let col = hourColIndex + 1; col < headerRow.length; col++) {
      const room = recoverMojibake(String(headerRow[col] ?? "").trim());
      if (!room) continue;

      const cellValue = String(row[col] ?? "").trim();
      if (!cellValue || !cellValue.includes("|")) continue;

      const parsedClass = parseCellClassValue(cellValue);
      if (!parsedClass) continue;

      const validation = rowSchema.safeParse({
        ...parsedClass,
        day,
        room,
        startTime,
        endTime,
      });

      if (!validation.success) {
        throw new Error(
          `Dato invalido en hoja '${sheetName}', fila ${rowIndex + 1}, columna ${col + 1}: ${validation.error.issues[0]?.message ?? "error"}`
        );
      }

      rows.push(validation.data);
    }
  }

  return rows;
};

const detectMatrixFormat = (sheet: XLSX.WorkSheet) => {
  const grid = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
    range: 0,
  });

  const headerRow = grid[0] ?? [];
  const normalizedHeaders = headerRow.map((cell) => normalize(String(cell ?? "")));
  return normalizedHeaders.includes("hora");
};

export const parseScheduleWorkbook = (buffer: Buffer, options?: { fallbackDay?: string }): ParsedScheduleRow[] => {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  if (workbook.SheetNames.length === 0) throw new Error("El archivo no contiene hojas");

  const allRows: ParsedScheduleRow[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;

    try {
      const rows = detectMatrixFormat(sheet)
        ? parseMatrixSheet(sheet, sheetName, options?.fallbackDay)
        : parseNormalizedSheet(sheet, `hoja '${sheetName}'`);

      allRows.push(...rows);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      // Algunas hojas del archivo (p. ej. "PENDIENTES") no son horarios y se deben omitir.
      if (message.includes("faltan columnas requeridas en excel")) {
        return;
      }
      throw error;
    }
  });

  if (allRows.length === 0) {
    throw new Error("No se encontraron clases validas para importar");
  }

  return allRows;
};
