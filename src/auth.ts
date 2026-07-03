// Multi-admin authentication system.
//
// AUTH_MODE is "dummy" by default (for local dev). When Supabase env vars
// are provided at build time, it automatically switches to "supabase".
//
// Two roles:
//   - "super_admin" can manage admins and view any admin's data (read-only).
//   - "admin" can only access their own data.
//
// All client/payment/notification data is scoped by adminId. The app boots
// into a "no session" state; the LoginScreen is shown until the user logs in.

export type AuthRole = "super_admin" | "admin";

export type AdminStatus = "active" | "disabled";

export type Admin = {
  id: string;
  email: string;
  // Stored as a SHA-256 hex digest. Never the plain text.
  passwordHash: string;
  name: string;
  phone: string;
  photo: string;
  role: AuthRole;
  status: AdminStatus;
  createdAt: string; // ISO datetime
  lastLogin: string; // ISO datetime
};

// Build-time configuration. Vite exposes anything prefixed with VITE_ on
// import.meta.env. When both are present we assume Supabase is configured.
const SUPABASE_URL: string | undefined = (import.meta as any).env?.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY: string | undefined = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;

export const AUTH_MODE: "dummy" | "supabase" =
  SUPABASE_URL && SUPABASE_ANON_KEY ? "supabase" : "dummy";

// In dummy mode these are seeded into the local store on first launch.
export const DUMMY_ACCOUNTS: Array<{
  email: string;
  password: string;
  role: AuthRole;
  name: string;
  phone: string;
}> = [
  { email: "superadmin@test.com", password: "admin123", role: "super_admin", name: "Super Admin", phone: "" },
  { email: "admin1@test.com", password: "admin123", role: "admin", name: "Admin One", phone: "" },
  { email: "admin2@test.com", password: "admin123", role: "admin", name: "Admin Two", phone: "" },
];

const STORAGE_KEY = "ptd_admins_v1";
const SESSION_KEY = "ptd_session_v1";
const REMEMBER_KEY = "ptd_remember_v1";

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

// Tiny, dependency-free SHA-256 hex digest. Sufficient for a local-only
// dummy-mode credential store; production uses Supabase Auth.
export const hashPassword = async (password: string): Promise<string> => {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    // Very rare fallback (e.g. very old browsers) — not cryptographically
    // strong but enough to prevent plain-text at-rest credentials.
    let h = 5381;
    for (let i = 0; i < password.length; i += 1) h = (h * 33) ^ password.charCodeAt(i);
    return `weak-${(h >>> 0).toString(16)}`;
  }
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ----- admin storage -----

const readAdmins = (): Admin[] => {
  if (typeof window === "undefined") return [];
  return safeParse<Admin[]>(localStorage.getItem(STORAGE_KEY), []);
};

const writeAdmins = (admins: Admin[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(admins));
};

// Seed dummy accounts the first time the dummy store is used.
export const ensureDummySeed = async (): Promise<void> => {
  if (AUTH_MODE !== "dummy") return;
  const admins = readAdmins();
  if (admins.length > 0) return;
  const seeded: Admin[] = [];
  for (const acc of DUMMY_ACCOUNTS) {
    seeded.push({
      id: crypto.randomUUID(),
      email: acc.email.toLowerCase(),
      passwordHash: await hashPassword(acc.password),
      name: acc.name,
      phone: acc.phone,
      photo: "",
      role: acc.role,
      status: "active",
      createdAt: new Date().toISOString(),
      lastLogin: "",
    });
  }
  writeAdmins(seeded);
};

// ----- session -----

export type Session = {
  adminId: string;
  role: AuthRole;
  // ISO datetime of session creation; used for re-validation.
  startedAt: string;
};

export const loadSession = (): Session | null => {
  if (typeof window === "undefined") return null;
  return safeParse<Session | null>(localStorage.getItem(SESSION_KEY), null);
};

const writeSession = (session: Session | null) => {
  if (typeof window === "undefined") return;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
};

export const isRememberMeEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(REMEMBER_KEY) === "1";
};

const setRememberMe = (on: boolean) => {
  if (typeof window === "undefined") return;
  if (on) localStorage.setItem(REMEMBER_KEY, "1");
  else localStorage.removeItem(REMEMBER_KEY);
};

// ----- auth actions -----

export type LoginResult = { ok: true; session: Session; admin: Admin } | { ok: false; error: string };

export const login = async (
  email: string,
  password: string,
  rememberMe: boolean,
): Promise<LoginResult> => {
  if (AUTH_MODE !== "dummy") {
    // Placeholder for Supabase path; not implemented in dummy build.
    return { ok: false, error: "Supabase auth not configured in this build." };
  }
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) return { ok: false, error: "Please enter a valid email address." };
  if (!password) return { ok: false, error: "Please enter your password." };

  const admins = readAdmins();
  const hash = await hashPassword(password);
  const admin = admins.find((a) => a.email === normalized && a.passwordHash === hash);
  if (!admin) return { ok: false, error: "Invalid email or password." };
  if (admin.status === "disabled") {
    return { ok: false, error: "This account is disabled. Contact the Super Admin." };
  }
  // Update lastLogin
  admin.lastLogin = new Date().toISOString();
  writeAdmins(admins.map((a) => (a.id === admin.id ? admin : a)));

  const session: Session = {
    adminId: admin.id,
    role: admin.role,
    startedAt: new Date().toISOString(),
  };
  writeSession(session);
  setRememberMe(rememberMe);
  return { ok: true, session, admin };
};

