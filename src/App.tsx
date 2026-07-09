import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Client,
  PaymentHistory,
  getAllClients,
  getAllHistory,
  getSettings,
  initDB,
  migrateFromLocalStorage,
  resetSystem,
  saveAllClients,
  saveAllHistory,
  saveSetting,
} from "./db";
import {
  addNotification,
  loadNotifications,
} from "./notifications";
import { Admin, changeOwnPassword, ensureDummySeed, getAdminById, loadSession, logout, restoreRememberedSession, updateAdmin } from "./auth";
import LoginScreen from "./components/LoginScreen";
import AdminManagement from "./components/AdminManagement";
import UpcomingPaymentsDashboard from "./components/UpcomingPaymentsDashboard";

type FilterMode = "clients" | "history90" | "historyAll" | "password" | "lifetime" | "admin_panel" | "my_account" | "data_management";
type DueTab = "all" | "due" | "overdue";
type OverviewFilter = "all" | "paid" | "due" | "overdue";

type EditForm = {
  id: string;
  name: string;
  phone: string;
  amount: string;
  payDate: string;
  dueDate: string;
  photo: string;
};

const MS_IN_DAY = 24 * 60 * 60 * 1000;

const toIsoDate = (date = new Date()) => {
  const localDate = new Date(date);
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, "0");
  const day = String(localDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseIsoDateLocal = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map((value) => Number(value));
  if (!year || !month || !day) return null;
  const localDate = new Date(year, month - 1, day);
  if (Number.isNaN(localDate.getTime())) return null;
  return localDate;
};

const addMonthsToIsoDate = (isoDate: string, months: number) => {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return toIsoDate();

  const year = parsed.getFullYear();
  const month = parsed.getMonth();
  const day = parsed.getDate();
  const targetMonthStart = new Date(year, month + months, 1);
  const lastTargetMonthDay = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0).getDate();
  const safeDay = Math.min(day, lastTargetMonthDay);

  return toIsoDate(new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth(), safeDay));
};

const addDaysToIsoDate = (isoDate: string, days: number) => {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return toIsoDate();
  parsed.setDate(parsed.getDate() + days);
  return toIsoDate(parsed);
};

const getOneMonthDueDate = (fromIsoDate: string) => addDaysToIsoDate(addMonthsToIsoDate(fromIsoDate, 1), -1);

const formatDate = (isoDate: string) => {
  if (!isoDate) return "-";
  const d = parseIsoDateLocal(isoDate);
  if (!d) return "-";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatDateDayMonth = (isoDate: string) => {
  if (!isoDate) return "-";
  const d = parseIsoDateLocal(isoDate);
  if (!d) return "-";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
};

const getDaysUntilDue = (dueDate: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return Number.NaN;
  return Math.round((due.getTime() - today.getTime()) / MS_IN_DAY);
};

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return { text: "Good Morning", sub: "Rise and shine" };
  if (hour >= 12 && hour < 17) return { text: "Good Afternoon", sub: "Keep going" };
  if (hour >= 17 && hour < 21) return { text: "Good Evening", sub: "Almost done" };
  return { text: "Good Night", sub: "Rest well" };
};

const compressToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Invalid image."));
      image.onload = () => {
        const maxSize = 640;
        const ratio = Math.min(maxSize / image.width, maxSize / image.height, 1);
        const width = Math.round(image.width * ratio);
        const height = Math.round(image.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not process image."));
          return;
        }
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

const parseImportedClients = (unknownClients: unknown, adminId: string): Client[] => {
  if (!Array.isArray(unknownClients)) return [];
  return unknownClients
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const candidate = raw as Record<string, unknown>;
      const name = String(candidate.name ?? "").trim();
      const phone = String(candidate.phone ?? "").trim();
      if (!name || !phone) return null;
      const parsed: Client = {
        id: String(candidate.id ?? crypto.randomUUID()),
        adminId,
        name,
        phone,
        amount: Number(candidate.amount ?? 0) || 0,
        payDate: String(candidate.payDate ?? toIsoDate()),
        dueDate: String(candidate.dueDate ?? toIsoDate()),
        paid: Boolean(candidate.paid),
        photo: typeof candidate.photo === "string" ? candidate.photo : "",
      };
      if (typeof candidate.lastCyclePayDate === "string") parsed.lastCyclePayDate = candidate.lastCyclePayDate;
      if (typeof candidate.lastCycleDueDate === "string") parsed.lastCycleDueDate = candidate.lastCycleDueDate;
      if (typeof candidate.lastPaymentHistoryId === "string") parsed.lastPaymentHistoryId = candidate.lastPaymentHistoryId;
      return parsed;
    })
    .filter((entry): entry is Client => Boolean(entry));
};

const parseImportedHistory = (unknownHistory: unknown, adminId: string): PaymentHistory[] => {
  if (!Array.isArray(unknownHistory)) return [];
  return unknownHistory
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const candidate = raw as Record<string, unknown>;
      const clientName = String(candidate.clientName ?? "").trim();
      if (!clientName) return null;
      return {
        id: String(candidate.id ?? crypto.randomUUID()),
        adminId,
        clientId: String(candidate.clientId ?? ""),
        clientName,
        amount: Number(candidate.amount ?? 0) || 0,
        paidDate: String(candidate.paidDate ?? toIsoDate()),
      };
    })
    .filter((entry): entry is PaymentHistory => Boolean(entry));
};

const toCsvField = (value: string | number | boolean) => {
  const raw = String(value ?? "");
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
};

const Logo = ({ size = 48 }: { size?: number }) => (
  <div className="relative" style={{ width: size, height: size }}>
    <div className="absolute inset-0 rounded-xl bg-amber-500/40 blur-md animate-pulse" />
    <div
      className="relative flex h-full w-full items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 font-black text-black"
      style={{ fontSize: size * 0.5 }}
    >
      S
    </div>
  </div>
);

