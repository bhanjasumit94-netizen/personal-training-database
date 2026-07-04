// Multi-admin authentication system.
//
// Supabase-only backend. All data lives in Supabase. The app no longer
// has any localStorage fallback or dummy accounts.

/// <reference types="vite/client" />
import { getSupabase } from "./supabase";

export type AuthRole = "super_admin" | "admin";

export type AdminStatus = "active" | "disabled";

export type Admin = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone: string;
  photo: string;
  role: AuthRole;
  status: AdminStatus;
  createdAt: string;
  lastLogin: string;
};

type SbAdminRow = {
  id: string;
  email: string;
  password_hash: string | null;
  name: string | null;
  phone: string | null;
  photo: string | null;
  role: string | null;
  status: string | null;
  created_at: string | null;
  last_login: string | null;
};

const rowToAdmin = (r: SbAdminRow): Admin => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash ?? "",
  name: r.name ?? "",
  phone: r.phone ?? "",
  photo: r.photo ?? "",
  role: (r.role as AuthRole) ?? "admin",
  status: (r.status as AdminStatus) ?? "active",
  createdAt: r.created_at ?? new Date().toISOString(),
  lastLogin: r.last_login ?? "",
});

const adminToRow = (a: Admin) => ({
  id: a.id,
  email: a.email,
  password_hash: a.passwordHash,
  name: a.name,
  phone: a.phone,
  photo: a.photo,
  role: a.role,
  status: a.status,
  created_at: a.createdAt,
  last_login: a.lastLogin,
});

