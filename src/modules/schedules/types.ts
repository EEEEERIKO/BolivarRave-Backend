export type ParsedScheduleRow = {
  faculty: string;
  code: string;
  subject: string;
  teacher: string;
  startDate: Date;
  endDate: Date;
  day: string;
  room: string;
  startTime: string;
  endTime: string;
};

export type GroupedClass = {
  faculty: string;
  code: string;
  subject: string;
  teacher: string;
  startDate: Date;
  endDate: Date;
  color: "blue" | "emerald" | "amber" | "violet";
  slots: Array<{
    day: string;
    room: string;
    startTime: string;
    endTime: string;
  }>;
};
