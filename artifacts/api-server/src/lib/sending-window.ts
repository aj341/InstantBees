type SendWindowConfig = {
  sendWindowStart?: string | null;
  sendWindowEnd?: string | null;
  sendWindowTimezone?: string | null;
  sendWindowDays?: string | null;
};

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_TO_KEY: Record<string, string> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

function minutesFromTime(value: string | null | undefined, fallback: number): number {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }
  return hours * 60 + minutes;
}

function allowedDays(value: string | null | undefined): Set<string> {
  const raw = String(value ?? "mon,tue,wed,thu,fri")
    .split(",")
    .map((day) => day.trim().slice(0, 3).toLowerCase())
    .filter((day) => DAY_KEYS.includes(day as (typeof DAY_KEYS)[number]));
  return new Set(raw.length > 0 ? raw : ["mon", "tue", "wed", "thu", "fri"]);
}

function localParts(date: Date, timezone: string): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: WEEKDAY_TO_KEY[value("weekday")] ?? value("weekday").slice(0, 3).toLowerCase(),
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

export function isInsideSendWindow(date: Date, config: SendWindowConfig): boolean {
  const timezone = config.sendWindowTimezone || "Australia/Sydney";
  const start = minutesFromTime(config.sendWindowStart, 7 * 60);
  const end = minutesFromTime(config.sendWindowEnd, 19 * 60);
  const local = localParts(date, timezone);
  return allowedDays(config.sendWindowDays).has(local.weekday) && local.minutes >= start && local.minutes < end;
}

export function nextSendWindowAt(date: Date, config: SendWindowConfig): Date {
  if (isInsideSendWindow(date, config)) return date;
  const cursor = new Date(date);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let i = 0; i < 16 * 24 * 60; i += 1) {
    if (isInsideSendWindow(cursor, config)) return cursor;
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return new Date(date.getTime() + 60 * 60 * 1000);
}