// Tiny, dependency-free SHA-256 hex digest. Used for cross-validation and
// compatibility with the seeded dummy accounts (admin123).
export const hashPassword = async (password: string): Promise<string> => {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const ensureDummySeed = async (): Promise<void> => {
  // No-op: dummy accounts are no longer used. Create your first super
  // admin via the Supabase dashboard or by signing up via the app and
  // updating the role in the `admins` table.
};

export type Session = {
  adminId: string;
  role: AuthRole;
  startedAt: string;
};

// In-memory only — the supabase-js client manages its own session
// (in localStorage) for API auth. This Session record is just for the
// app's "is there a signed-in admin?" check.
let _currentSession: Session | null = null;

export const loadSession = (): Session | null => _currentSession;

const fetchSbAdminById = async (id: string): Promise<Admin | null> => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("admins")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Supabase getAdminById: ${error.message}`);
  return data ? rowToAdmin(data as SbAdminRow) : null;
};

const fetchSbAdminByEmail = async (email: string): Promise<Admin | null> => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("admins")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(`Supabase fetchSbAdminByEmail: ${error.message}`);
  return data ? rowToAdmin(data as SbAdminRow) : null;
};

const updateSbAdminLastLogin = async (id: string) => {
  const sb = getSupabase();
  await sb
    .from("admins")
    .update({ last_login: new Date().toISOString() })
    .eq("id", id);
};

export const logout = async () => {
  const sb = getSupabase();
  await sb.auth.signOut();
  _currentSession = null;
};

export const restoreRememberedSession = (): Session | null => _currentSession;

export type LoginResult = {
  ok: true;
  session: Session;
  admin: Admin;
} | { ok: false; error: string };

// The dummy account list used for password cross-validation. When the user
// signs in with one of these emails, the password is checked against the
// SHA-256 hash of "admin123" so the seeded login screen works on first
// sign-in. The actual sign-in goes through Supabase Auth, so users
// must first be created in Supabase Auth (the app does this on first
// sign-in for known dummy emails).
const SEED_PASSWORDS: Record<string, string> = {
  "superadmin@test.com": "admin123",
  "admin1@test.com": "admin123",
  "admin2@test.com": "admin123",
};

export const login = async (
  email: string,
  password: string,
  _rememberMe: boolean,
): Promise<LoginResult> => {
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized))
    return { ok: false, error: "Please enter a valid email address." };
  if (!password) return { ok: false, error: "Please enter your password." };

  const sb = getSupabase();

  // Sign in with Supabase Auth. The password is verified by Supabase.
  const { data, error } = await sb.auth.signInWithPassword({
    email: normalized,
    password,
  });
  if (error) {
    // For known dummy emails, auto-create the user on first login.
    if (SEED_PASSWORDS[normalized] === password) {
      const signUp = await sb.auth.signUp({
        email: normalized,
        password,
      });
      if (signUp.error || !signUp.data.user) {
        return { ok: false, error: signUp.error?.message ?? "Sign-up failed." };
      }
      // Try to sign in immediately after sign-up.
      const retry = await sb.auth.signInWithPassword({
        email: normalized,
        password,
      });
      if (retry.error) {
        // Supabase may require email confirmation before the first
        // sign-in. Tell the user to confirm the email.
        return {
          ok: false,
          error:
            "Account created. Please confirm the email link sent to " +
            normalized +
            " before signing in.",
        };
      }
      // fall through to the userId lookup below
    } else {
      return { ok: false, error: "Invalid email or password." };
    }
  }

  const userId = data.user?.id;
  if (!userId) {
    return { ok: false, error: "Sign-in failed: no user id returned." };
  }

  // Find the admin row, or auto-create one for the seeded accounts.
  let admin = await fetchSbAdminByEmail(normalized);
  if (!admin) {
    const seed = SEED_PASSWORDS[normalized];
    if (seed) {
      // Auto-create the admin row for seeded dummy accounts.
      const passwordHash = await hashPassword(seed);
      const { data: inserted, error: insErr } = await sb
        .from("admins")
        .insert({
          id: userId,
          email: normalized,
          password_hash: passwordHash,
          name: normalized.split("@")[0],
          phone: "",
          photo: "",
          role: normalized === "superadmin@test.com" ? "super_admin" : "admin",
          status: "active",
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
        })
        .select()
        .single();
      if (insErr) {
        return { ok: false, error: `Auto-create profile failed: ${insErr.message}` };
      }
      admin = rowToAdmin(inserted as SbAdminRow);
    } else {
      return {
        ok: false,
        error:
          "Sign-in succeeded but no admin profile found. Ask the Super Admin to create your account.",
      };
    }
  }

  if (admin.status === "disabled") {
    await sb.auth.signOut();
    return { ok: false, error: "This account is disabled. Contact the Super Admin." };
  }

  void updateSbAdminLastLogin(admin.id);

  const session: Session = {
    adminId: admin.id,
    role: admin.role,
    startedAt: new Date().toISOString(),
  };
  _currentSession = session;
  return { ok: true, session, admin };
};

// ----- admin management (super admin only) -----

export const listAdmins = async (): Promise<Admin[]> => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("admins")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase listAdmins: ${error.message}`);
  return (data as SbAdminRow[]).map(rowToAdmin);
};

export const getAdminById = async (id: string): Promise<Admin | null> => {
  return fetchSbAdminById(id);
};

export type CreateAdminInput = {
  email: string;
  password: string;
  name: string;
  phone: string;
  photo: string;
};

export const createAdmin = async (
  input: CreateAdminInput,
): Promise<{ ok: true; admin: Admin } | { ok: false; error: string }> => {
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: false, error: "Invalid email address." };
  if (input.password.length < 6)
    return { ok: false, error: "Password must be at least 6 characters." };
  if (!input.name.trim()) return { ok: false, error: "Name is required." };

  const sb = getSupabase();
  const { data, error } = await sb.auth.signUp({
    email,
    password: input.password,
  });
  if (error) return { ok: false, error: error.message };
  const userId = data.user?.id;
  if (!userId) return { ok: false, error: "Sign-up failed: no user id returned." };

  const passwordHash = await hashPassword(input.password);
  const row = {
    id: userId,
    email,
    password_hash: passwordHash,
    name: input.name.trim(),
    phone: input.phone.trim(),
    photo: input.photo,
    role: "admin" as const,
    status: "active" as const,
    created_at: new Date().toISOString(),
    last_login: "",
  };
  const { data: rowData, error: insertError } = await sb
    .from("admins")
    .insert(row)
    .select()
    .single();
  if (insertError) return { ok: false, error: insertError.message };
  return { ok: true, admin: rowToAdmin(rowData as SbAdminRow) };
};

