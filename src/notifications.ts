// Per-admin notifications. Each record carries an `adminId` so a logged-in
// admin only ever sees their own notifications.

export type NotificationType =
  | "new_client"
  | "payment_received"
  | "due_today"
  | "overdue"
  | "client_edited"
  | "client_deleted"
  | "upcoming_reminder";

export type AppNotification = {
  id: string;
  adminId: string;
  type: NotificationType;
  title: string;
  message: string;
  clientId?: string;
  timestamp: string; // ISO datetime
  read: boolean;
};

const STORAGE_KEY = "ptd_notifications_v1";
const MAX_NOTIFICATIONS = 200;

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readAll = (): AppNotification[] => {
  if (typeof window === "undefined") return [];
  return safeParse<AppNotification[]>(localStorage.getItem(STORAGE_KEY), []);
};

const writeAll = (list: AppNotification[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_NOTIFICATIONS)));
};

export const loadNotifications = (adminId: string): AppNotification[] => {
  return readAll().filter((n) => n.adminId === adminId);
};

export const addNotification = (
  adminId: string,
  n: Omit<AppNotification, "id" | "timestamp" | "read" | "adminId">,
): AppNotification => {
  const created: AppNotification = {
    ...n,
    adminId,
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    read: false,
  };
  const list = [created, ...readAll()];
  writeAll(list);
  return created;
};

export const markRead = (adminId: string, id: string) => {
  const list = readAll().map((n) => (n.id === id && n.adminId === adminId ? { ...n, read: true } : n));
  writeAll(list);
};

export const markUnread = (adminId: string, id: string) => {
  const list = readAll().map((n) => (n.id === id && n.adminId === adminId ? { ...n, read: false } : n));
  writeAll(list);
};

export const markAllRead = (adminId: string) => {
  const list = readAll().map((n) => (n.adminId === adminId ? { ...n, read: true } : n));
  writeAll(list);
};

export const clearAllNotifications = (adminId: string) => {
  const list = readAll().filter((n) => n.adminId !== adminId);
  writeAll(list);
};

export const groupKeyForTimestamp = (iso: string): "today" | "yesterday" | "older" => {
  const date = new Date(iso);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(date)) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  return "older";
};

export const formatNotificationTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

export const formatNotificationDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
