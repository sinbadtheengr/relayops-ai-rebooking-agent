import { config } from "./config.js";

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(date + "T12:00:00Z"));
}

const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone });

export function todayIso(at = new Date()): string {
  return businessDate.format(at);
}

export function daysBetween(startIso: string, endIso = todayIso()): number {
  return Math.max(0, Math.floor((Date.parse(endIso) - Date.parse(startIso)) / 86_400_000));
}

export function shiftDay(day: string, count: number) {
  return new Date(Date.parse(day) + count * 86_400_000).toISOString().slice(0, 10);
}

// Find the first instant of the local date, including weeks crossing DST.
export function midnight(day: string) {
  let low = Date.parse(day) - 86_400_000,
    high = Date.parse(day) + 86_400_000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (todayIso(new Date(mid)) < day) low = mid + 1;
    else high = mid;
  }
  return new Date(low).toISOString();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