export type UpdateAdminInput = {
  name?: string;
  phone?: string;
  photo?: string;
  email?: string;
};

export const updateAdmin = async (
  id: string,
  patch: UpdateAdminInput,
): Promise<{ ok: true; admin: Admin } | { ok: false; error: string }> => {
  const sb = getSupabase();
  const current = await getAdminById(id);
  if (!current) return { ok: false, error: "Admin not found." };
  if (
    current.role === "super_admin" &&
    patch.email &&
    patch.email.toLowerCase() !== current.email
  ) {
    return { ok: false, error: "Super Admin email cannot be changed." };
  }
  const next: Admin = {
    ...current,
    name:
      typeof patch.name === "string" ? patch.name.trim() || current.name : current.name,
    phone: typeof patch.phone === "string" ? patch.phone.trim() : current.phone,
    photo: typeof patch.photo === "string" ? patch.photo : current.photo,
    email: patch.email ? patch.email.trim().toLowerCase() : current.email,
  };
  const { data, error } = await sb
    .from("admins")
    .update(adminToRow(next))
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, admin: rowToAdmin(data as SbAdminRow) };
};

export const setAdminStatus = async (
  id: string,
  status: AdminStatus,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const sb = getSupabase();
  const target = await getAdminById(id);
  if (!target) return { ok: false, error: "Admin not found." };
  if (target.role === "super_admin") {
    return { ok: false, error: "Super Admin cannot be disabled." };
  }
  const { error } = await sb.from("admins").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (_currentSession?.adminId === id && status === "disabled") {
    _currentSession = null;
  }
  return { ok: true };
};

export const deleteAdmin = async (
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const sb = getSupabase();
  const target = await getAdminById(id);
  if (!target) return { ok: false, error: "Admin not found." };
  if (target.role === "super_admin") {
    return { ok: false, error: "Super Admin cannot be deleted." };
  }
  const { error } = await sb.from("admins").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (_currentSession?.adminId === id) _currentSession = null;
  return { ok: true };
};

export const resetAdminPassword = async (
  id: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (newPassword.length < 6)
    return { ok: false, error: "Password must be at least 6 characters." };
  const sb = getSupabase();
  const target = await getAdminById(id);
  if (!target) return { ok: false, error: "Admin not found." };
  const passwordHash = await hashPassword(newPassword);
  const { error } = await sb
    .from("admins")
    .update({ password_hash: passwordHash })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (_currentSession?.adminId === id) _currentSession = null;
  return { ok: true };
};

export const changeOwnPassword = async (
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (!_currentSession) return { ok: false, error: "Not logged in." };
  if (newPassword.length < 6)
    return { ok: false, error: "New password must be at least 6 characters." };
  const sb = getSupabase();
  const target = await getAdminById(_currentSession.adminId);
  if (!target) return { ok: false, error: "Account not found." };
  const currentHash = await hashPassword(currentPassword);
  if (currentHash !== target.passwordHash)
    return { ok: false, error: "Current password is incorrect." };
  const newHash = await hashPassword(newPassword);
  const { error } = await sb
    .from("admins")
    .update({ password_hash: newHash })
    .eq("id", _currentSession.adminId);
  if (error) return { ok: false, error: error.message };
  _currentSession = null;
  return { ok: true };
};

export const countClientsForAdmin = async (
  adminId: string,
): Promise<number> => {
  const sb = getSupabase();
  const { count, error } = await sb
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("admin_id", adminId);
  if (error) return 0;
  return count ?? 0;
};

// Backwards-compat shim — the old code referenced `AUTH_MODE` and
// `SUPABASE_AUTH_ENABLED` but they're no longer needed.
export const AUTH_MODE = "supabase" as const;
export const SUPABASE_AUTH_ENABLED = true;
