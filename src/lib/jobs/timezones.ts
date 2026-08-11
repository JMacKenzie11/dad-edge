import { toZonedTime } from "date-fns-tz";
import { format } from "date-fns";

/**
 * Return the local wall-clock hour (0-23) in `timezone`, at the given moment.
 */
export function localHour(now: Date, timezone: string): number {
  return Number(format(toZonedTime(now, timezone), "H"));
}

export function localMinute(now: Date, timezone: string): number {
  return Number(format(toZonedTime(now, timezone), "m"));
}

/**
 * True if the reminder time falls inside the current cron window.
 * We assume the cron fires roughly hourly on the hour; a reminder scheduled
 * at HH:MM triggers when the local hour equals HH and the local minute is
 * within `windowMinutes` of MM.
 */
export function isWithinReminderWindow(
  now: Date,
  timezone: string,
  reminderTime: string,
  windowMinutes = 30,
): boolean {
  const [rh, rm] = reminderTime.split(":").map(Number);
  const zonedH = localHour(now, timezone);
  const zonedM = localMinute(now, timezone);
  return zonedH === rh && Math.abs(zonedM - rm) <= windowMinutes;
}
