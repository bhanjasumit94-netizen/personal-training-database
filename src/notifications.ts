// Per-admin notifications. Each record carries an `adminId` so a logged-in
// admin only ever sees their own notifications. Stored in Supabase.

import { getSupabase } from "./supabase";

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
  timestamp: string;
  read: boolean;
};

type SbNotificationRow = {
  id: string;
  admin_id: string;
  type: string;
  title: string;
  message: string;
  client_id: string | null;
  read: boolean;
  created_at: string;
};

const rowToNotification = (r: SbNotificationRow): AppNotification => ({
  id: r.id,
  adminId: r.admin_id,
  type: r.type as NotificationType,
  title: r.title,
  message: r.message,
  clientId: r.client_id ?? undefined,
  timestamp: r.created_at,
  read: r.read,
});

const notificationToRow = (n: AppNotification) => ({
  id: n.id,
  admin_id: n.adminId,
  type: n.type,
  title: n.title,
  message: n.message,
  client_id: n.clientId ?? null,
  read: n.read,
  created_at: n.timestamp,
});

export const fetchNotifications = async (
  adminId: string,
): Promise<AppNotification[]> => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("notifications")
    .select("*")
    .eq("admin_id", adminId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Supabase fetchNotifications: ${error.message}`);
  return (data as SbNotificationRow[]).map(rowToNotification);
};

// Backwards-compat: synchronous read returns []. Use fetchNotifications.
export const loadNotifications = (_adminId: string): AppNotification[] => [];

export const addNotification = async (
  adminId: string,
  n: Omit<AppNotification, "id" | "timestamp" | "read" | "adminId">,
): Promise<AppNotification> => {
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
  const sb = getSupabase();
  const { error } = await sb.from("notifications").insert(notificationToRow(created));
  if (error) throw new Error(`Supabase addNotification: ${error.message}`);
  return created;
};

export const markRead = async (adminId: string, id: string) => {
  const sb = getSupabase();
  const { error } = await sb
    .from("notifications")
    .update({ read: true })
    .eq("id", id)
    .eq("admin_id", adminId);
  if (error) throw new Error(`Supabase markRead: ${error.message}`);
};

export const markUnread = async (adminId: string, id: string) => {
  const sb = getSupabase();
  const { error } = await sb
    .from("notifications")
    .update({ read: false })
    .eq("id", id)
    .eq("admin_id", adminId);
  if (error) throw new Error(`Supabase markUnread: ${error.message}`);
};

export const markAllRead = async (adminId: string) => {
  const sb = getSupabase();
  const { error } = await sb
    .from("notifications")
    .update({ read: true })
    .eq("admin_id", adminId)
    .eq("read", false);
  if (error) throw new Error(`Supabase markAllRead: ${error.message}`);
};

export const clearAllNotifications = async (adminId: string) => {
  const sb = getSupabase();
  const { error } = await sb
    .from("notifications")
    .delete()
    .eq("admin_id", adminId);
  if (error) throw new Error(`Supabase clearAllNotifications: ${error.message}`);
};

// ----- grouping helpers (unchanged) -----

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

// ----- Realtime -----
export const subscribeNotifications = (
  adminId: string,
  onChange: (list: AppNotification[]) => void,
): (() => void) => {
  const sb = getSupabase();
  const channel = sb
    .channel(`notifications:${adminId}`)
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "notifications", filter: `admin_id=eq.${adminId}` },
      async () => {
        const list = await fetchNotifications(adminId);
        onChange(list);
      },
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
};
