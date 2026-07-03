import { useMemo, useState } from "react";
import {
  Admin,
  AdminStatus,
  countClientsForAdmin,
  createAdmin,
  deleteAdmin,
  listAdmins,
  resetAdminPassword,
  setAdminStatus,
  updateAdmin,
  type CreateAdminInput,
} from "../auth";
import { Client, getAllClients, getAllHistory } from "../db";
import Portal from "./Portal";
import ClientDetailsPopup from "./ClientDetailsPopup";
import { formatDate } from "../App.helpers";

type Props = {
  currentAdmin: Admin;
  onClose: () => void;
  onViewDatabase: (admin: Admin) => void;
  onLeaveReadOnlyView: () => void;
};

const formatDateTime = (iso: string) => {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const compressToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Invalid image."));
      image.onload = () => {
        const max = 320;
        const ratio = Math.min(max / image.width, max / image.height, 1);
        const w = Math.round(image.width * ratio);
        const h = Math.round(image.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No ctx"));
        ctx.drawImage(image, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

export default function AdminManagement({ currentAdmin, onClose, onViewDatabase, onLeaveReadOnlyView }: Props) {
  const [admins, setAdmins] = useState<Admin[]>(() => listAdmins());
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Admin | null>(null);
  const [resetting, setResetting] = useState<Admin | null>(null);
  const [viewing, setViewing] = useState<Admin | null>(null);
  const [viewClients, setViewClients] = useState<Client[]>([]);
  const [viewHistory, setViewHistory] = useState<Awaited<ReturnType<typeof getAllHistory>>>([]);
  const [viewSelectedClient, setViewSelectedClient] = useState<Client | null>(null);
  const [error, setError] = useState("");

  const refresh = () => setAdmins(listAdmins());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return admins;
    return admins.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phone.toLowerCase().includes(q),
    );
  }, [admins, search]);

  const openDatabase = async (a: Admin) => {
    setError("");
    const [clients, history] = await Promise.all([getAllClients(a.id), getAllHistory(a.id)]);
    setViewing(a);
    setViewClients(clients);
    setViewHistory(history);
    onViewDatabase(a);
  };

  const leaveView = () => {
    setViewing(null);
    setViewClients([]);
    setViewHistory([]);
    setViewSelectedClient(null);
    onLeaveReadOnlyView();
  };

  return (
    <Portal>
      <div
        className="am-root fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-3 backdrop-blur-md sm:p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            if (viewing) leaveView();
            else onClose();
          }
        }}
      >
        <div className="am-frame w-full max-w-5xl overflow-hidden rounded-3xl border border-amber-300/30 bg-gradient-to-br from-zinc-900/95 via-zinc-950/95 to-cyan-950/30 shadow-[0_30px_90px_-25px_rgba(251,191,36,0.5)] backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-amber-200/80">Super Admin</p>
              <h2 className="text-lg font-bold text-white">
                {viewing ? `Viewing ${viewing.name}'s database (read-only)` : "Admin Management"}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {viewing && (
                <button
                  type="button"
                  onClick={leaveView}
                  className="rounded-full border border-amber-300/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
                >
                  ← Back to admins
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (viewing) leaveView();
                  else onClose();
                }}
                className="h-8 w-8 rounded-full border border-white/10 bg-black/40 text-zinc-300 hover:border-rose-400/50 hover:text-rose-300"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {!viewing && (
            <>
              <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email or phone"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400 sm:max-w-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-sm font-bold text-black hover:from-amber-400 hover:to-amber-500"
                >
                  + Create Admin
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto px-4 py-3 sm:px-6">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-amber-200/70">
                      <th className="py-2">Admin</th>
                      <th className="py-2">Email</th>
                      <th className="py-2">Phone</th>
                      <th className="py-2">Status</th>
                      <th className="py-2 text-right">Clients</th>
                      <th className="py-2">Last Login</th>
                      <th className="py-2">Created</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a) => (
                      <tr key={a.id} className="border-b border-white/5 text-xs">
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 overflow-hidden rounded-full border border-amber-300/40 bg-zinc-900">
                              {a.photo ? (
                                <img src={a.photo} alt={a.name} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs font-bold text-amber-300">
                                  {a.name.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div>
                              <p className="font-semibold text-white">{a.name}</p>
                              <p className="text-[10px] text-cyan-200/80">{a.role === "super_admin" ? "Super Admin" : "Admin"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 text-zinc-300">{a.email}</td>
                        <td className="py-2 text-zinc-300">{a.phone || "—"}</td>
                        <td className="py-2">
                          {a.role === "super_admin" ? (
                            <span className="rounded-full border border-amber-300/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200">PROTECTED</span>
                          ) : a.status === "active" ? (
                            <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200">Active</span>
                          ) : (
                            <span className="rounded-full border border-rose-400/40 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200">Disabled</span>
                          )}
                        </td>
                        <td className="py-2 text-right text-zinc-300">{a.role === "super_admin" ? "—" : countClientsForAdmin(a.id)}</td>
                        <td className="py-2 text-[11px] text-zinc-400">{formatDateTime(a.lastLogin)}</td>
                        <td className="py-2 text-[11px] text-zinc-400">{formatDate(a.createdAt)}</td>
                        <td className="py-2 text-right">
                          {a.role === "super_admin" ? (
                            <span className="text-[10px] text-zinc-500">Cannot modify</span>
                          ) : (
                            <div className="flex flex-wrap justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => openDatabase(a)}
                                className="rounded-md border border-cyan-300/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/20"
                              >
                                View DB
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditing(a)}
                                className="rounded-md border border-sky-300/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-200 hover:bg-sky-500/20"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setResetting(a)}
                                className="rounded-md border border-violet-300/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-200 hover:bg-violet-500/20"
                              >
                                Reset PW
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const next: AdminStatus = a.status === "active" ? "disabled" : "active";
                                  setAdminStatus(a.id, next);
                                  refresh();
                                }}
                                className="rounded-md border border-amber-300/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/20"
                              >
                                {a.status === "active" ? "Disable" : "Enable"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (window.confirm(`Permanently delete ${a.name} and all their data?`)) {
                                    deleteAdmin(a.id);
                                    refresh();
                                  }
                                }}
                                className="rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-200 hover:bg-rose-500/20"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {viewing && (
            <div className="max-h-[60vh] overflow-y-auto px-4 py-3 sm:px-6">
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ReadOnlyStat label="Clients" value={viewClients.length} />
                <ReadOnlyStat label="Payments" value={viewHistory.length} />
                <ReadOnlyStat
                  label="Active"
                  value={viewClients.filter((c) => {
                    const due = new Date(c.dueDate + "T00:00:00").getTime();
                    return due >= new Date().setHours(0, 0, 0, 0);
                  }).length}
                />
                <ReadOnlyStat
                  label="Total Collected"
                  value={`Rs ${viewHistory.reduce((s, h) => s + (h.amount || 0), 0).toLocaleString("en-IN")}`}
                />
              </div>
              <p className="text-[11px] text-amber-200/80">🔒 Read-only view. Tap a client to inspect details.</p>
              <div className="mt-2 space-y-2">
                {viewClients.length === 0 ? (
                  <p className="rounded-xl border border-white/10 bg-black/30 p-6 text-center text-sm text-zinc-400">No clients in this database.</p>
                ) : (
                  viewClients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setViewSelectedClient(c)}
                      className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/35 p-2.5 text-left hover:border-amber-300/40"
                    >
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-white/10">
                        {c.photo ? (
                          <img src={c.photo} alt={c.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-sm font-bold text-amber-300">{c.name.slice(0, 1).toUpperCase()}</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{c.name}</p>
                        <p className="truncate text-[11px] text-zinc-400">Due {formatDate(c.dueDate)} • Rs {c.amount.toLocaleString("en-IN")}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="border-t border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-300 sm:px-6">
              {error}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateAdminModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}

      {editing && (
        <EditAdminModal
          admin={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {resetting && (
        <ResetPasswordModal
          admin={resetting}
          onClose={() => setResetting(null)}
          onReset={() => setResetting(null)}
        />
      )}

      {viewSelectedClient && (
        <ClientDetailsPopup
          client={viewSelectedClient}
          history={viewHistory}
          onClose={() => setViewSelectedClient(null)}
          onEdit={() => {
            // Read-only: ignore edit requests
            setViewSelectedClient(null);
          }}
        />
      )}
    </Portal>
  );
}

const ReadOnlyStat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl border border-white/10 bg-black/30 p-2 text-center">
    <p className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</p>
    <p className="text-base font-bold text-white">{value}</p>
  </div>
);

function CreateAdminModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const input: CreateAdminInput = { name, email, phone, password, photo };
    const res = await createAdmin(input);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreated();
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await compressToDataUrl(file));
    } catch {
      setError("Could not upload image.");
    } finally {
      e.target.value = "";
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 px-4 backdrop-blur-md" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl border border-amber-300/30 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
          <p className="text-base font-semibold text-amber-200">Create Admin</p>
          <form onSubmit={handleSubmit} className="mt-3 space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" required className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password (min 6 chars)" required minLength={6} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
              <span className="truncate">{photo ? "Photo selected" : "Upload photo (optional)"}</span>
              <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
            </label>
            {error && <p className="text-xs text-rose-300">{error}</p>}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-sm font-medium text-zinc-200">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 py-2 text-sm font-semibold text-black disabled:opacity-70">{busy ? "Saving..." : "Create"}</button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

function EditAdminModal({ admin, onClose, onSaved }: { admin: Admin; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(admin.name);
  const [email, setEmail] = useState(admin.email);
  const [phone, setPhone] = useState(admin.phone);
  const [photo, setPhoto] = useState(admin.photo);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const res = updateAdmin(admin.id, { name, email, phone, photo });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 px-4 backdrop-blur-md" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl border border-amber-300/30 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
          <p className="text-base font-semibold text-amber-200">Edit Admin</p>
          <form onSubmit={handleSubmit} className="mt-3 space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
              <span className="truncate">{photo ? "Photo set" : "Upload photo"}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    setPhoto(await compressToDataUrl(f));
                  } catch {
                    setError("Could not upload image.");
                  } finally {
                    e.target.value = "";
                  }
                }}
              />
            </label>
            {error && <p className="text-xs text-rose-300">{error}</p>}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-sm font-medium text-zinc-200">Cancel</button>
              <button type="submit" className="rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 py-2 text-sm font-semibold text-black">Save</button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

function ResetPasswordModal({ admin, onClose, onReset }: { admin: Admin; onClose: () => void; onReset: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await resetAdminPassword(admin.id, pw);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onReset();
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 px-4 backdrop-blur-md" onClick={onClose}>
        <div className="w-full max-w-sm rounded-2xl border border-violet-300/30 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
          <p className="text-base font-semibold text-violet-200">Reset Password</p>
          <p className="mt-1 text-xs text-zinc-400">For {admin.name}. They will be logged out.</p>
          <form onSubmit={handleSubmit} className="mt-3 space-y-2">
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" placeholder="New password (min 6)" minLength={6} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
            {error && <p className="text-xs text-rose-300">{error}</p>}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-sm font-medium text-zinc-200">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-violet-500 py-2 text-sm font-semibold text-white disabled:opacity-70">{busy ? "Saving..." : "Reset"}</button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
