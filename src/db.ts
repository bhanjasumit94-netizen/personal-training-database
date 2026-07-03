// Per-admin database module. Every record is scoped by `adminId` so that
// each admin sees only their own clients, payments, history, and
// settings. The Super Admin can switch between admin databases from the
// Admin Management page (read-only access to other admins' data).

import type { Admin } from "./auth";

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

const STORAGE_KEYS = {
  clients: "ptd_clients_v2",
  history: "ptd_history_v2",
  settings: "ptd_settings_v2",
} as const;

// Legacy v1 keys (pre-admin scoping). Migrated on first boot.
const LEGACY_KEYS = {
  clients: "ptd_clients",
  history: "ptd_history",
  settings: "ptd_settings",
} as const;

const DEFAULT_SETTINGS: Omit<Settings, "adminId"> = {
  ownerName: "",
  ownerImage: "",
  weatherPlace: "Kolkata, India",
  password: "4991",
};

let dbReady: Promise<void> | null = null;

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readAllClients = (): Client[] => {
  if (typeof window === "undefined") return [];
  return safeParse<Client[]>(localStorage.getItem(STORAGE_KEYS.clients), []);
};

const readAllHistory = (): PaymentHistory[] => {
  if (typeof window === "undefined") return [];
  return safeParse<PaymentHistory[]>(localStorage.getItem(STORAGE_KEYS.history), []);
};

const readAllSettings = (): Settings[] => {
  if (typeof window === "undefined") return [];
  return safeParse<Settings[]>(localStorage.getItem(STORAGE_KEYS.settings), []);
};

const writeAllClients = (list: Client[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(list));
};

const writeAllHistory = (list: PaymentHistory[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(list));
};

const writeAllSettings = (list: Settings[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(list));
};

// Migration: on first boot we copy any pre-admin data (legacy v1 keys)
// and tag it with the super admin's id so existing data is preserved.
export const migrateFromLocalStorage = async (currentAdmin: Admin | null): Promise<void> => {
  if (typeof window === "undefined") return;
  if (!currentAdmin) return;
  const hasNewClients = localStorage.getItem(STORAGE_KEYS.clients) !== null;
  const hasNewHistory = localStorage.getItem(STORAGE_KEYS.history) !== null;
  const hasNewSettings = localStorage.getItem(STORAGE_KEYS.settings) !== null;

  if (!hasNewClients) {
    const legacy = localStorage.getItem(LEGACY_KEYS.clients);
    if (legacy) {
      try {
        const list = JSON.parse(legacy) as Array<Record<string, unknown>>;
        const migrated = list.map((c) => ({ ...c, adminId: currentAdmin.id }));
        localStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(migrated));
      } catch {
        // ignore parse errors
      }
    }
  }

  if (!hasNewHistory) {
    const legacy = localStorage.getItem(LEGACY_KEYS.history);
    if (legacy) {
      try {
        const list = JSON.parse(legacy) as Array<Record<string, unknown>>;
        const migrated = list.map((h) => ({ ...h, adminId: currentAdmin.id }));
        localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(migrated));
      } catch {
        // ignore parse errors
      }
    }
  }

  if (!hasNewSettings) {
    const legacy = localStorage.getItem(LEGACY_KEYS.settings);
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy) as Record<string, unknown>;
        const migrated: Settings = {
          adminId: currentAdmin.id,
          ownerName: typeof parsed.ownerName === "string" ? parsed.ownerName : "",
          ownerImage: typeof parsed.ownerImage === "string" ? parsed.ownerImage : "",
          weatherPlace: typeof parsed.weatherPlace === "string" ? parsed.weatherPlace : DEFAULT_SETTINGS.weatherPlace,
          password: typeof parsed.password === "string" ? parsed.password : DEFAULT_SETTINGS.password,
        };
        localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify([migrated]));
      } catch {
        // ignore parse errors
      }
    }
  }
};

export const initDB = async (): Promise<void> => {
  if (dbReady) return dbReady;
  dbReady = new Promise<void>((resolve) => resolve());
  return dbReady;
};

// ----- scoped reads -----

export const getAllClients = async (adminId: string): Promise<Client[]> => {
  return readAllClients().filter((c) => c.adminId === adminId);
};

export const getAllHistory = async (adminId: string): Promise<PaymentHistory[]> => {
  return readAllHistory().filter((h) => h.adminId === adminId);
};

export const getSettings = async (adminId: string): Promise<Settings> => {
  const list = readAllSettings();
  const found = list.find((s) => s.adminId === adminId);
  if (found) return found;
  return { adminId, ...DEFAULT_SETTINGS };
};

// ----- scoped writes -----

export const saveAllClients = async (adminId: string, list: Client[]): Promise<void> => {
  if (typeof window === "undefined") return;
  const others = readAllClients().filter((c) => c.adminId !== adminId);
  // Force every record to be tagged with the calling admin. Prevents
  // data leakage even if a caller forgot to set adminId.
  const tagged = list.map((c) => ({ ...c, adminId }));
  writeAllClients([...others, ...tagged]);
};

export const saveAllHistory = async (adminId: string, list: PaymentHistory[]): Promise<void> => {
  if (typeof window === "undefined") return;
  const others = readAllHistory().filter((h) => h.adminId !== adminId);
  const tagged = list.map((h) => ({ ...h, adminId }));
  writeAllHistory([...others, ...tagged]);
};

export const saveSetting = async <K extends keyof Omit<Settings, "adminId">>(
  adminId: string,
  key: K,
  value: Settings[K],
): Promise<void> => {
  if (typeof window === "undefined") return;
  const all = readAllSettings();
  const idx = all.findIndex((s) => s.adminId === adminId);
  if (idx === -1) {
    all.push({ adminId, ...DEFAULT_SETTINGS, [key]: value } as Settings);
  } else {
    all[idx] = { ...all[idx], [key]: value };
  }
  writeAllSettings(all);
};

// Removes ALL data for an admin (used when an admin is deleted).
export const purgeAdminData = async (adminId: string): Promise<void> => {
  if (typeof window === "undefined") return;
  writeAllClients(readAllClients().filter((c) => c.adminId !== adminId));
  writeAllHistory(readAllHistory().filter((h) => h.adminId !== adminId));
  writeAllSettings(readAllSettings().filter((s) => s.adminId !== adminId));
};

// Legacy alias kept for the existing Reset System flow. It wipes the
// currently logged-in admin's data while preserving their password.
export const resetSystem = async (adminId: string): Promise<void> => {
  if (typeof window === "undefined") return;
  const currentPassword = (await getSettings(adminId)).password;
  writeAllClients(readAllClients().filter((c) => c.adminId !== adminId));
  writeAllHistory(readAllHistory().filter((h) => h.adminId !== adminId));
  writeAllSettings([
    {
      adminId,
      ownerName: "",
      ownerImage: "",
      weatherPlace: DEFAULT_SETTINGS.weatherPlace,
      password: currentPassword,
    },
  ]);
};