export const logout = () => {
  writeSession(null);
  setRememberMe(false);
};

export const restoreRememberedSession = (): Session | null => {
  if (!isRememberMeEnabled()) return null;
  return loadSession();
};

// ----- admin management (super admin only) -----

export const listAdmins = (): Admin[] => readAdmins();

export const getAdminById = (id: string): Admin | null => readAdmins().find((a) => a.id === id) ?? null;

export type CreateAdminInput = {
  email: string;
  password: string;
  name: string;
  phone: string;
  photo: string;
};

export const createAdmin = async (input: CreateAdminInput): Promise<{ ok: true; admin: Admin } | { ok: false; error: string }> => {
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: false, error: "Invalid email address." };
  if (input.password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  if (!input.name.trim()) return { ok: false, error: "Name is required." };
  const admins = readAdmins();
  if (admins.some((a) => a.email === email)) {
    return { ok: false, error: "An account with this email already exists." };
  }
  const admin: Admin = {
    id: crypto.randomUUID(),
    email,
    passwordHash: await hashPassword(input.password),
    name: input.name.trim(),
    phone: input.phone.trim(),
    photo: input.photo,
    role: "admin",
    status: "active",
    createdAt: new Date().toISOString(),
    lastLogin: "",
  };
  writeAdmins([...admins, admin]);
  return { ok: true, admin };
};

export type UpdateAdminInput = {
  name?: string;
  phone?: string;
  photo?: string;
  email?: string;
};

export const updateAdmin = (
  id: string,
  patch: UpdateAdminInput,
): { ok: true; admin: Admin } | { ok: false; error: string } => {
  const admins = readAdmins();
  const target = admins.find((a) => a.id === id);
  if (!target) return { ok: false, error: "Admin not found." };
  if (target.role === "super_admin" && patch.email && patch.email.toLowerCase() !== target.email) {
    return { ok: false, error: "Super Admin email cannot be changed." };
  }
  if (patch.email) {
    const email = patch.email.trim().toLowerCase();
    if (!isValidEmail(email)) return { ok: false, error: "Invalid email address." };
    if (admins.some((a) => a.id !== id && a.email === email)) {
      return { ok: false, error: "Another account already uses this email." };
    }
    target.email = email;
  }
  if (typeof patch.name === "string") target.name = patch.name.trim() || target.name;
  if (typeof patch.phone === "string") target.phone = patch.phone.trim();
  if (typeof patch.photo === "string") target.photo = patch.photo;
  writeAdmins(admins.map((a) => (a.id === id ? target : a)));
  return { ok: true, admin: target };
};

export const setAdminStatus = (id: string, status: AdminStatus): { ok: true } | { ok: false; error: string } => {
  const admins = readAdmins();
  const target = admins.find((a) => a.id === id);
  if (!target) return { ok: false, error: "Admin not found." };
  if (target.role === "super_admin") {
    return { ok: false, error: "Super Admin cannot be disabled." };
  }
  target.status = status;
  writeAdmins(admins.map((a) => (a.id === id ? target : a)));
  // If disabling the currently logged-in admin, drop their session.
  const session = loadSession();
  if (session && session.adminId === id && status === "disabled") {
    writeSession(null);
  }
  return { ok: true };
};

export const deleteAdmin = (id: string): { ok: true } | { ok: false; error: string } => {
  const admins = readAdmins();
  const target = admins.find((a) => a.id === id);
  if (!target) return { ok: false, error: "Admin not found." };
  if (target.role === "super_admin") {
    return { ok: false, error: "Super Admin cannot be deleted." };
  }
  writeAdmins(admins.filter((a) => a.id !== id));
  // Drop the session if we just deleted the active admin.
  const session = loadSession();
  if (session && session.adminId === id) writeSession(null);
  return { ok: true };
};

export const resetAdminPassword = async (
  id: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (newPassword.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  const admins = readAdmins();
  const target = admins.find((a) => a.id === id);
  if (!target) return { ok: false, error: "Admin not found." };
  target.passwordHash = await hashPassword(newPassword);
  writeAdmins(admins.map((a) => (a.id === id ? target : a)));
  // Force the affected admin to log in again.
  const session = loadSession();
  if (session && session.adminId === id) writeSession(null);
  return { ok: true };
};

export const changeOwnPassword = async (
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const session = loadSession();
  if (!session) return { ok: false, error: "Not logged in." };
  if (newPassword.length < 6) return { ok: false, error: "New password must be at least 6 characters." };
  const admins = readAdmins();
  const target = admins.find((a) => a.id === session.adminId);
  if (!target) return { ok: false, error: "Account not found." };
  const currentHash = await hashPassword(currentPassword);
  if (currentHash !== target.passwordHash) return { ok: false, error: "Current password is incorrect." };
  target.passwordHash = await hashPassword(newPassword);
  writeAdmins(admins.map((a) => (a.id === target.id ? target : a)));
  // Invalidate the existing session.
  writeSession(null);
  return { ok: true };
};

// Counts all client records for an admin (used in the admin management table).
export const countClientsForAdmin = (adminId: string): number => {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem("ptd_clients_v2");
  if (!raw) return 0;
  try {
    const list = JSON.parse(raw) as Array<{ adminId?: string }>;
    return list.filter((c) => c.adminId === adminId).length;
  } catch {
    return 0;
  }
};