// LockScreen removed entirely — dead code. The app uses Supabase Auth
// for sign-in (see src/components/LoginScreen.tsx). The old PIN lock and
// all related state / helpers have been deleted.
export default function App() {
  // legacy PIN lock removed — was a no-op for many turns.
  const [loading, setLoading] = useState(true);
  const [currentAdmin, setCurrentAdmin] = useState<Admin | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Super-Admin impersonation: when set, the dashboard treats this admin's
  // data as the active database, but the real session admin is unchanged.
  const [impersonationAdminId, setImpersonationAdminId] = useState<string | null>(null);
  // The admin currently being impersonated (only set for super admin).
  const [impersonationAdmin, setImpersonationAdmin] = useState<Admin | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!impersonationAdminId) {
      setImpersonationAdmin(null);
      return;
    }
    (async () => {
      const a = await getAdminById(impersonationAdminId);
      if (!cancelled) setImpersonationAdmin(a);
    })();
    return () => {
      cancelled = true;
    };
  }, [impersonationAdminId]);
  // The id actually used for every DB query. When the super admin is
  // impersonating another admin, this is the impersonated admin's id.
  // Otherwise it falls back to the logged-in admin.
  const effectiveAdminId = impersonationAdminId ?? currentAdmin?.id ?? null;
  const [clients, setClients] = useState<Client[]>([]);
  const [history, setHistory] = useState<PaymentHistory[]>([]);
  const [ownerName, setOwnerName] = useState("");
  const [ownerImage, setOwnerImage] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("clients");
  const [dueTab, setDueTab] = useState<DueTab>("all");
  // Whether the entire Client Payments section is expanded. Hidden by
  // default — toggled via the "📋 Show Client Payments" button. The
  // expanded/collapsed state is persisted in localStorage so it survives
  // page refresh.
  const [isClientPaymentsOpen, setIsClientPaymentsOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("ptd_ui_client_payments_open") === "1";
  });
  const [expandedStat, setExpandedStat] = useState<OverviewFilter | null>(null);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<EditForm | null>(null);
  const [inlineImageFileName, setInlineImageFileName] = useState("");
  const [clientImageFileName, setClientImageFileName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [isEditingOwnerName, setIsEditingOwnerName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [selectedLifetimeMonth, setSelectedLifetimeMonth] = useState("all");
  // Reset System flow state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetStep, setResetStep] = useState<"backup" | "admin" | "warning">("backup");
  const [resetAdminPassword, setResetAdminPassword] = useState("");
  const [resetError, setResetError] = useState("");
  // Notification system: count of unread items
  const [unreadCount, setUnreadCount] = useState(0);
  // Track previous client list to detect additions/edits/deletions for notifications
  const prevClientIdsRef = useRef<Set<string>>(new Set());
  const prevClientMapRef = useRef<Map<string, Client>>(new Map());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownerNameInputRef = useRef<HTMLInputElement | null>(null);
  // Refs for the Client Payments filters: focus the search box on demand
  // and scroll to a freshly-added client card.
  const clientSearchInputRef = useRef<HTMLInputElement | null>(null);
  const clientListScrollRef = useRef<HTMLDivElement | null>(null);
  const newClientIdRef = useRef<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    amount: "1500",
    payDate: toIsoDate(),
    dueDate: getOneMonthDueDate(toIsoDate()),
    photo: "",
  });

  // Auth bootstrap: ensure dummy accounts are seeded, then try to restore
  // a remembered session. If a valid session is found, load the admin
  // object and proceed. Otherwise the user is shown the LoginScreen.
  // A 3s safety timeout ALWAYS flips loading to false and falls back to
  // the unauthenticated state, so the UI can never hang on a spinner.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line no-console
    console.log("Auth started");

    const safetyTimeout = setTimeout(() => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.warn("Auth timed out after 3s — redirecting to login.");
      try {
        localStorage.removeItem("ptd_session_v1");
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
      setAuthError("Session expired. Please login again.");
      setCurrentAdmin(null);
      setAuthReady(true);
      setLoading(false);
    }, 3000);

    const bootstrap = async () => {
      try {
        await ensureDummySeed();
        const session = restoreRememberedSession();
        if (session) {
          // eslint-disable-next-line no-console
          console.log("Session found");
          const admin = await getAdminById(session.adminId);
          if (admin && admin.status === "active") {
            setCurrentAdmin(admin);
            // No localStorage migration needed — Supabase is the only
            // storage layer.
            void admin;
            await migrateFromLocalStorage(admin);
            return;
          }
        }
        // No valid session — stay unauthenticated.
        // In dummy mode, automatically sign in as the Super Admin for the
        // smoothest local-dev experience. This ONLY runs when AUTH_MODE is
        // explicitly "dummy" (i.e. Supabase is NOT configured).
        // No valid session — stay unauthenticated and show the LoginScreen.
        // Auto-login is intentionally disabled: the user must always sign in
        // explicitly, even in dummy mode. (Previous versions auto-logged-in
        // as the Super Admin, which bypassed the login screen.)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Auth bootstrap failed:", err);
        try {
          localStorage.removeItem("ptd_session_v1");
          sessionStorage.clear();
        } catch {
          /* ignore */
        }
      } finally {
        if (!cancelled) {
          clearTimeout(safetyTimeout);
          setAuthReady(true);
          setLoading(false);
          // eslint-disable-next-line no-console
          console.log("Loading finished");
        }
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
      clearTimeout(safetyTimeout);
    };
  }, []);

  // Once we have a logged-in admin, load their data.
  // This effect always flips `loading` to false in finally so the UI
  // never stays stuck on the spinner if the load throws.
  useEffect(() => {
    if (!currentAdmin || !effectiveAdminId) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        await initDB();
        const adminId = effectiveAdminId;
        const [loadedClients, loadedHistory, settings] = await Promise.all([
          getAllClients(adminId),
          getAllHistory(adminId),
          getSettings(adminId),
        ]);
        if (cancelled) return;
        setClients(loadedClients);
        setHistory(loadedHistory);
        setOwnerName(settings.ownerName);
        setOwnerImage(settings.ownerImage);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Data load failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentAdmin, effectiveAdminId]);

  useEffect(() => {
    if (loading || !currentAdmin) return;
    setSaveStatus("saving");
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (!effectiveAdminId) return;
      await saveAllClients(effectiveAdminId, clients);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    }, 350);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [clients, loading, effectiveAdminId]);

  useEffect(() => {
    if (loading || !effectiveAdminId) return;
    void saveAllHistory(effectiveAdminId, history);
  }, [history, loading, effectiveAdminId]);

  useEffect(() => {
    if (loading || !effectiveAdminId) return;
    void saveSetting(effectiveAdminId, "ownerName", ownerName);
  }, [ownerName, loading, effectiveAdminId]);

  useEffect(() => {
    if (loading || !effectiveAdminId) return;
    void saveSetting(effectiveAdminId, "ownerImage", ownerImage);
  }, [ownerImage, loading, effectiveAdminId]);

  useEffect(() => {
    if (!isEditingOwnerName) return;
    ownerNameInputRef.current?.focus();
    ownerNameInputRef.current?.select();
  }, [isEditingOwnerName]);

  // Persist the open/closed state of the major collapsible sections
  // so the user's preference survives a page refresh.
  useEffect(() => {
    try {
      localStorage.setItem("ptd_ui_client_payments_open", isClientPaymentsOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [isClientPaymentsOpen]);

  // Track client additions, edits, and deletions for notifications.
  useEffect(() => {
    if (loading || !effectiveAdminId) return;
    const adminId = effectiveAdminId;
    const currentIds = new Set(clients.map((c) => c.id));
    const prevIds = prevClientIdsRef.current;
    const prevMap = prevClientMapRef.current;

    // Detect additions
    currentIds.forEach((id) => {
      if (!prevIds.has(id)) {
        const c = clients.find((x) => x.id === id);
        if (c) {
          addNotification(adminId, {
            type: "new_client",
            title: "New client added",
            message: `${c.name} joined. Next payment ${formatDate(c.dueDate)}.`,
            clientId: c.id,
          });
        }
      }
    });

    // Detect deletions
    prevIds.forEach((id) => {
      if (!currentIds.has(id)) {
        const removed = prevMap.get(id);
        addNotification(adminId, {
          type: "client_deleted",
          title: "Client deleted",
          message: removed ? `${removed.name} was removed from the database.` : "A client was removed from the database.",
          clientId: id,
        });
      }
    });

    // Detect edits
    currentIds.forEach((id) => {
      if (prevIds.has(id)) {
        const prev = prevMap.get(id);
        const current = clients.find((x) => x.id === id);
        if (prev && current) {
          const changed =
            prev.name !== current.name ||
            prev.phone !== current.phone ||
            prev.amount !== current.amount ||
            prev.dueDate !== current.dueDate ||
            prev.payDate !== current.payDate;
          if (changed) {
            addNotification(adminId, {
              type: "client_edited",
              title: "Client updated",
              message: `${current.name}'s details were updated.`,
              clientId: current.id,
            });
          }
        }
      }
    });

    prevClientIdsRef.current = currentIds;
    prevClientMapRef.current = new Map(clients.map((c) => [c.id, c]));
  }, [clients, loading, currentAdmin]);

  // Refresh notification count whenever a new notification is added elsewhere.
  useEffect(() => {
    if (!effectiveAdminId) return;
    const adminId = effectiveAdminId;
    const refreshCount = () => {
      setUnreadCount(loadNotifications(adminId).filter((n) => !n.read).length);
    };
    refreshCount();
    const interval = setInterval(refreshCount, 1500);
    return () => clearInterval(interval);
  }, [clients, history, effectiveAdminId]);

  // Detect due-today and overdue transitions, plus 3-day reminders.
  useEffect(() => {
    if (loading || !effectiveAdminId) return;
    const adminId = effectiveAdminId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    clients.forEach((c) => {
      const days = getDaysUntilDue(c.dueDate);
      if (Number.isNaN(days)) return;
      if (c.dueDate === todayIso) {
        addNotification(adminId, {
          type: "due_today",
          title: "Payment due today",
          message: `${c.name}'s payment of Rs ${c.amount.toLocaleString("en-IN")} is due today.`,
          clientId: c.id,
        });
      } else if (days === 3) {
        addNotification(adminId, {
          type: "upcoming_reminder",
          title: "Upcoming payment in 3 days",
          message: `${c.name} has a payment due on ${formatDate(c.dueDate)}.`,
          clientId: c.id,
        });
      } else if (days < 0) {
        addNotification(adminId, {
          type: "overdue",
          title: "Payment overdue",
          message: `${c.name} is ${Math.abs(days)} day(s) overdue for Rs ${c.amount.toLocaleString("en-IN")}.`,
          clientId: c.id,
        });
      }
    });
  }, [clients, loading, currentAdmin]);

  const filteredClients = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(s) || c.phone.includes(s));
  }, [clients, search]);

  const dueFilteredClients = useMemo(() => {
    if (dueTab === "all") return filteredClients;
    return filteredClients.filter((c) => {
      const days = getDaysUntilDue(c.dueDate);
      if (Number.isNaN(days)) return false;
      if (dueTab === "overdue") return days < 0;
      return days === 0;
    });
  }, [dueTab, filteredClients]);

  const history90Days = useMemo(() => {
    const now = Date.now();
    const windowStart = now - 90 * MS_IN_DAY;
    return history.filter((entry) => {
      const paidDate = parseIsoDateLocal(entry.paidDate);
      const time = paidDate?.getTime() ?? Number.NaN;
      return !Number.isNaN(time) && time >= windowStart && time <= now;
    });
  }, [history]);

  const monthlyPaymentHistory = useMemo(() => {
    const monthMap = new Map<
      string,
      {
        key: string;
        label: string;
        total: number;
        entries: PaymentHistory[];
      }
    >();

    history.forEach((entry) => {
      const paidAt = new Date(`${entry.paidDate}T00:00:00`);
      if (Number.isNaN(paidAt.getTime())) return;

      const key = `${paidAt.getFullYear()}-${String(paidAt.getMonth() + 1).padStart(2, "0")}`;
      const label = paidAt.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
      const current = monthMap.get(key);

      if (current) {
        current.entries.push(entry);
        current.total += entry.amount;
        return;
      }

      monthMap.set(key, {
        key,
        label,
        total: entry.amount,
        entries: [entry],
      });
    });

    return Array.from(monthMap.values())
      .sort((a, b) => b.key.localeCompare(a.key))
      .map((group) => ({
        ...group,
        entries: [...group.entries].sort((a, b) => {
          const aTime = new Date(`${a.paidDate}T00:00:00`).getTime();
          const bTime = new Date(`${b.paidDate}T00:00:00`).getTime();
          return bTime - aTime;
        }),
      }));
  }, [history]);

  const visibleMonthlyPaymentHistory = useMemo(() => {
    if (selectedLifetimeMonth === "all") return monthlyPaymentHistory;
    return monthlyPaymentHistory.filter((monthGroup) => monthGroup.key === selectedLifetimeMonth);
  }, [monthlyPaymentHistory, selectedLifetimeMonth]);

  const stats = useMemo(() => {
    const datedClients = clients
      .map((client) => ({ client, days: getDaysUntilDue(client.dueDate) }))
      .filter((entry) => !Number.isNaN(entry.days));
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const thisMonthCollection = history
      .filter((entry) => {
        const paidAt = new Date(`${entry.paidDate}T00:00:00`);
        return !Number.isNaN(paidAt.getTime()) && paidAt.getFullYear() === currentYear && paidAt.getMonth() === currentMonth;
      })
      .reduce((sum, entry) => sum + entry.amount, 0);

    const lifetimeCollection = history.reduce((sum, entry) => sum + entry.amount, 0);

    const totalClients = clients.length;
    const paidClients = datedClients.filter(({ days }) => days > 0).length;
    const pendingAmount = datedClients.filter(({ days }) => days <= 0).reduce((sum, { client }) => sum + client.amount, 0);
    const activeAmount = datedClients.filter(({ days }) => days > 0).reduce((sum, { client }) => sum + client.amount, 0);
    const dueNow = datedClients.filter(({ days }) => days === 0).length;
    const overdue = datedClients.filter(({ days }) => days < 0).length;
    const totalAmount = pendingAmount + activeAmount;
    const collectionRate = totalAmount ? Math.round((activeAmount / totalAmount) * 100) : 0;
    return { totalClients, paidClients, pendingAmount, thisMonthCollection, lifetimeCollection, dueNow, overdue, collectionRate };
  }, [clients, history]);

  const getExpandedClients = useCallback(
    (filter: OverviewFilter) => {
      switch (filter) {
        case "all":
          return clients;
        case "paid":
          return clients.filter((c) => {
            const days = getDaysUntilDue(c.dueDate);
            return !Number.isNaN(days) && days > 0;
          });
        case "due":
          return clients.filter((c) => getDaysUntilDue(c.dueDate) === 0);
        case "overdue":
          return clients.filter((c) => getDaysUntilDue(c.dueDate) < 0);
        default:
          return [];
      }
    },
    [clients],
  );

  const resetForm = () => {
    const nextPayDate = toIsoDate();
    setForm({
      name: "",
      phone: "",
      amount: "1500",
      payDate: nextPayDate,
      dueDate: getOneMonthDueDate(nextPayDate),
      photo: "",
    });
    setClientImageFileName("");
  };

  const receivePayment = (id: string) => {
    if (!currentAdmin || !effectiveAdminId) return;
    const adminId = effectiveAdminId;
    // Snapshot the client before any state changes so we can undo.
    const before = clients.find((c) => c.id === id);
    if (!before) return;
    const paymentDate = toIsoDate();
    // Every Receive click represents one additional billing cycle that
    // has been paid. Advance payments are explicitly supported: tapping
    // Receive while the next due date is still in the future is valid
    // and advances the due date by exactly one cycle from the current
    // nextPaymentDate (never from today's date).
    //
    // Ask for confirmation first so the user can cancel.
    const confirmedReceive = window.confirm(
      `Receive payment from ${before.name} for Rs ${before.amount.toLocaleString("en-IN")}?`,
    );
    if (!confirmedReceive) return;

    const previousDueDate = before.dueDate;
    // ALWAYS advance the next due date by exactly one month from the
    // PREVIOUS due date — never from today's payment date. This keeps
    // the billing day-of-month stable (e.g. always the 3rd) regardless
    // of whether the user pays early, on time, or late:
    //   - Pay 25 Jul when due 03 Aug -> next due 03 Sep (preserved)
    //   - Pay 03 Aug when due 03 Aug -> next due 03 Sep
    //   - Pay 10 Aug when due 03 Aug -> next due 03 Sep (no extra skip)
    // The "client.lastPaidDate" is updated so the UI can show when the
    // last payment was actually received.
    const nextDueDate = addMonthsToIsoDate(previousDueDate, 1);
    // eslint-disable-next-line no-console
    console.log("receivePayment", {
      previousDueDate,
      paymentDate,
      calculatedNextDueDate: nextDueDate,
    });
    const historyId = crypto.randomUUID();

    // Record payment notification
    addNotification(adminId, {
      type: "payment_received",
      title: "Payment received",
      message: `Received Rs ${before.amount.toLocaleString("en-IN")} from ${before.name}. Next due ${formatDate(nextDueDate)}.`,
      clientId: before.id,
    });

    setHistory((prevHistory) => [
      {
        id: historyId,
        adminId,
        clientId: before.id,
        clientName: before.name,
        amount: before.amount,
        paidDate: paymentDate,
      },
      ...prevHistory,
    ]);

    const after: Client = {
      ...before,
      paid: true,
      payDate: paymentDate,
      dueDate: nextDueDate,
      lastCyclePayDate: before.payDate,
      lastCycleDueDate: before.dueDate,
      lastPaymentHistoryId: historyId,
    };
    setClients((prev) => prev.map((c) => (c.id === id ? after : c)));
  };

  const undoLastPayment = (id: string) => {
    setClients((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;

        if (!c.lastPaymentHistoryId && !c.lastCycleDueDate && !c.lastCyclePayDate) {
          window.alert("No recent payment to undo.");
          return c;
        }

        const confirmedUndo = window.confirm(`Undo payment for ${c.name}?\nThis will remove the last received entry.`);
        if (!confirmedUndo) return c;

        const restoredPayDate = c.lastCyclePayDate ?? c.payDate;
        const restoredDueDate = c.lastCycleDueDate ?? addMonthsToIsoDate(c.dueDate, -1);
        setHistory((prevHistory) => {
          if (c.lastPaymentHistoryId) {
            return prevHistory.filter((entry) => entry.id !== c.lastPaymentHistoryId);
          }
          const fallbackIndex = prevHistory.findIndex((entry) => entry.clientId === c.id);
          if (fallbackIndex < 0) return prevHistory;
          return prevHistory.filter((_, index) => index !== fallbackIndex);
        });

        return {
          ...c,
          paid: false,
          payDate: restoredPayDate,
          dueDate: restoredDueDate,
          lastCyclePayDate: undefined,
          lastCycleDueDate: undefined,
          lastPaymentHistoryId: undefined,
        };
      }),
    );
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim() || !form.phone.trim() || !effectiveAdminId) return;
    const adminId = effectiveAdminId;
    const clientId = crypto.randomUUID();
    // The initial payment is recorded at registration time. The new
    // client starts as `paid: true`, with `payDate = form.payDate` and
    // `dueDate = form.dueDate` already set in the form. A matching
    // PaymentHistory row is created so the lifetime / this-month
    // collections are correct from day one.
    const initialPaidDate = form.payDate;
    const initialDueDate = form.dueDate;
    const initialHistoryId = crypto.randomUUID();
    const payload: Client = {
      id: clientId,
      adminId,
      name: form.name.trim(),
      phone: form.phone.trim(),
      amount: Number(form.amount) || 0,
      payDate: initialPaidDate,
      dueDate: initialDueDate,
      paid: true,
      photo: form.photo,
    };
    setClients((prev) => [payload, ...prev]);
    setHistory((prev) => [
      {
        id: initialHistoryId,
        adminId,
        clientId,
        clientName: payload.name,
        amount: payload.amount,
        paidDate: initialPaidDate,
      },
      ...prev,
    ]);
    // Notify + record this initial payment so it shows up in the
    // notification center, just like any other receive-payment action.
    addNotification(adminId, {
      type: "payment_received",
      title: "Initial payment recorded",
      message: `Initial payment of Rs ${payload.amount.toLocaleString("en-IN")} from ${payload.name}. Next due ${formatDate(initialDueDate)}.`,
      clientId,
    });
    // Per spec: after creating a new client, automatically open the
    // Client Payments section, keep filters open, focus the search
    // box, and scroll to the new card.
    newClientIdRef.current = clientId;
    setIsClientPaymentsOpen(true);
    setDueTab("all");
    resetForm();
    setShowAddForm(false);
    // Defer the focus + scroll until after React commits the new card
    // to the DOM. A short rAF + timeout is enough on every device.
    requestAnimationFrame(() => {
      clientSearchInputRef.current?.focus();
      clientSearchInputRef.current?.select();
    });
    setTimeout(() => {
      const target = document.querySelector(
        `[data-client-id="${payload.id}"]`,
      ) as HTMLElement | null;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (clientListScrollRef.current) {
        clientListScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 60);
  };

  const onClientImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressToDataUrl(file);
      setForm((prev) => ({ ...prev, photo: dataUrl }));
      setClientImageFileName(file.name);
    } catch {
      window.alert("Unable to upload image.");
    } finally {
      event.target.value = "";
    }
  };

  const onOwnerImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressToDataUrl(file);
      setOwnerImage(dataUrl);
    } catch {
      window.alert("Unable to upload owner image.");
    } finally {
      event.target.value = "";
    }
  };

  const onInlineImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !inlineEdit) return;
    try {
      const dataUrl = await compressToDataUrl(file);
      setInlineEdit((prev) => (prev ? { ...prev, photo: dataUrl } : prev));
      setInlineImageFileName(file.name);
    } catch {
      window.alert("Unable to upload image.");
    } finally {
      event.target.value = "";
    }
  };

  const startInlineModify = (client: Client) => {
    setInlineEdit({
      id: client.id,
      name: client.name,
      phone: client.phone,
      amount: String(client.amount),
      payDate: client.payDate,
      dueDate: client.dueDate,
      photo: client.photo || "",
    });
    setInlineImageFileName(client.photo ? "Current image" : "");
  };

  const saveInlineModify = () => {
    if (!inlineEdit) return;
    if (!inlineEdit.name.trim() || !inlineEdit.phone.trim()) return;
    setClients((prev) =>
      prev.map((client) => {
        if (client.id !== inlineEdit.id) return client;
        return {
          ...client,
          name: inlineEdit.name.trim(),
          phone: inlineEdit.phone.trim(),
          amount: Number(inlineEdit.amount) || 0,
          payDate: inlineEdit.payDate,
          dueDate: inlineEdit.dueDate,
          photo: inlineEdit.photo,
        };
      }),
    );
    setInlineEdit(null);
    setInlineImageFileName("");
  };

  const openWhatsApp = (phone: string, message: string) => {
    const cleaned = phone.replace(/\D/g, "");
    const url = `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const sendDueMessage = (client: Client) => {
    const days = getDaysUntilDue(client.dueDate);
    const message =
      days < 0
        ? `Hi ${client.name}, your payment of Rs ${client.amount.toLocaleString("en-IN")} is overdue by ${Math.abs(days)} day(s). Please clear it soon.`
        : `Hi ${client.name}, your payment of Rs ${client.amount.toLocaleString("en-IN")} is due today. Please clear it soon.`;
    openWhatsApp(client.phone, message);
  };

  const sendSuccessMessage = (client: Client) => {
    const message = `Hi ${client.name}, payment received: Rs ${client.amount.toLocaleString("en-IN")}. Thank you.`;
    openWhatsApp(client.phone, message);
  };

  const getStatusBadge = (client: Client) => {
    const days = getDaysUntilDue(client.dueDate);
    if (Number.isNaN(days)) return null;
    if (days === 0) return { text: "DUE TODAY", className: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
    if (days < 0) return { text: `${Math.abs(days)}d OVERDUE`, className: "bg-rose-500/20 text-rose-300 border-rose-500/40" };
    return {
      text: `DUE ${formatDateDayMonth(client.dueDate)}`,
      className: "bg-sky-500/20 text-sky-300 border-sky-500/40",
    };
  };

  const exportJSON = async () => {
    if (!effectiveAdminId) return;
    const settings = await getSettings(effectiveAdminId);
    const data = {
      schemaVersion: 2,
      clients,
      history,
      ownerName,
      ownerImage,
      weatherPlace: settings.weatherPlace,
      password: settings.password,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-${toIsoDate()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const headers = ["Name", "Phone", "Amount", "Pay Date", "Due Date", "Paid"];
    const rows = clients.map((c) => [c.name, c.phone, c.amount, c.payDate, c.dueDate, c.paid ? "Yes" : "No"]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => toCsvField(cell)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clients-${toIsoDate()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const data = parsed as Record<string, unknown>;
      if (!effectiveAdminId) return;

      const importedClients = parseImportedClients(data.clients, effectiveAdminId);
      const importedHistory = parseImportedHistory(data.history, effectiveAdminId);
      const importedOwnerName = typeof data.ownerName === "string" ? data.ownerName : "";
      const importedOwnerImage = typeof data.ownerImage === "string" ? data.ownerImage : "";
      const importedWeatherPlace =
        typeof data.weatherPlace === "string"
          ? data.weatherPlace
          : typeof data.selectedWeatherPlace === "string"
            ? data.selectedWeatherPlace
            : "Kolkata, India";
      const importedPassword = typeof data.password === "string" && /^\d{4}$/.test(data.password) ? data.password : undefined;

      setClients(importedClients);
      setHistory(importedHistory);
      setOwnerName(importedOwnerName);
      setOwnerImage(importedOwnerImage);

      await Promise.all([
        saveAllClients(effectiveAdminId, importedClients),
        saveAllHistory(effectiveAdminId, importedHistory),
        saveSetting(effectiveAdminId, "ownerName", importedOwnerName),
        saveSetting(effectiveAdminId, "ownerImage", importedOwnerImage),
        saveSetting(effectiveAdminId, "weatherPlace", importedWeatherPlace),
      ]);

      if (importedPassword) {
        await saveSetting(effectiveAdminId, "password", importedPassword);
      }

      window.alert(`Import successful: ${importedClients.length} clients, ${importedHistory.length} history entries.`);
    } catch {
      window.alert("Invalid backup file");
    }
    event.target.value = "";
  };

  const handleLogout = async () => {
    await logout();
    setCurrentAdmin(null);
    setAuthError(null);
  };

  // "Force Sign Out" — clears all local storage and session storage, then
  // returns the user to the login screen. Useful for testing or when the
  // user wants to wipe any stale session.
  const handleForceSignOut = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    setCurrentAdmin(null);
    setAuthError("You have been signed out. Please login again.");
    setFilterMode("clients");
  };

  const handleChangePassword = async () => {
    try {
      if (!effectiveAdminId) return;
      const settings = await getSettings(effectiveAdminId);
      if (currentPassword !== settings.password) {
        setPasswordMsg("Current password is incorrect");
        return;
      }
      if (!/^\d{4}$/.test(newPassword)) {
        setPasswordMsg("New password must be 4 digits");
        return;
      }
      if (newPassword !== confirmPassword) {
        setPasswordMsg("Passwords do not match");
        return;
      }
      await saveSetting(effectiveAdminId, "password", newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg("Password changed successfully");
    } catch {
      setPasswordMsg("Failed to change password");
    }
  };

  // Reset System: open the multi-step modal (backup reminder -> admin password -> warning).
  const openResetSystem = () => {
    setResetStep("backup");
    setResetAdminPassword("");
    setResetError("");
    setShowResetModal(true);
  };

  const closeResetSystem = () => {
    setShowResetModal(false);
    setResetStep("backup");
    setResetAdminPassword("");
    setResetError("");
  };

  // Verifies the Super Admin password before showing the final warning.
  // (The verification always uses the REAL logged-in admin's settings,
  // not the impersonated admin's, so the Super Admin must always re-enter
  // their own PIN before resetting the impersonated admin's data.)
  const confirmResetAdminPassword = async () => {
    if (!currentAdmin) return;
    const settings = await getSettings(currentAdmin.id);
    if (resetAdminPassword !== settings.password) {
      setResetError("Super Admin password is incorrect.");
      return;
    }
    setResetError("");
    setResetStep("warning");
  };

  // Performs the actual reset on the EFFECTIVE admin (the impersonated
  // admin if Super Admin is currently impersonating, otherwise the
  // logged-in admin). Preserves that admin's password/login.
  const executeResetSystem = async () => {
    if (!effectiveAdminId) return;
    await resetSystem(effectiveAdminId);
    setShowResetModal(false);
    setResetStep("backup");
    setResetAdminPassword("");
    setResetError("");
    window.alert("System reset successfully.");
    window.location.reload();
  };

  const ClientRow = ({ client, compact = false }: { client: Client; compact?: boolean }) => {
    const badge = getStatusBadge(client);
    const canUndoPayment = Boolean(client.lastPaymentHistoryId || client.lastCycleDueDate || client.lastCyclePayDate);
    return (
      <div className={`rounded-xl border border-zinc-800 bg-black/40 ${compact ? "p-2" : "p-3"}`}>
        <div className="flex items-center gap-2">
          <div className={`overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 ${compact ? "h-10 w-10" : "h-11 w-11"}`}>
            {client.photo ? (
              <img src={client.photo} alt={client.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-bold text-zinc-500">{client.name.slice(0, 1).toUpperCase()}</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-semibold text-white">{client.name}</p>
              {badge && <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${badge.className}`}>{badge.text}</span>}
            </div>
            <p className="text-sm text-zinc-400">Rs {client.amount.toLocaleString("en-IN")}</p>
            <p className="text-[11px] text-zinc-500">Paid {formatDateDayMonth(client.payDate)} | Due {formatDateDayMonth(client.dueDate)}</p>
          </div>
          <button
            type="button"
            onClick={() => receivePayment(client.id)}
            className="h-9 rounded-full border border-zinc-600 bg-zinc-800 px-3 text-xs font-semibold text-zinc-300"
          >
            Receive
          </button>
        </div>
        {!compact && (
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" onClick={() => sendDueMessage(client)} className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
              Msg Due
            </button>
            <button
              type="button"
              onClick={() => sendSuccessMessage(client)}
              className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300"
            >
              Msg Paid
            </button>
            <button type="button" onClick={() => startInlineModify(client)} className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-300">
              Edit
            </button>
            {canUndoPayment && (
              <button
                type="button"
                onClick={() => undoLastPayment(client.id)}
                className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300"
              >
                Undo Last
              </button>
            )}
            <button
              type="button"
              onClick={() => setClients((prev) => prev.filter((c) => c.id !== client.id))}
              className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    );
  };

  const StatTile = ({ type, label, value, color }: { type: OverviewFilter; label: string; value: number; color: string }) => {
    const isExpanded = expandedStat === type;
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpandedStat(isExpanded ? null : type)}
          className={`w-full rounded-2xl border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] p-3 text-left shadow-[0_18px_45px_-28px_rgba(0,0,0,0.9)] backdrop-blur ${isExpanded ? "ring-1 ring-amber-300/70" : ""}`}
        >
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-zinc-400">{label}</p>
        </button>
      </div>
    );
  };

  // Legacy PIN lock is disabled; route straight through.
  // if (isLocked) return <LockScreen onUnlock={() => setIsLocked(false)} />;

  // Auth gate: not ready → spinner (always with a hard ceiling of the
  // 3s safety timeout set in the bootstrap effect, so we never hang).
  if (!authReady || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-zinc-300">
        <div className="text-center">
          <div className="flex justify-center">
            <Logo size={64} />
          </div>
          <p className="mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  // Unauthenticated → show the LoginScreen. Also clear any stale auth
  // error so the user can try again.
  if (!currentAdmin) {
    return (
      <LoginScreen
        onAuthenticated={(admin) => {
          // eslint-disable-next-line no-console
          console.log("Login success");
          setAuthError(null);
          setCurrentAdmin(admin);
        }}
        onClearError={() => setAuthError(null)}
        initialError={authError}
      />
    );
  }

  const greeting = getGreeting();
  const expandedStatLabels: Record<OverviewFilter, string> = {
    all: "All Clients",
    paid: "Active Clients",
    due: "Due Today",
    overdue: "Overdue",
  };
  const expandedClients = expandedStat ? getExpandedClients(expandedStat) : [];

  return (
    <div className="relative min-h-screen overflow-x-clip bg-zinc-950 text-white">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-0 h-[28rem] w-[32rem] -translate-x-1/2 rounded-full bg-amber-500/15 blur-[130px]" />
        <div className="absolute -right-24 bottom-20 h-72 w-72 rounded-full bg-cyan-500/10 blur-[110px]" />
      </div>
      {saveStatus !== "idle" && (
        <div className="fixed right-3 top-3 z-40 rounded-full border border-amber-300/35 bg-zinc-900/90 px-3 py-1 text-xs shadow-[0_0_18px_rgba(251,191,36,0.25)] backdrop-blur">
          {saveStatus === "saving" ? "Saving..." : "Saved"}
        </div>
      )}

      <main className="relative z-10 mx-auto w-full max-w-xl px-4 pb-24 pt-4">
        {/* SUPER ADMIN MODE banner — shown when the super admin is
            impersonating another admin. Always at the very top of the
            dashboard so the admin is never confused about whose data
            they're looking at. */}
        {currentAdmin?.role === "super_admin" && impersonationAdmin && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-fuchsia-400/50 bg-gradient-to-r from-fuchsia-500/20 via-rose-500/20 to-amber-500/20 px-3 py-2.5 shadow-[0_10px_30px_-12px_rgba(217,70,239,0.45)] backdrop-blur">
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-fuchsia-200">SUPER ADMIN MODE</p>
              <p className="truncate text-xs font-semibold text-white">
                Viewing: {impersonationAdmin.name} <span className="text-zinc-400">({impersonationAdmin.email})</span>
              </p>
              <p className="truncate text-[10px] text-amber-200/90">You are managing this admin account.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setImpersonationAdminId(null);
                setFilterMode("admin_panel");
                setShowAddForm(false);
                setInlineEdit(null);
              }}
              className="shrink-0 rounded-full border border-white/20 bg-black/40 px-3 py-1.5 text-[11px] font-bold text-white hover:border-rose-300/50 hover:text-rose-200"
            >
              Exit
            </button>
          </div>
        )}

        <section className="mb-4 rounded-3xl border border-amber-300/35 bg-[linear-gradient(150deg,rgba(251,191,36,0.17),rgba(17,24,39,0.75)_48%,rgba(22,78,99,0.25))] p-4 shadow-[0_30px_70px_-35px_rgba(251,191,36,0.55)] backdrop-blur-xl">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur">
            <div className="flex items-start gap-4">
              <label className="group relative shrink-0 cursor-pointer">
                <span className="absolute -inset-3 rounded-[1.3rem] bg-[radial-gradient(circle_at_25%_20%,rgba(251,191,36,0.65),transparent_60%),radial-gradient(circle_at_80%_80%,rgba(34,211,238,0.45),transparent_62%)] blur-xl owner-aura" />
                <span className="absolute -inset-1 rounded-[1.05rem] border border-amber-200/45 owner-ring" />
                <div className="relative h-32 w-32 overflow-hidden rounded-2xl border border-white/20 bg-zinc-900 owner-photo-glow">
                  {ownerImage ? (
                    <img src={ownerImage} alt="Owner" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Logo size={64} />
                    </div>
                  )}
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={onOwnerImageChange} />
                <div className="absolute inset-0 hidden items-center justify-center rounded-2xl bg-black/45 text-xs group-hover:flex">Tap to change</div>
              </label>

              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">Owner Profile</p>
                {isEditingOwnerName ? (
                  <input
                    ref={ownerNameInputRef}
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    onBlur={() => setIsEditingOwnerName(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") setIsEditingOwnerName(false);
                    }}
                    placeholder="Type owner name"
                    className="mt-1 w-full border-b border-amber-300/60 bg-transparent pb-1 text-2xl font-black tracking-wide text-amber-50 outline-none placeholder:text-zinc-500"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingOwnerName(true)}
                    className="mt-1 w-full text-left text-2xl font-black leading-tight tracking-wide text-amber-50"
                  >
                    {ownerName.trim() || "Tap to add owner name"}
                  </button>
                )}
                <p className="mt-2 text-sm font-semibold text-amber-100">{greeting.text}</p>
                <p className="text-xs text-amber-300/70">{greeting.sub}</p>
              </div>
            </div>
          </div>
          <h1 className="mt-4 border-t border-amber-300/30 pt-3 text-xl font-bold text-amber-100">Personal Training Database</h1>
        </section>

        <UpcomingPaymentsDashboard
          adminId={effectiveAdminId ?? currentAdmin.id}
          clients={clients}
          history={history}
          onEditClient={(c: Client) => startInlineModify(c)}
          onDeleteClient={(c: Client) => {
            if (window.confirm(`Delete ${c.name}? This cannot be undone.`)) {
              setClients((prev) => prev.filter((x) => x.id !== c.id));
            }
          }}
          onReceivePayment={(c: Client) => receivePayment(c.id)}
          unreadCount={unreadCount}
        />

        <section className="mb-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <StatTile type="all" label="Total Clients" value={stats.totalClients} color="text-white" />
            <StatTile type="paid" label="Paid" value={stats.paidClients} color="text-emerald-400" />
            <StatTile type="due" label="Due Today" value={stats.dueNow} color="text-amber-400" />
            <StatTile type="overdue" label="Overdue" value={stats.overdue} color="text-rose-400" />
          </div>
          {expandedStat && (
            <div className="max-h-[36vh] rounded-2xl border border-white/10 bg-zinc-950/70 p-2 backdrop-blur">
              <div className="mb-2 flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <p className="text-sm font-semibold text-zinc-100">{expandedStatLabels[expandedStat]}</p>
                <button type="button" onClick={() => setExpandedStat(null)} className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300">
                  Close
                </button>
              </div>
              <div className="max-h-[29vh] space-y-1.5 overflow-y-auto pr-1">
                {expandedClients.map((client) => (
                  <ClientRow key={client.id} client={client} compact={false} />
                ))}
                {expandedClients.length === 0 && <p className="py-3 text-center text-xs text-zinc-500">No clients found in this section</p>}
              </div>
            </div>
          )}
        </section>

        <section className="mb-4 rounded-2xl border border-cyan-300/25 bg-[linear-gradient(155deg,rgba(34,211,238,0.14),rgba(9,9,11,0.7))] p-3 shadow-[0_24px_65px_-45px_rgba(34,211,238,0.65)]">
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div>
              <p className="text-xs text-zinc-400">Pending</p>
              <p className="font-semibold text-amber-300">Rs {stats.pendingAmount.toLocaleString("en-IN")}</p>
            </div>
            <div className="border-x border-zinc-700/30">
              <p className="text-xs text-zinc-400">This Month</p>
              <p className="font-semibold text-emerald-300">Rs {stats.thisMonthCollection.toLocaleString("en-IN")}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-400">Rate</p>
              <p className="font-semibold text-cyan-300">{stats.collectionRate}%</p>
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-400" style={{ width: `${stats.collectionRate}%` }} />
          </div>
        </section>

        <button
          type="button"
          onClick={() => {
            setShowAddForm((v) => !v);
            // Per spec: when the user presses "Add New Client", select
            // "All" so the freshly-added client is visible immediately
            // after creation.
            setDueTab("all");
          }}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-300/35 bg-[linear-gradient(145deg,rgba(251,191,36,0.25),rgba(161,98,7,0.35))] p-3 font-semibold text-amber-50 shadow-[0_22px_50px_-30px_rgba(251,191,36,0.75)]"
        >
          <span>{showAddForm ? "Close" : "Add New Client"}</span>
        </button>

        {/* "📋 Show Client Payments" toggle — collapses the entire Client
            Payments section (title, all tabs, filters, list) by default.
            Tap to expand/collapse with a smooth 250ms slide animation. */}
        <button
          type="button"
          onClick={() => setIsClientPaymentsOpen((v) => !v)}
          aria-expanded={isClientPaymentsOpen}
          aria-controls="client-payments-section"
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/35 bg-[linear-gradient(145deg,rgba(34,211,238,0.18),rgba(8,47,73,0.35))] p-3 font-semibold text-cyan-100 shadow-[0_18px_40px_-25px_rgba(34,211,238,0.55)] hover:border-cyan-300/60"
        >
          <span>📋 {isClientPaymentsOpen ? "Hide Client Payments" : "Show Client Payments"}</span>
        </button>

        {showAddForm && (
          <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-900/35 p-4 backdrop-blur">
            <h2 className="mb-3 text-lg font-semibold">New Client</h2>
            <form onSubmit={onSubmit} className="space-y-2">
              <div className="flex gap-2">
                {[1500, 2000].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, amount: String(amount) }))}
                    className={`flex-1 rounded-xl py-2 text-sm ${Number(form.amount) === amount ? "bg-amber-500 text-black" : "border border-zinc-700 bg-zinc-800 text-zinc-300"}`}
                  >
                    Rs {amount.toLocaleString("en-IN")}
                  </button>
                ))}
              </div>
              <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Client name" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
              <input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="WhatsApp number" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
                <span className="truncate">{clientImageFileName || "Select photo"}</span>
                <input type="file" accept="image/*" onChange={onClientImageChange} className="hidden" />
              </label>
              <input value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} type="number" placeholder="Amount" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Start date</label>
                  <input
                    value={form.payDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, payDate: e.target.value }))}
                    type="date"
                    className="w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs [color-scheme:dark] sm:text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">End date</label>
                  <input
                    value={form.dueDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                    type="date"
                    className="w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs [color-scheme:dark] sm:text-sm"
                  />
                </div>
              </div>
              <button type="submit" className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-2.5 font-semibold text-black">
                Save Client
              </button>
            </form>
          </section>
        )}

        {/* Collapsible Client Payments section. Wrapped in a CSS Grid
            container so we can animate from 0fr to 1fr without measuring
            the inner content — no layout jump, no overlap. */}
        <div
          id="client-payments-section"
          className={`client-payments-panel ${isClientPaymentsOpen ? "is-open" : ""}`}
          aria-hidden={!isClientPaymentsOpen}
        >
          <div className="client-payments-panel-inner">
            <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-900/35 p-3 backdrop-blur">
              <h2 className="mb-2 text-lg font-semibold">Client Payments</h2>
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {[
              { key: "clients", label: "Clients" },
              { key: "history90", label: "90 Days" },
              { key: "historyAll", label: "History" },
              { key: "password", label: "Password" },
              { key: "lifetime", label: "Lifetime" },
              // Admin Panel & My Account are only visible to the Super Admin.
              ...(currentAdmin?.role === "super_admin"
                ? [
                    { key: "my_account", label: "My Account" },
                    { key: "admin_panel", label: "Admin Panel" },
                  ]
                : []),
              // Data Management is always available and holds the
              // Export JSON / Export CSV / Import Data actions.
              { key: "data_management", label: "Data Management" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterMode(tab.key as FilterMode)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${filterMode === tab.key ? "border border-amber-400 bg-amber-500/20 text-amber-200" : "border border-zinc-700/50 bg-zinc-800/50 text-zinc-400"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filterMode === "clients" && (
            <>
              {/* Search bar + All / Due / Overdue filter buttons live
                  directly here, under the tabs. No collapsible wrapper —
                  they're always visible. */}
              <input
                ref={clientSearchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or phone"
                className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              />
              <div className="mb-3 flex flex-wrap gap-1.5">
                {[
                  { key: "all", label: `All (${filteredClients.length})` },
                  { key: "due", label: `Due (${stats.dueNow})` },
                  { key: "overdue", label: `Overdue (${stats.overdue})` },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setDueTab(tab.key as DueTab)}
                    className={`rounded-full px-2.5 py-1 text-[10px] ${
                      dueTab === tab.key ? "bg-zinc-700 text-white" : "bg-zinc-800/40 text-zinc-500"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div
                ref={clientListScrollRef}
                className="max-h-[50vh] space-y-2 overflow-y-auto pr-1"
              >
                {dueFilteredClients.length > 0
                  ? dueFilteredClients.map((client) => (
                      <div
                        key={client.id}
                        data-client-id={client.id}
                      >
                        <ClientRow client={client} />
                      </div>
                    ))
                  : <p className="py-6 text-center text-sm text-zinc-400">No clients found</p>}
              </div>
            </>
          )}

          {(filterMode === "history90" || filterMode === "historyAll") && (
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {(filterMode === "history90" ? history90Days : history).map((entry) => (
                <div key={entry.id} className="rounded-xl border border-emerald-500/20 bg-black/30 p-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-emerald-200">{entry.clientName}</p>
                      <p className="text-xs text-zinc-400">{formatDate(entry.paidDate)}</p>
                    </div>
                    <p className="font-bold text-emerald-300">Rs {entry.amount.toLocaleString("en-IN")}</p>
                  </div>
                </div>
              ))}
              {(filterMode === "history90" ? history90Days : history).length === 0 && <p className="py-6 text-center text-sm text-zinc-400">No history</p>}
            </div>
          )}

          {filterMode === "password" && (
            <div className="space-y-3 py-1">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                maxLength={4}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (4 digits)"
                maxLength={4}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                maxLength={4}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              />
              <button type="button" onClick={handleChangePassword} className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-2.5 font-semibold text-black">
                Change Password
              </button>
              {passwordMsg && <p className={`text-center text-sm ${passwordMsg.includes("success") || passwordMsg.includes("reset") ? "text-emerald-400" : "text-rose-400"}`}>{passwordMsg}</p>}

              <div className="mt-5 border-t border-rose-500/30 pt-4">
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
                  <p className="text-sm font-semibold text-rose-300">Reset System</p>
                  <p className="mt-1 text-xs text-rose-200/70">Permanently delete all clients, payment history and dashboard data. Super Admin only.</p>
                  <button
                    type="button"
                    onClick={openResetSystem}
                    className="mt-2 w-full rounded-xl border border-rose-500/40 bg-gradient-to-r from-rose-600 to-rose-700 py-2.5 text-sm font-semibold text-white hover:from-rose-500 hover:to-rose-600"
                  >
                    Reset System
                  </button>
                </div>
              </div>

              {/* Logout — always available, clears session and returns to login. */}
              <div className="mt-3 border-t border-white/10 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Logout now?")) handleLogout();
                  }}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900/70 py-2.5 text-sm font-semibold text-zinc-200 hover:border-rose-400/50 hover:text-rose-200"
                >
                  🚪 Logout
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Force sign out? This will clear all stored data (sessions, cache, drafts) and return to the login screen.")) {
                      handleForceSignOut();
                    }
                  }}
                  className="mt-2 w-full rounded-lg border border-zinc-800 bg-black/30 py-1.5 text-[11px] font-medium text-zinc-400 hover:border-amber-300/40 hover:text-amber-200"
                  title="Clear all local storage and return to the login screen"
                >
                  🧪 Force Sign Out (clear storage)
                </button>
              </div>
            </div>
          )}

          {filterMode === "lifetime" && (
            <div className="space-y-3 py-1">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                <p className="text-xs text-emerald-200/80">Lifetime Collection</p>
                <p className="mt-1 text-2xl font-bold text-emerald-300">Rs {stats.lifetimeCollection.toLocaleString("en-IN")}</p>
              </div>
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-center">
                <p className="text-xs text-cyan-200/80">This Month Collection</p>
                <p className="mt-1 text-lg font-semibold text-cyan-300">Rs {stats.thisMonthCollection.toLocaleString("en-IN")}</p>
              </div>
              <div className="rounded-xl border border-zinc-700/60 bg-black/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-zinc-200">Monthly Payment History</p>
                  <select
                    value={selectedLifetimeMonth}
                    onChange={(e) => setSelectedLifetimeMonth(e.target.value)}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
                  >
                    <option value="all">All Months</option>
                    {monthlyPaymentHistory.map((monthGroup) => (
                      <option key={monthGroup.key} value={monthGroup.key}>
                        {monthGroup.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-2 max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                  {visibleMonthlyPaymentHistory.map((monthGroup) => (
                    <div key={monthGroup.key} className="rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-2">
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-xs font-semibold text-amber-200">{monthGroup.label}</p>
                        <p className="text-xs font-semibold text-emerald-300">Rs {monthGroup.total.toLocaleString("en-IN")}</p>
                      </div>
                      <div className="space-y-1">
                        {monthGroup.entries.map((entry) => (
                          <div key={entry.id} className="flex items-center justify-between rounded-md bg-black/30 px-2 py-1 text-[11px]">
                            <p className="truncate text-zinc-200">{entry.clientName}</p>
                            <p className="px-2 text-zinc-400">{formatDateDayMonth(entry.paidDate)}</p>
                            <p className="font-medium text-emerald-300">Rs {entry.amount.toLocaleString("en-IN")}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {visibleMonthlyPaymentHistory.length === 0 && <p className="py-3 text-center text-xs text-zinc-500">No payment history for selected month</p>}
                </div>
              </div>
            </div>
          )}

          {filterMode === "my_account" && currentAdmin?.role === "super_admin" && currentAdmin && (
            <MyAccountSection
              admin={currentAdmin}
              onAccountUpdated={(a: Admin) => {
                setCurrentAdmin(a);
                setPasswordMsg("Account updated successfully.");
              }}
            />
          )}

          {filterMode === "admin_panel" && currentAdmin?.role === "super_admin" && currentAdmin && (
            <div className="mt-2">
              <AdminManagement
                currentAdmin={currentAdmin}
                onClose={() => setFilterMode("password")}
                onViewDatabase={(admin: Admin) => {
                  // Enter impersonation mode: every data query switches
                  // to the selected admin's id, but the real session is
                  // untouched.
                  setImpersonationAdminId(admin.id);
                  setShowAddForm(false);
                  setInlineEdit(null);
                  setFilterMode("clients");
                }}
                onLeaveReadOnlyView={() => {
                  setImpersonationAdminId(null);
                  setFilterMode("admin_panel");
                }}
              />
             </div>
           )}

          {filterMode === "data_management" && (
            <div className="mt-2 space-y-2">
              <button
                type="button"
                onClick={() => void exportJSON()}
                className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 py-2.5 text-sm font-semibold text-amber-200 hover:border-amber-500/50 hover:bg-amber-500/20"
              >
                📤 Export JSON
              </button>
              <button
                type="button"
                onClick={exportCSV}
                className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-sm font-semibold text-emerald-200 hover:border-emerald-500/50 hover:bg-emerald-500/20"
              >
                📤 Export CSV
              </button>
              <label className="block w-full cursor-pointer rounded-lg border border-sky-500/30 bg-sky-500/10 py-2.5 text-center text-sm font-semibold text-sky-200 hover:border-sky-500/50 hover:bg-sky-500/20">
                📥 Import Data
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={importJSON}
                  className="hidden"
                />
              </label>
            </div>
          )}
            </section>
          </div>
        </div>

        {/* Floating "Exit Admin Mode" button — appears whenever the Super
            Admin is impersonating another admin. Fixed at the bottom of
            the screen so it's always one tap away. */}
        {currentAdmin?.role === "super_admin" && impersonationAdmin && (
          <button
            type="button"
            onClick={() => {
              setImpersonationAdminId(null);
              setFilterMode("admin_panel");
              setShowAddForm(false);
              setInlineEdit(null);
            }}
            className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-fuchsia-300/60 bg-gradient-to-r from-fuchsia-500 to-rose-500 px-5 py-2.5 text-sm font-bold text-white shadow-[0_18px_40px_-12px_rgba(217,70,239,0.55)] hover:from-fuchsia-400 hover:to-rose-400 sm:bottom-6"
          >
            ← Exit Admin Mode
          </button>
        )}
      </main>

      {inlineEdit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setInlineEdit(null)}>
          <div className="w-full max-w-lg rounded-t-2xl border-t border-zinc-700 bg-zinc-900 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit Client</h3>
              <button type="button" onClick={() => setInlineEdit(null)} className="h-8 w-8 rounded-full bg-zinc-800">
                X
              </button>
            </div>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              <input value={inlineEdit.name} onChange={(e) => setInlineEdit((prev) => (prev ? { ...prev, name: e.target.value } : prev))} placeholder="Name" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
              <input value={inlineEdit.phone} onChange={(e) => setInlineEdit((prev) => (prev ? { ...prev, phone: e.target.value } : prev))} placeholder="Phone" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
              <input value={inlineEdit.amount} onChange={(e) => setInlineEdit((prev) => (prev ? { ...prev, amount: e.target.value } : prev))} placeholder="Amount" className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Start date</label>
                  <input
                    type="date"
                    value={inlineEdit.payDate}
                    onChange={(e) => setInlineEdit((prev) => (prev ? { ...prev, payDate: e.target.value } : prev))}
                    className="w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs [color-scheme:dark] sm:text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">End date</label>
                  <input
                    type="date"
                    value={inlineEdit.dueDate}
                    onChange={(e) => setInlineEdit((prev) => (prev ? { ...prev, dueDate: e.target.value } : prev))}
                    className="w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs [color-scheme:dark] sm:text-sm"
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
                <span>{inlineImageFileName || "Change photo"}</span>
                <input type="file" accept="image/*" onChange={onInlineImageChange} className="hidden" />
              </label>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button type="button" onClick={saveInlineModify} className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-2.5 font-semibold text-black">
                  Save
                </button>
                <button type="button" onClick={() => setInlineEdit(null)} className="rounded-xl border border-zinc-700 bg-zinc-800 py-2.5 font-semibold text-white">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showResetModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4" onClick={closeResetSystem}>
          <div className="w-full max-w-sm rounded-2xl border border-rose-500/40 bg-zinc-950 p-4 text-left shadow-[0_30px_70px_-25px_rgba(244,63,94,0.45)]" onClick={(e) => e.stopPropagation()}>
            {resetStep === "backup" && (
              <>
                <p className="text-base font-semibold text-rose-300">Reset System</p>
                <p className="mt-2 text-sm text-zinc-200">Download a backup before resetting?</p>
                <p className="mt-1 text-xs text-zinc-400">We strongly recommend exporting your data (JSON) so you can restore it later if needed.</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={closeResetSystem} className="rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-sm font-medium text-zinc-200">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        void exportJSON();
                      } catch {
                        /* ignore */
                      }
                      setResetStep("admin");
                    }}
                    className="rounded-lg bg-amber-500 py-2 text-sm font-semibold text-black"
                  >
                    Download & Continue
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setResetStep("admin")}
                  className="mt-2 w-full text-center text-xs text-zinc-400 underline-offset-2 hover:text-rose-300 hover:underline"
                >
                  Skip, I already have a backup
                </button>
              </>
            )}

            {resetStep === "admin" && (
              <>
                <p className="text-base font-semibold text-rose-300">Super Admin Verification</p>
                <p className="mt-1 text-xs text-zinc-400">Enter the Super Admin password to continue.</p>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={resetAdminPassword}
                  onChange={(e) => {
                    setResetAdminPassword(e.target.value.replace(/\D/g, "").slice(0, 4));
                    setResetError("");
                  }}
                  placeholder="Super Admin password"
                  className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
                />
                {resetError && <p className="mt-2 text-xs text-rose-400">{resetError}</p>}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={closeResetSystem} className="rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-sm font-medium text-zinc-200">
                    Cancel
                  </button>
                  <button type="button" onClick={() => void confirmResetAdminPassword()} className="rounded-lg bg-amber-500 py-2 text-sm font-semibold text-black">
                    Continue
                  </button>
                </div>
                <button type="button" onClick={() => setResetStep("backup")} className="mt-2 w-full text-center text-xs text-zinc-400 hover:text-zinc-200">
                  Back
                </button>
              </>
            )}

            {resetStep === "warning" && (
              <>
                <p className="text-base font-semibold text-rose-300">Final Warning</p>
                <p className="mt-2 text-sm text-rose-200/90">
                  This will permanently delete all clients, payment history, dashboard data and settings. This action cannot be undone.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={closeResetSystem} className="rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-sm font-medium text-zinc-200">
                    Cancel
                  </button>
                  <button type="button" onClick={() => void executeResetSystem()} className="rounded-lg bg-gradient-to-r from-rose-600 to-rose-700 py-2 text-sm font-semibold text-white">
                    Reset Everything
                  </button>
                </div>
                <button type="button" onClick={() => setResetStep("admin")} className="mt-2 w-full text-center text-xs text-zinc-400 hover:text-zinc-200">
                  Back
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes ownerAura {
          0%,
          100% {
            opacity: 0.6;
          }
          50% {
            opacity: 1;
          }
        }

        @keyframes ownerRing {
          0%,
          100% {
            box-shadow: 0 0 10px rgba(251, 191, 36, 0.4), 0 0 24px rgba(34, 211, 238, 0.2);
          }
          50% {
            box-shadow: 0 0 20px rgba(251, 191, 36, 0.7), 0 0 36px rgba(34, 211, 238, 0.35);
          }
        }

        @keyframes ownerPhotoGlow {
          0%,
          100% {
            box-shadow: 0 0 22px rgba(251, 191, 36, 0.22);
          }
          50% {
            box-shadow: 0 0 36px rgba(251, 191, 36, 0.45), 0 0 24px rgba(34, 211, 238, 0.2);
          }
        }

        /* Whole-section collapse animation for the Client Payments card.
           Uses the CSS Grid 0fr → 1fr trick to animate from 0 to the
           natural content height without measuring the DOM. 250ms
           ease-out, no layout jump, no overlap with siblings. */
        .client-payments-panel {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 250ms ease-out;
          overflow: hidden;
        }
        .client-payments-panel.is-open {
          grid-template-rows: 1fr;
        }
        .client-payments-panel-inner {
          min-height: 0;
          overflow: hidden;
          opacity: 0;
          transform: translateY(-6px);
          transition: opacity 220ms ease-out, transform 250ms ease-out;
        }
        .client-payments-panel.is-open .client-payments-panel-inner {
          opacity: 1;
          transform: translateY(0);
        }
        @media (prefers-reduced-motion: reduce) {
          .client-payments-panel,
          .client-payments-panel-inner {
            transition: none;
          }
        }

        .owner-aura {
          animation: ownerAura 3.2s ease-in-out infinite;
          will-change: opacity;
        }

        .owner-ring {
          animation: ownerRing 3s ease-in-out infinite;
          will-change: box-shadow;
        }

        .owner-photo-glow {
          animation: ownerPhotoGlow 2.6s ease-in-out infinite;
          will-change: box-shadow;
        }

      `}</style>
    </div>
  );
}

// ============================================================================
// My Account section — only rendered for the Super Admin.
// Allows editing own name, email, photo, and password. The Super Admin
// account cannot be deleted or disabled (those buttons are not rendered
// here, and the auth helpers reject the operations for super_admin).
// ============================================================================
function MyAccountSection({
  admin,
  onAccountUpdated,
}: {
  admin: Admin;
  onAccountUpdated: (updated: Admin) => void;
}) {
  const [name, setName] = useState(admin.name);
  const [email, setEmail] = useState(admin.email);
  const [phone, setPhone] = useState(admin.phone);
  const [photo, setPhoto] = useState(admin.photo);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const compressPhoto = (file: File) =>
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

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await compressPhoto(file);
      setPhoto(data);
      // Persist immediately
      const res = await updateAdmin(admin.id, { photo: data });
      if (res.ok) {
        onAccountUpdated(res.admin);
        setMsg("Account updated successfully.");
      }
    } catch {
      setMsg("Could not upload image.");
    } finally {
      e.target.value = "";
    }
  };

  const saveProfile = async () => {
    if (!email.trim() || !name.trim()) {
      setMsg("Name and email are required.");
      return;
    }
    const res = await updateAdmin(admin.id, { name, email, phone, photo });
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    onAccountUpdated(res.admin);
    // Email change invalidates and refreshes the session.
    if (res.admin.email !== admin.email) {
      const session = loadSession();
      if (session) {
        localStorage.setItem(
          "ptd_session_v1",
          JSON.stringify({ ...session, adminId: res.admin.id }),
        );
      }
    }
    setMsg("Account updated successfully.");
  };

  const changePassword = async () => {
    if (!currentPw || !newPw || !confirmPw) {
      setMsg("Please fill in all password fields.");
      return;
    }
    if (newPw !== confirmPw) {
      setMsg("New passwords do not match.");
      return;
    }
    setBusy(true);
    // The new `changeOwnPassword` in `auth.ts` does the verification
    // server-side via Supabase Auth — we just pass the current and new
    // passwords and let Supabase validate.
    const res = await changeOwnPassword(currentPw, newPw);
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error);
      return;
    }
    // Session was invalidated by changeOwnPassword; preserve remember-me
    // and re-create the session so the user stays logged in.
    const remembered = localStorage.getItem("ptd_remember_v1") === "1";
    const fresh = {
      adminId: admin.id,
      role: admin.role,
      startedAt: new Date().toISOString(),
    };
    localStorage.setItem("ptd_session_v1", JSON.stringify(fresh));
    setMsg("Account updated successfully.");
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    void remembered;
  };

  return (
    <div className="mt-2 space-y-3">
      {/* Profile card */}
      <div className="rounded-2xl border border-amber-300/30 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-amber-300/40">
            {photo ? (
              <img src={photo} alt={name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-xl font-black text-amber-300">
                {name.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-white">{name}</p>
            <p className="truncate text-xs text-cyan-200/80">{email}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-amber-200/80">
              Role: {admin.role === "super_admin" ? "Super Admin" : "Admin"}
            </p>
          </div>
          <label className="cursor-pointer rounded-lg border border-amber-300/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20">
            📷 Change
            <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
          </label>
        </div>
      </div>

      {/* Profile fields */}
      <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-200/70">Profile</p>
        <div className="space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
          />
          <button
            type="button"
            onClick={saveProfile}
            className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-2.5 text-sm font-bold text-black hover:from-amber-400 hover:to-amber-500"
          >
            Save Profile
          </button>
        </div>
      </div>

      {/* Change password */}
      <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-200/70">Change Password</p>
        <div className="space-y-2">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Current password"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (min 6)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
          />
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Confirm new password"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
          />
          <button
            type="button"
            onClick={changePassword}
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 py-2.5 text-sm font-bold text-white disabled:opacity-70"
          >
            {busy ? "Updating..." : "Update Password"}
          </button>
        </div>
      </div>

      {msg && (
        <p className={`text-center text-xs ${msg.includes("success") ? "text-emerald-300" : "text-rose-300"}`}>
          {msg}
        </p>
      )}

      <p className="text-center text-[10px] text-zinc-500">
        🔒 The Super Admin account cannot be deleted or disabled.
      </p>
    </div>
  );
}
