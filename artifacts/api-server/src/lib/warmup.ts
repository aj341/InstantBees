export function warmupLimitForDay(day: number): number {
  if (day <= 3) return 5;
  if (day <= 7) return 10;
  if (day <= 12) return 15;
  if (day <= 17) return 20;
  if (day <= 21) return 25;
  return 30;
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

export function warmupDay(createdAt: Date | null | undefined, now = new Date()): number {
  if (!createdAt) return 1;
  const current = new Date(now);
  current.setHours(0, 0, 0, 0);
  const created = new Date(createdAt);
  if (!Number.isFinite(created.getTime())) return 1;
  created.setHours(0, 0, 0, 0);

  let count = 0;
  const cursor = new Date(created);
  while (cursor <= current) {
    if (isWeekday(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return Math.max(1, count);
}

export function effectiveWarmupLimit(
  dailyLimit: number,
  createdAt: Date | null | undefined,
  now = new Date(),
): number {
  return Math.max(1, Math.min(Math.max(1, dailyLimit), warmupLimitForDay(warmupDay(createdAt, now))));
}
