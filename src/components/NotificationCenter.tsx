import { useEffect, useMemo, useState } from "react";
import {
  AppNotification,
  NotificationType,
  clearAllNotifications,
  formatNotificationDate,
  formatNotificationTime,
  groupKeyForTimestamp,
  loadNotifications,
  markAllRead,
  markRead,
  markUnread,
} from "../notifications";
import Portal from "./Portal";

type Props = {
  adminId: string;
  unreadCount: number;
  onCountChange?: (count: number) => void;
};

const iconForType = (type: NotificationType) => {
  switch (type) {
    case "new_client":
      return { symbol: "👤", tint: "text-cyan-300 bg-cyan-500/15 border-cyan-400/30" };
    case "payment_received":
      return { symbol: "💰", tint: "text-emerald-300 bg-emerald-500/15 border-emerald-400/30" };
    case "due_today":
      return { symbol: "⏰", tint: "text-amber-300 bg-amber-500/15 border-amber-400/30" };
    case "overdue":
      return { symbol: "⚠️", tint: "text-rose-300 bg-rose-500/15 border-rose-400/30" };
    case "client_edited":
      return { symbol: "✏️", tint: "text-sky-300 bg-sky-500/15 border-sky-400/30" };
    case "client_deleted":
      return { symbol: "🗑️", tint: "text-zinc-300 bg-zinc-500/15 border-zinc-400/30" };
    case "upcoming_reminder":
      return { symbol: "🔔", tint: "text-amber-300 bg-amber-500/15 border-amber-400/30" };
    default:
      return { symbol: "•", tint: "text-zinc-300 bg-zinc-500/15 border-zinc-400/30" };
  }
};

const groupLabels: Record<"today" | "yesterday" | "older", string> = {
  today: "Today",
  yesterday: "Yesterday",
  older: "Older",
};

const groupOrder: Array<"today" | "yesterday" | "older"> = ["today", "yesterday", "older"];

