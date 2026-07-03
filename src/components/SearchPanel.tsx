import { useEffect, useMemo, useRef, useState } from "react";
import { Client, PaymentHistory } from "../db";
import {
  formatDate,
  getClientStatus,
  getDaysUntilDue,
  statusBadgeClass,
  statusToLabel,
  type ClientStatus,
} from "../App.helpers";
import Portal from "./Portal";

type Props = {
  clients: Client[];
  history: PaymentHistory[];
  onClose: () => void;
  onSelectClient: (client: Client) => void;
  onEditClient: (client: Client) => void;
};

type FilterKey = "all" | "upcoming" | "due" | "overdue" | "paid_this_month";

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All Clients" },
  { key: "upcoming", label: "Upcoming" },
  { key: "due", label: "Due Today" },
  { key: "overdue", label: "Overdue" },
  { key: "paid_this_month", label: "Paid This Month" },
];

const inCurrentMonth = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

// Highlights matched substring within a string with a gold underline.
const highlight = (text: string, query: string): React.ReactNode => {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-400/30 px-0.5 text-amber-100">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
};

const statusLabel = (status: ClientStatus, days: number) => {
  if (status === "due") return "Due Today";
  if (status === "overdue") return `${Math.abs(days)}d Overdue`;
  if (status === "upcoming") return `${days}d left`;
  return "Unknown";
};

