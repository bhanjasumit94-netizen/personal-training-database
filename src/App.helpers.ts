// Shared helpers extracted from the original App.tsx so they can be reused
// by feature components (ClientDetailsPopup, SearchPanel, etc.) without
// pulling in the full App component.

const MS_IN_DAY = 24 * 60 * 60 * 1000;

export const toIsoDate = (date = new Date()) => {
  const localDate = new Date(date);
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, "0");
  const day = String(localDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const parseIsoDateLocal = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map((value) => Number(value));
  if (!year || !month || !day) return null;
  const localDate = new Date(year, month - 1, day);
  if (Number.isNaN(localDate.getTime())) return null;
  return localDate;
};

export const formatDate = (isoDate: string) => {
  if (!isoDate) return "-";
  const d = parseIsoDateLocal(isoDate);
  if (!d) return "-";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export const formatDateDayMonth = (isoDate: string) => {
  if (!isoDate) return "-";
  const d = parseIsoDateLocal(isoDate);
  if (!d) return "-";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
};

export const getDaysUntilDue = (dueDate: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return Number.NaN;
  return Math.round((due.getTime() - today.getTime()) / MS_IN_DAY);
};

export type ClientStatus = "upcoming" | "due" | "overdue" | "unknown";

export const getClientStatus = (dueDate: string): ClientStatus => {
  const days = getDaysUntilDue(dueDate);
  if (Number.isNaN(days)) return "unknown";
  if (days < 0) return "overdue";
  if (days === 0) return "due";
  return "upcoming";
};

export const statusToLabel = (status: ClientStatus, daysUntilDue: number) => {
  switch (status) {
    case "overdue":
      return `${Math.abs(daysUntilDue)}d Overdue`;
    case "due":
      return "Due Today";
    case "upcoming":
      return `${daysUntilDue}d left`;
    default:
      return "Unknown";
  }
};

export const statusBadgeClass = (status: ClientStatus) => {
  switch (status) {
    case "overdue":
      return "bg-rose-500/20 text-rose-300 border-rose-500/40";
    case "due":
      return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    case "upcoming":
      return "bg-sky-500/20 text-sky-300 border-sky-500/40";
    default:
      return "bg-zinc-500/20 text-zinc-300 border-zinc-500/40";
  }
};

// ---------------------------------------------------------------------------
// Training Duration
// ---------------------------------------------------------------------------
// "Training Duration" = how long the client has been under guidance,
// counted from the client's original joining date (`payDate`). The counter
// is NOT reset on payment renewal — only on permanent deletion of the
// client. This is a pure function over an ISO date string so it stays in
// sync with the calendar (no cache, no clock-drift). Re-rendering the UI
// automatically reflects the latest value because the App component
// re-renders whenever the `clients` array changes.
export interface TrainingDuration {
  days: number;        // exact day count (>= 0)
  months: number;      // full months elapsed (>= 0)
  years: number;       // full years elapsed (>= 0)
  label: string;       // formatted display string per the spec
}

/**
 * Parse an ISO date string (YYYY-MM-DD) as a local date — never as UTC.
 * This is critical: a UTC parse would shift the day by one for users
 * west of GMT, which would over- or under-count a single-day client.
 */
const parseJoinDateLocal = (iso: string): Date | null => {
  const d = parseIsoDateLocal(iso);
  return d;
};

/**
 * Compute the training duration from an ISO join date. Returns null if
 * the join date is missing or invalid (e.g. user typed a future date).
 */
export const getTrainingDuration = (joinDateIso: string | undefined): TrainingDuration | null => {
  if (!joinDateIso) return null;
  const start = parseJoinDateLocal(joinDateIso);
  if (!start) return null;

  // Anchor "today" at local midnight so the day count is exact.
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (today.getTime() < start.getTime()) return null;

  // 1) Exact day count
  const days = Math.round((today.getTime() - start.getTime()) / MS_IN_DAY);

  // 2) Calendar years + months. We walk month-by-month from the start
  //    date to "now" so we get correct values like 1y 3m, 6m, 14d, etc.
  let years = today.getFullYear() - start.getFullYear();
  let months = today.getMonth() - start.getMonth();
  if (today.getDate() < start.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) {
    years = 0;
    months = 0;
  }

  // 3) Pick the display label per the spec.
  let label: string;
  if (days < 30) {
    // Less than 30 days → "Training: X Days"
    label = `Training: ${days} ${days === 1 ? "Day" : "Days"}`;
  } else if (years === 0 && months < 12) {
    // 1 month, 2 months, 6 months
    label = `Training: ${months} ${months === 1 ? "Month" : "Months"}`;
  } else if (years === 0) {
    // 12 months but computed as 0y 12m — present as 1 Year
    label = `Training: 1 Year`;
  } else if (months === 0) {
    // Exact 1 year, 2 years, etc.
    label = `Training: ${years} ${years === 1 ? "Year" : "Years"}`;
  } else {
    // Mixed years + months: "Training: 1 Year 3 Months"
    label = `Training: ${years} ${years === 1 ? "Year" : "Years"} ${months} ${months === 1 ? "Month" : "Months"}`;
  }

  return { days, months, years, label };
};
