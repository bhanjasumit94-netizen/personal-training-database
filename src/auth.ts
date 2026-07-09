// Production authentication — Supabase only.
//
// RULES:
//   * No demo / test / development accounts anywhere in the source.
//   * No localStorage auth, no offline auth, no fallback auth.
//   * The single Super Admin is created in the Supabase dashboard
//     (email: bhanja.sumit94.sb@gmail.com, password: sumit123) and
//     gets `role = 'super_admin'` via an SQL UPDATE.
//   * All other admins are created via the app's "Create Admin" flow
//     which calls supabase.auth.admin.createUser — that operation
//     requires the SERVICE_ROLE key, so it must run on a server
//     endpoint. Until the server endpoint exists, the
//     `createAdmin` function below creates the user via `auth.signUp`,
//     which the anon key IS allowed to do, and then we promote the
//     row to `role = 'admin'` in the `admins` table.
//   * Service-role secrets are NEVER read by the browser. This file
//     only uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` via
//     `getSupabase()`.

/// <reference types="vite/client" />
import { getSupabase } from "./supabase";

export type AuthRole = "super_admin" | "admin";

export type AdminStatus = "active" | "disabled";

export type Admin = {
  id: string;
  email: string;
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
  name: a.name,
  phone: a.phone,
  photo: a.photo,
  role: a.role,
  status: a.status,
  created_at: a.createdAt,
  last_login: a.lastLogin,
});

export const hashPassword = async (password: string): Promise<string> => {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const ensureDummySeed = async (): Promise<void> => {
  // No-op. The single Super Admin is provisioned manually in the
  // Supabase dashboard (see supabase/SUPER_ADMIN.md).
};

// ============================================================================
// Session — stored only in memory. supabase-js manages its own auth tokens
// in localStorage under `sb-<ref>-auth-token`. We do NOT mirror the session
// in our own localStorage key.
// ============================================================================
export type Session = {
  adminId: string;
  role: AuthRole;
  startedAt: string;
};

let _currentSession: Session | null = null;

export const loadSession = (): Session | null => _currentSession;

export const logout = async () => {
  const sb = getSupabase();
  await sb.auth.signOut();
  _currentSession = null;
};

export const restoreRememberedSession = (): Session | null => _currentSession;

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

// ============================================================================
// Login — Supabase Auth only. No demo, no offline, no fallback.
// ============================================================================
export type LoginResult = {
  ok: true;
  session: Session;
  admin: Admin;
} | { ok: false; error: string };

export const login = async (
  email: string,
  password: string,
  _rememberMe: boolean,
): Promise<LoginResult> => {
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (!password) {
    return { ok: false, error: "Please enter your password." };
  }

  let sb;
  try {
    sb = getSupabase();
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Supabase configuration missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    };
  }
  const { data, error } = await sb.auth.signInWithPassword({
    email: normalized,
    password,
  });
  if (error || !data.user) {
    return { ok: false, error: "Invalid email or password." };
  }

  const userId = data.user.id;

  // Look up the admin profile row. If it doesn't exist (e.g. the single
  // Super Admin was created in the dashboard without a profile row),
  // create one on the fly.
  let admin = await fetchSbAdminById(userId);
  if (!admin) {
    admin = await fetchSbAdminByEmail(normalized);
  }
  if (!admin) {
    // Auto-create a profile row so the user can sign in. The role
    // defaults to "admin" — the Super Admin is created with
    // role = 'super_admin' by the SQL seed in supabase/schema.sql.
    const isLikelySuperAdmin = normalized === "bhanja.sumit94.sb@gmail.com";
    const { data: inserted, error: insErr } = await sb
      .from("admins")
      .insert({
        id: userId,
        email: normalized,
        name: data.user.user_metadata?.name ?? normalized.split("@")[0],
        phone: data.user.user_metadata?.phone ?? "",
        photo: data.user.user_metadata?.avatar_url ?? "",
        role: isLikelySuperAdmin ? "super_admin" : "admin",
        status: "active",
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString(),
      })
      .select()
      .single();
    if (insErr) {
      await sb.auth.signOut();
      return {
        ok: false,
        error: `Sign-in succeeded but admin profile creation failed: ${insErr.message}`,
      };
    }
    admin = rowToAdmin(inserted as SbAdminRow);
  }

  if (admin.status === "disabled") {
    await sb.auth.signOut();
    return {
      ok: false,
      error: "This account is disabled. Contact the Super Admin.",
    };
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

// ============================================================================
// Admin management — Super Admin only
// ============================================================================
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

/**
 * Create a new admin. We use `auth.signUp` (allowed for the anon key)
 * to create the Supabase Auth user, then insert the matching profile
 * row. The new user must confirm their email before they can sign in,
 * unless email-confirmation is disabled in the Supabase dashboard.
 */
export const createAdmin = async (
  input: CreateAdminInput,
): Promise<{ ok: true; admin: Admin } | { ok: false; error: string }> => {
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: false, error: "Invalid email address." };
  if (input.password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  if (!input.name.trim()) return { ok: false, error: "Name is required." };

  const sb = getSupabase();
  const { data, error } = await sb.auth.signUp({
    email,
    password: input.password,
    options: {
      data: {
        name: input.name.trim(),
        phone: input.phone.trim(),
        avatar_url: input.photo,
      },
    },
  });
  if (error) return { ok: false, error: error.message };
  const userId = data.user?.id;
  if (!userId) return { ok: false, error: "Sign-up failed: no user id returned." };

  const { data: rowData, error: insertError } = await sb
    .from("admins")
    .insert({
      id: userId,
      email,
      name: input.name.trim(),
      phone: input.phone.trim(),
      photo: input.photo,
      role: "admin",
      status: "active",
      created_at: new Date().toISOString(),
      last_login: "",
    })
    .select()
    .single();
  if (insertError) {
    return { ok: false, error: insertError.message };
  }
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
  if (current.role === "super_admin" && patch.email) {
    return {
      ok: false,
      error: "Super Admin email cannot be changed.",
    };
  }
  const next: Admin = {
    ...current,
    name:
      typeof patch.name === "string"
        ? patch.name.trim() || current.name
        : current.name,
    phone:
      typeof patch.phone === "string" ? patch.phone.trim() : current.phone,
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

/**
 * Reset a password. For Supabase Auth users we can request a password
 * recovery email. The anon key cannot set passwords directly — that
 * requires the service-role key (server-side only). For the seeded
 * Super Admin we use the built-in recovery flow. For admin users
 * created via the app, the Super Admin can trigger recovery via the
 * same flow.
 */
export const resetAdminPassword = async (
  _id: string,
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const sb = getSupabase();
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) {
    return { ok: false, error: "Invalid email address." };
  }
  const { error } = await sb.auth.resetPasswordForEmail(normalized, {
    redirectTo: `${window.location.origin}/login`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
};

export const changeOwnPassword = async (
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (!_currentSession) return { ok: false, error: "Not logged in." };
  if (newPassword.length < 6) {
    return { ok: false, error: "New password must be at least 6 characters." };
  }
  // Supabase Auth supports password change for the signed-in user.
  // The anon key allows `supabase.auth.updateUser` to change the password
  // when given the current password.
  const sb = getSupabase();
  const { data, error: signInError } = await sb.auth.signInWithPassword({
    email: (
      await getAdminById(_currentSession.adminId)
    )?.email ?? "",
    password: currentPassword,
  });
  if (signInError || !data.user) {
    return { ok: false, error: "Current password is incorrect." };
  }
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
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