export default function SearchPanel({ clients, history, onClose, onSelectClient, onEditClient }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Autofocus the search input when the panel opens.
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      setMounted(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    // ESC closes the panel.
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    setClosing(true);
    setMounted(false);
    setTimeout(() => onClose(), 240);
  };

  // Precompute clientIds that have a payment received in the current month.
  const paidThisMonthClientIds = useMemo(() => {
    const ids = new Set<string>();
    history.forEach((entry) => {
      if (inCurrentMonth(entry.paidDate)) ids.add(entry.clientId);
    });
    return ids;
  }, [history]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients
      .map((c) => {
        const status = getClientStatus(c.dueDate);
        const days = getDaysUntilDue(c.dueDate);
        return { client: c, status, days };
      })
      .filter(({ client, status }) => {
        // Filter chip first
        if (filter === "upcoming" && status !== "upcoming") return false;
        if (filter === "due" && status !== "due") return false;
        if (filter === "overdue" && status !== "overdue") return false;
        if (filter === "paid_this_month" && !paidThisMonthClientIds.has(client.id)) return false;

        if (!q) return true;
        if (client.name.toLowerCase().includes(q)) return true;
        if (client.phone.toLowerCase().includes(q)) return true;
        if (client.dueDate.toLowerCase().includes(q)) return true;
        if (formatDate(client.dueDate).toLowerCase().includes(q)) return true;
        const statusText = statusLabel(status, getDaysUntilDue(client.dueDate)).toLowerCase();
        if (statusText.includes(q)) return true;
        if (q === "upcoming" && status === "upcoming") return true;
        if (q === "due" && status === "due") return true;
        if (q === "overdue" && status === "overdue") return true;
        if (q === "paid" && paidThisMonthClientIds.has(client.id)) return true;
        return false;
      })
      .sort((a, b) => a.days - b.days);
  }, [clients, query, filter, paidThisMonthClientIds, history]);

  const showState = mounted && !closing;
  const backdropClass = showState ? "sp-backdrop-in" : "sp-backdrop-out";
  const modalClass = showState ? "sp-modal-in" : "sp-modal-out";

  return (
    <Portal lockScroll>
      <div
        className={`sp-root ${backdropClass}`}
        onClick={handleClose}
        role="dialog"
        aria-modal="true"
        aria-label="Search clients"
      >
        <div className={`sp-frame ${modalClass}`} onClick={(e) => e.stopPropagation()}>
          <div className="sp-header">
            <span className="text-lg">🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, phone, due date, or status..."
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
            />
            <button
              type="button"
              onClick={handleClose}
              className="sp-icon-btn h-8 w-8 rounded-full border border-white/10 bg-black/40 text-xs text-zinc-300 hover:border-rose-400/50 hover:text-rose-300"
              aria-label="Close search"
            >
              ✕
            </button>
          </div>

          <div className="sp-toolbar">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] transition ${
                  filter === f.key
                    ? "border-amber-300/60 bg-amber-500/20 text-amber-100"
                    : "border-white/10 bg-black/30 text-zinc-400 hover:border-cyan-300/40 hover:text-cyan-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="sp-scroll">
            {results.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-black/30 p-6 text-center text-sm text-zinc-400">
                No clients found
              </div>
            )}
            {results.map(({ client, status, days }) => {
              return (
                <div
                  key={client.id}
                  className="group mb-1.5 flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 p-2.5 transition hover:border-amber-300/40"
                >
                  <button
                    type="button"
                    onClick={() => onSelectClient(client)}
                    className="flex flex-1 items-center gap-3 text-left"
                  >
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-white/10">
                      {client.photo ? (
                        <img src={client.photo} alt={client.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-sm font-black text-amber-300">
                          {client.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold text-white">
                          {highlight(client.name, query)}
                        </p>
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] ${statusBadgeClass(status)}`}
                        >
                          {status === "due"
                            ? "DUE TODAY"
                            : status === "overdue"
                              ? `${Math.abs(days)}d OVERDUE`
                              : `${days}d LEFT`}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-zinc-300">
                        {highlight(client.phone, query)}
                        <span className="mx-1.5 text-zinc-600">•</span>
                        <span className="text-amber-200/90">Next: {highlight(formatDate(client.dueDate), query)}</span>
                      </p>
                      <p className="text-[10px] text-cyan-200/80">{statusToLabel(status, days)}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditClient(client)}
                    className="sp-action shrink-0 rounded-full border border-cyan-300/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 opacity-0 transition group-hover:opacity-100"
                    title="Edit client"
                  >
                    Edit
                  </button>
                </div>
              );
            })}
          </div>

          <div className="sp-footer">
            <p className="text-[10px] text-zinc-500">
              {results.length} result{results.length === 1 ? "" : "s"} • Press ESC to close
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="sp-action rounded-lg border border-white/10 bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-amber-300/40 hover:text-amber-200"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .sp-root {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          isolation: isolate;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 12px;
          padding-top: 40px;
          background-color: rgba(0, 0, 0, 0);
          overflow: hidden;
          -webkit-tap-highlight-color: transparent;
        }
        @media (min-width: 640px) {
          .sp-root { padding: 24px; padding-top: 64px; }
        }

        .sp-frame {
          position: relative;
          width: min(95vw, 500px);
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          border-radius: 1.25rem;
          border: 1px solid rgba(252, 211, 77, 0.3);
          background: linear-gradient(135deg, rgba(24,24,27,0.97), rgba(120,53,15,0.25) 50%, rgba(9,9,11,0.97));
          box-shadow: 0 30px 90px -25px rgba(251, 191, 36, 0.55);
          padding: 12px;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        .sp-header {
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 8px;
        }

        .sp-toolbar {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          margin-top: 8px;
          padding-bottom: 4px;
          scrollbar-width: none;
        }
        .sp-toolbar::-webkit-scrollbar { display: none; }

        .sp-scroll {
          flex: 1 1 auto;
          min-height: 0;
          margin-top: 8px;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 4px;
          scrollbar-width: thin;
          -webkit-overflow-scrolling: touch;
        }

        .sp-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          margin-top: 8px;
          padding-top: 8px;
        }

        @keyframes spBackdropIn {
          0% { background-color: rgba(0, 0, 0, 0); backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); }
          100% { background-color: rgba(0, 0, 0, 0.82); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
        }
        @keyframes spBackdropOut {
          0% { background-color: rgba(0, 0, 0, 0.82); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
          100% { background-color: rgba(0, 0, 0, 0); backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); }
        }
        @keyframes spModalIn {
          0% { opacity: 0; transform: translateY(-20px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes spModalOut {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-10px) scale(0.96); }
        }
        .sp-backdrop-in { animation: spBackdropIn 280ms ease-out forwards; }
        .sp-backdrop-out { animation: spBackdropOut 240ms ease-in forwards; }
        .sp-modal-in { animation: spModalIn 400ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
        .sp-modal-out { animation: spModalOut 240ms ease-in forwards; }

        .sp-action {
          transition: transform 200ms ease, filter 200ms ease, box-shadow 200ms ease;
        }
        .sp-action:hover { transform: translateY(-1px); filter: brightness(1.1); }
        .sp-action:active { transform: translateY(0); }

        .sp-icon-btn {
          transition: transform 200ms ease, background-color 200ms ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .sp-icon-btn:hover { transform: scale(1.05); }
      `}</style>
    </Portal>
  );
}
