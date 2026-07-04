// Per-admin database module. Every record is scoped by `adminId` so that
// each admin sees only their own clients, payments, history, and
// settings. The Super Admin can switch between admin databases from the
// Admin Management page (read-only access to other admins' data).
//
// All reads/writes go through Supabase. localStorage is no longer used.

import type { Admin } from "./auth";
import { getSupabase } from "./supabase";

export type Client = {
  id: string;
  adminId: string;
  name: string;
  phone: string;
  amount: number;
  payDate: string;
  dueDate: string;
  paid: boolean;
  photo: string;
  lastCyclePayDate?: string;
  lastCycleDueDate?: string;
  lastPaymentHistoryId?: string;
};

export type PaymentHistory = {
  id: string;
  adminId: string;
  clientId: string;
  clientName: string;
  amount: number;
  paidDate: string;
};

export type Settings = {
  adminId: string;
  ownerName: string;
  ownerImage: string;
  weatherPlace: string;
  password: string;
};

type SbClientRow = {
  id: string;
  admin_id: string;
  name: string;
  phone: string;
  amount: number | string;
  pay_date: string;
  due_date: string;
  paid: boolean;
  photo: string | null;
  last_cycle_pay_date: string | null;
  last_cycle_due_date: string | null;
  last_payment_history_id: string | null;
};

type SbPaymentRow = {
  id: string;
  admin_id: string;
  client_id: string;
  client_name: string;
  amount: number | string;
  paid_date: string;
};

type SbSettingsRow = {
  admin_id: string;
  owner_name: string | null;
  owner_image: string | null;
  weather_place: string | null;
};

const rowToClient = (r: SbClientRow): Client => ({
  id: r.id,
  adminId: r.admin_id,
  name: r.name,
  phone: r.phone,
  amount: Number(r.amount) || 0,
  payDate: r.pay_date,
  dueDate: r.due_date,
  paid: r.paid,
  photo: r.photo ?? "",
  lastCyclePayDate: r.last_cycle_pay_date ?? undefined,
  lastCycleDueDate: r.last_cycle_due_date ?? undefined,
  lastPaymentHistoryId: r.last_payment_history_id ?? undefined,
});

const rowToHistory = (r: SbPaymentRow): PaymentHistory => ({
  id: r.id,
  adminId: r.admin_id,
  clientId: r.client_id,
  clientName: r.client_name,
  amount: Number(r.amount) || 0,
  paidDate: r.paid_date,
});

const rowToSettings = (r: SbSettingsRow): Settings => ({
  adminId: r.admin_id,
  ownerName: r.owner_name ?? "",
  ownerImage: r.owner_image ?? "",
  weatherPlace: r.weather_place ?? "Kolkata, India",
  password: "",
});

const clientToRow = (c: Client) => ({
  id: c.id,
  admin_id: c.adminId,
  name: c.name,
  phone: c.phone,
  amount: c.amount,
  pay_date: c.payDate,
  due_date: c.dueDate,
  paid: c.paid,
  photo: c.photo || null,
  last_cycle_pay_date: c.lastCyclePayDate ?? null,
  last_cycle_due_date: c.lastCycleDueDate ?? null,
  last_payment_history_id: c.lastPaymentHistoryId ?? null,
});

const historyToRow = (h: PaymentHistory) => ({
  id: h.id,
  admin_id: h.adminId,
  client_id: h.clientId,
  client_name: h.clientName,
  amount: h.amount,
  paid_date: h.paidDate,
});

const settingsToRow = (s: Settings) => ({
  admin_id: s.adminId,
  owner_name: s.ownerName || null,
  owner_image: s.ownerImage || null,
  weather_place: s.weatherPlace || "Kolkata, India",
});

export const initDB = async (): Promise<void> => {
  // Supabase is always available now; no local seed needed.
};

export const migrateFromLocalStorage = async (
  _currentAdmin: Admin | null,
): Promise<void> => {
  // No-op: localStorage is no longer used.
};

// ----- scoped reads -----

