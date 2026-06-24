export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(cents / 100);
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00Z`));
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(startIso: string, endIso = todayIso()): number {
  const start = new Date(`${startIso}T12:00:00Z`).getTime();
  const end = new Date(`${endIso}T12:00:00Z`).getTime();
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