export default function NotificationCenter({ adminId, unreadCount, onCountChange }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  // Load notifications when the modal opens so the list is always fresh.
  useEffect(() => {
    if (!open) return;
    setItems(loadNotifications(adminId));
  }, [open, adminId]);

  // Trigger mount animation on next frame.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Sync parent count whenever items list changes.
  useEffect(() => {
    if (!onCountChange) return;
    const count = loadNotifications(adminId).filter((n) => !n.read).length;
    onCountChange(count);
  }, [items, onCountChange, adminId]);

  const grouped = useMemo(() => {
    const out: Record<"today" | "yesterday" | "older", AppNotification[]> = {
      today: [],
      yesterday: [],
      older: [],
    };
    items.forEach((n) => {
      out[groupKeyForTimestamp(n.timestamp)].push(n);
    });
    return out;
  }, [items]);

  const handleOpen = () => {
    setClosing(false);
    setOpen(true);
  };

  const handleClose = () => {
    setClosing(true);
    setMounted(false);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 260);
  };

  const handleToggleRead = (n: AppNotification) => {
    if (n.read) markUnread(adminId, n.id);
    else markRead(adminId, n.id);
    setItems(loadNotifications(adminId));
  };

  const handleMarkAllRead = () => {
    markAllRead(adminId);
    setItems(loadNotifications(adminId));
  };

  const handleClearAll = () => {
    if (window.confirm("Clear all notifications?")) {
      clearAllNotifications(adminId);
      setItems([]);
    }
  };

  const showState = mounted && !closing;
  const backdropClass = showState ? "nt-backdrop-in" : "nt-backdrop-out";
  const modalClass = showState ? "nt-modal-in" : "nt-modal-out";

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="group relative h-10 w-10 rounded-full border border-white/15 bg-black/40 text-lg text-zinc-200 transition hover:border-cyan-300/50 hover:text-cyan-200"
        aria-label="Open notifications"
        title="Notifications"
      >
        <span className="absolute inset-0 flex items-center justify-center">🔔</span>
        {unreadCount > 0 && (
          <span
            className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full border border-amber-300 bg-gradient-to-br from-amber-400 to-amber-600 px-1 text-[10px] font-black text-black shadow-[0_0_12px_rgba(251,191,36,0.55)]"
            aria-label={`${unreadCount} unread notifications`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
        <span className="pointer-events-none absolute -inset-1 rounded-full bg-cyan-500/0 blur-md transition group-hover:bg-cyan-500/20" />
      </button>

      {open && (
        <Portal lockScroll>
          <div
            className={`nt-root ${backdropClass}`}
            onClick={handleClose}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
          >
            <div className={`nt-frame ${modalClass}`} onClick={(e) => e.stopPropagation()}>
              <div className="nt-header">
                <div>
                  <p className="text-sm font-semibold text-white">Notifications</p>
                  <p className="text-[10px] text-zinc-400">{unreadCount} unread</p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="nt-icon-btn h-9 w-9 rounded-full border border-white/10 bg-black/40 text-zinc-300 hover:border-rose-400/50 hover:text-rose-300"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="nt-toolbar">
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="nt-action rounded-md border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] font-semibold text-cyan-200 hover:border-cyan-300/50"
                >
                  Mark all read
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="nt-action rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-semibold text-rose-300 hover:border-rose-400/60"
                >
                  Clear all
                </button>
              </div>

              <div className="nt-scroll">
                {items.length === 0 && (
                  <div className="rounded-xl border border-white/10 bg-black/30 p-6 text-center text-sm text-zinc-400">
                    No notifications yet.
                  </div>
                )}
                {groupOrder.map((group) => {
                  const list = grouped[group];
                  if (list.length === 0) return null;
                  return (
                    <div key={group} className="mb-3">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        {groupLabels[group]}
                      </p>
                      <div className="space-y-1.5">
                        {list.map((n) => {
                          const icon = iconForType(n.type);
                          return (
                            <div
                              key={n.id}
                              className={`flex items-start gap-2 rounded-xl border p-2 transition ${
                                n.read
                                  ? "border-white/5 bg-black/20 opacity-70"
                                  : "border-cyan-300/30 bg-cyan-500/5"
                              }`}
                            >
                              <div
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm ${icon.tint}`}
                              >
                                {icon.symbol}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-white">{n.title}</p>
                                <p className="line-clamp-2 text-[11px] text-zinc-300">{n.message}</p>
                                <p className="mt-0.5 text-[10px] text-zinc-500">
                                  {formatNotificationDate(n.timestamp)} • {formatNotificationTime(n.timestamp)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleToggleRead(n)}
                                className="nt-action shrink-0 rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-[9px] text-zinc-300 hover:border-amber-300/50 hover:text-amber-200"
                                title={n.read ? "Mark as unread" : "Mark as read"}
                              >
                                {n.read ? "Unread" : "Read"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-900/70 py-2.5 text-sm font-semibold text-zinc-200 hover:border-amber-300/40 hover:text-amber-200"
              >
                Close
              </button>
            </div>
          </div>

          <style>{`
            .nt-root {
              position: fixed;
              inset: 0;
              z-index: 2147483647;
              isolation: isolate;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 12px;
              background-color: rgba(0, 0, 0, 0);
              overflow: hidden;
              -webkit-tap-highlight-color: transparent;
            }
            @media (min-width: 640px) {
              .nt-root { padding: 24px; }
            }

            .nt-frame {
              position: relative;
              width: min(95vw, 500px);
              max-height: 90vh;
              display: flex;
              flex-direction: column;
              border-radius: 1.5rem;
              border: 1px solid rgba(103, 232, 249, 0.3);
              background: linear-gradient(135deg, rgba(24,24,27,0.97), rgba(8,47,73,0.35) 50%, rgba(9,9,11,0.97));
              box-shadow: 0 30px 90px -25px rgba(34, 211, 238, 0.55);
              padding: 14px;
              backdrop-filter: blur(20px);
              -webkit-backdrop-filter: blur(20px);
            }

            .nt-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              border-bottom: 1px solid rgba(255, 255, 255, 0.1);
              padding-bottom: 10px;
            }

            .nt-toolbar {
              display: flex;
              justify-content: flex-end;
              gap: 6px;
              margin-top: 10px;
            }

            .nt-scroll {
              flex: 1 1 auto;
              min-height: 0;
              margin-top: 10px;
              overflow-y: auto;
              overflow-x: hidden;
              padding-right: 4px;
              scrollbar-width: thin;
              -webkit-overflow-scrolling: touch;
            }

            @keyframes ntBackdropIn {
              0% { background-color: rgba(0, 0, 0, 0); backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); }
              100% { background-color: rgba(0, 0, 0, 0.82); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
            }
            @keyframes ntBackdropOut {
              0% { background-color: rgba(0, 0, 0, 0.82); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
              100% { background-color: rgba(0, 0, 0, 0); backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); }
            }
            @keyframes ntModalIn {
              0% { opacity: 0; transform: translateY(20px) scale(0.94); }
              100% { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes ntModalOut {
              0% { opacity: 1; transform: translateY(0) scale(1); }
              100% { opacity: 0; transform: translateY(12px) scale(0.96); }
            }
            .nt-backdrop-in { animation: ntBackdropIn 280ms ease-out forwards; }
            .nt-backdrop-out { animation: ntBackdropOut 240ms ease-in forwards; }
            .nt-modal-in { animation: ntModalIn 400ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
            .nt-modal-out { animation: ntModalOut 240ms ease-in forwards; }

            .nt-action {
              transition: transform 200ms ease, filter 200ms ease, box-shadow 200ms ease;
            }
            .nt-action:hover { transform: translateY(-1px); filter: brightness(1.1); }
            .nt-action:active { transform: translateY(0); }

            .nt-icon-btn {
              transition: transform 200ms ease, background-color 200ms ease;
              display: inline-flex;
              align-items: center;
              justify-content: center;
            }
            .nt-icon-btn:hover { transform: scale(1.05); }
          `}</style>
        </Portal>
      )}
    </>
  );
}