export const getAllClients = async (adminId: string): Promise<Client[]> => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("clients")
    .select("*")
    .eq("admin_id", adminId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase getAllClients: ${error.message}`);
  return (data as SbClientRow[]).map(rowToClient);
};

export const getAllHistory = async (adminId: string): Promise<PaymentHistory[]> => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("payment_history")
    .select("*")
    .eq("admin_id", adminId)
    .order("paid_date", { ascending: false });
  if (error) throw new Error(`Supabase getAllHistory: ${error.message}`);
  return (data as SbPaymentRow[]).map(rowToHistory);
};

export const getSettings = async (adminId: string): Promise<Settings> => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("admin_settings")
    .select("*")
    .eq("admin_id", adminId)
    .maybeSingle();
  if (error) throw new Error(`Supabase getSettings: ${error.message}`);
  if (data) return rowToSettings(data as SbSettingsRow);
  // No row yet — return defaults.
  return {
    adminId,
    ownerName: "",
    ownerImage: "",
    weatherPlace: "Kolkata, India",
    password: "",
  };
};

// ----- scoped writes -----

export const saveAllClients = async (adminId: string, list: Client[]): Promise<void> => {
  const sb = getSupabase();
  const owned = list
    .filter((c) => c.adminId === adminId)
    .map((c) => ({ ...c, adminId }));

  // Delete rows that the caller no longer holds (so the server
  // matches the client state). Then upsert the current set.
  const { data: existing } = await sb
    .from("clients")
    .select("id")
    .eq("admin_id", adminId);
  const existingIds = new Set(((existing ?? []) as Array<{ id: string }>).map((r) => r.id));
  const keepIds = new Set(owned.map((c) => c.id));
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    await sb.from("clients").delete().in("id", toDelete);
  }
  if (owned.length > 0) {
    const { error } = await sb
      .from("clients")
      .upsert(owned.map(clientToRow), { onConflict: "id" });
    if (error) throw new Error(`Supabase upsert clients: ${error.message}`);
  }
};

export const saveAllHistory = async (adminId: string, list: PaymentHistory[]): Promise<void> => {
  const sb = getSupabase();
  const owned = list
    .filter((h) => h.adminId === adminId)
    .map((h) => ({ ...h, adminId }));

  const { data: existing } = await sb
    .from("payment_history")
    .select("id")
    .eq("admin_id", adminId);
  const existingIds = new Set(((existing ?? []) as Array<{ id: string }>).map((r) => r.id));
  const keepIds = new Set(owned.map((h) => h.id));
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    await sb.from("payment_history").delete().in("id", toDelete);
  }
  if (owned.length > 0) {
    const { error } = await sb
      .from("payment_history")
      .upsert(owned.map(historyToRow), { onConflict: "id" });
    if (error) throw new Error(`Supabase upsert history: ${error.message}`);
  }
};

export const saveSetting = async <K extends keyof Omit<Settings, "adminId">>(
  adminId: string,
  key: K,
  value: Settings[K],
): Promise<void> => {
  const sb = getSupabase();
  const current = await getSettings(adminId);
  const next: Settings = { ...current, [key]: value, adminId };
  const { error } = await sb
    .from("admin_settings")
    .upsert(settingsToRow(next), { onConflict: "admin_id" });
  if (error) throw new Error(`Supabase upsert settings: ${error.message}`);
};

export const purgeAdminData = async (adminId: string): Promise<void> => {
  const sb = getSupabase();
  await sb.from("payment_history").delete().eq("admin_id", adminId);
  await sb.from("clients").delete().eq("admin_id", adminId);
  await sb.from("notifications").delete().eq("admin_id", adminId);
  await sb.from("admin_settings").delete().eq("admin_id", adminId);
};

export const resetSystem = async (adminId: string): Promise<void> => {
  const sb = getSupabase();
  await sb.from("payment_history").delete().eq("admin_id", adminId);
  await sb.from("clients").delete().eq("admin_id", adminId);
  await sb.from("notifications").delete().eq("admin_id", adminId);
  await sb
    .from("admin_settings")
    .upsert({
      admin_id: adminId,
      owner_name: "",
      owner_image: "",
      weather_place: "Kolkata, India",
    });
};

// ----- Realtime -----
export const subscribeClients = (
  adminId: string,
  onChange: (clients: Client[]) => void,
): (() => void) => {
  const sb = getSupabase();
  const channel = sb
    .channel(`clients:${adminId}`)
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "clients", filter: `admin_id=eq.${adminId}` },
      async () => {
        const list = await getAllClients(adminId);
        onChange(list);
      },
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
};

export const subscribeHistory = (
  adminId: string,
  onChange: (history: PaymentHistory[]) => void,
): (() => void) => {
  const sb = getSupabase();
  const channel = sb
    .channel(`payment_history:${adminId}`)
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "postgres_changes" as any,
      { event: "*", schema: "public", table: "payment_history", filter: `admin_id=eq.${adminId}` },
      async () => {
        const list = await getAllHistory(adminId);
        onChange(list);
      },
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
};
