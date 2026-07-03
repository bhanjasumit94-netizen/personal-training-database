import { useEffect, useMemo, useState } from "react";
import { Client, PaymentHistory } from "../db";
import { formatDate, getDaysUntilDue, toIsoDate } from "../App.helpers";
import Portal from "./Portal";

type Props = {
  client: Client;
  history: PaymentHistory[];
  onClose: () => void;
  onEdit: (client: Client) => void;
  onReceivePayment?: (client: Client) => void;
  onDelete?: (client: Client) => void;
};

const getTotalTrainingDays = (payDate: string): number => {
  const start = new Date(`${payDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (start.getTime() > today.getTime()) return 0;
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
};

const statusFor = (days: number) => {
  if (Number.isNaN(days)) return { key: "unknown" as const, label: "Unknown", className: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40" };
  if (days < 0) return { key: "overdue" as const, label: `${Math.abs(days)}d Overdue`, className: "bg-rose-500/20 text-rose-300 border-rose-500/40" };
  if (days === 0) return { key: "due" as const, label: "Due Today", className: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
  return { key: "upcoming" as const, label: `${days}d left`, className: "bg-sky-500/20 text-sky-300 border-sky-500/40" };
};

// Detect low-power devices to disable heavy blur on the backdrop.
const detectLowPower = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const hc = navigator.hardwareConcurrency ?? 0;
  // Cached "data-saver" / "prefers-reduced-data"
  // @ts-expect-error - non-standard
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ""))) return true;
  if (typeof dm === "number" && dm <= 2) return true;
  if (hc && hc <= 2) return true;
  return false;
};

export default function ClientDetailsPopup({
  client,
  history,
  onClose,
  onEdit,
  onReceivePayment,
  onDelete,
}: Props) {
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState<"details" | "history">("details");

  // The entry animation is triggered by a useEffect below. It does NOT
  // re-run on internal state changes (flipped, tab), so we don't need
  // a play-once ref guard any more. The close handler is also free to
  // run at any time.
  const [lowPower] = useState(() => detectLowPower());
  const [reducedMotion, setReducedMotion] = useState(false);

  // Detect prefers-reduced-motion once
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener?.("change", handler);
    return () => mql.removeEventListener?.("change", handler);
  }, []);

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close handler. Called by:
  //   - the X button in the sticky header
  //   - the Close button at the bottom of each face
  //   - clicking the backdrop (root div's onClick)
  //   - pressing Escape
  //   - flipping back from the back face via the Back button
  // The 200ms timeout lets the close animation play before unmounting.
  const handleClose = () => {
    const card = document.getElementById("pt-card-el");
    const root = document.getElementById("pt-root-el");
    if (card) card.classList.remove("pt-card-in");
    if (card) card.classList.add("pt-card-out");
    if (root) root.classList.remove("pt-backdrop-in");
    if (root) root.classList.add("pt-backdrop-out");
    setTimeout(() => onClose(), 200);
  };

  // Trigger the entry animation exactly once on mount, and re-trigger
  // whenever the user opens the popup for a different client (so the
  // previous close animation's final "opacity:0" state doesn't leave
  // the card invisible on a re-open).
  useEffect(() => {
    // If the user prefers reduced motion, open instantly (no animation).
    if (reducedMotion) {
      const card = document.getElementById("pt-card-el");
      const root = document.getElementById("pt-root-el");
      if (card) {
        card.classList.remove("pt-card-in", "pt-card-out");
        card.classList.add("pt-card-instant");
      }
      if (root) {
        root.classList.remove("pt-backdrop-in", "pt-backdrop-out");
        root.classList.add("pt-backdrop-instant");
      }
      return;
    }

    // Apply the entry class on the next frame so the browser paints the
    // initial "before" state first and then animates. We also clear any
    // leftover close-state classes so the card always starts from
    // "hidden" and animates to "visible" — never the other way around.
    let raf = 0;
    raf = requestAnimationFrame(() => {
      const card = document.getElementById("pt-card-el");
      const root = document.getElementById("pt-root-el");
      if (card) {
        card.classList.remove("pt-card-instant", "pt-card-out");
        card.classList.add("pt-card-in");
      }
      if (root) {
        root.classList.remove("pt-backdrop-instant", "pt-backdrop-out");
        root.classList.add("pt-backdrop-in");
      }
    });

    // Safety net: if the entry animation hasn't completed (or the rAF
    // never fired, e.g. tab was backgrounded) the card is stuck at
    // opacity:0. Force the .pt-card-instant fallback after 500ms so
    // the popup is always visible.
    const safety = setTimeout(() => {
      const card = document.getElementById("pt-card-el");
      const root = document.getElementById("pt-root-el");
      if (card) {
        // If the card is still inside the keyframe's "0%" state
        // (opacity:0) and the rAF is queued, swap to the instant
        // fallback so the user never sees a blank popup.
        const computed = window.getComputedStyle(card);
        const opacity = parseFloat(computed.opacity);
        if (!Number.isFinite(opacity) || opacity < 0.5) {
          card.classList.remove("pt-card-in", "pt-card-out");
          card.classList.add("pt-card-instant");
        }
      }
      if (root) {
        root.classList.add("pt-backdrop-instant");
      }
    }, 500);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, [client.id, reducedMotion]);

  const daysUntilDue = getDaysUntilDue(client.dueDate);
  const totalDays = getTotalTrainingDays(client.payDate);
  const status = statusFor(daysUntilDue);

  const clientHistory = useMemo(
    () =>
      history
        .filter((entry) => entry.clientId === client.id)
        .sort((a, b) => new Date(b.paidDate).getTime() - new Date(a.paidDate).getTime()),
    [history, client.id],
  );

  const lastPayment = clientHistory[0];

  const openWhatsApp = (text?: string) => {
    const cleaned = client.phone.replace(/\D/g, "");
    const message =
      text ??
      (daysUntilDue < 0
        ? `Hi ${client.name}, your payment of Rs ${client.amount.toLocaleString("en-IN")} is overdue by ${Math.abs(daysUntilDue)} day(s). Please clear it soon.`
        : `Hi ${client.name}, your payment of Rs ${client.amount.toLocaleString("en-IN")} is due ${daysUntilDue === 0 ? "today" : `on ${formatDate(client.dueDate)}`}. Please clear it soon.`);
    window.open(`https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  const callClient = () => {
    const cleaned = client.phone.replace(/\D/g, "");
    window.location.href = `tel:+${cleaned}`;
  };

  const sendReminder = () => openWhatsApp();

  // Front face is visible when not flipped; back face is visible only when flipped.
  // The base .pt-face-front { z-index: 2 } / .pt-face-back { z-index: 1 }
  // CSS rules ensure the front face is always on top so its buttons
  // receive clicks. visibility + pointer-events are toggled together
  // so a hidden face can never intercept a click.
  const faceFrontStyle = {
    transform: "rotateY(0deg)",
    opacity: flipped ? 0 : 1,
    visibility: (flipped ? "hidden" : "visible") as "visible" | "hidden",
    pointerEvents: (flipped ? "none" : "auto") as "none" | "auto",
  };
  const faceBackStyle = {
    transform: "rotateY(180deg)",
    opacity: flipped ? 1 : 0,
    visibility: (flipped ? "visible" : "hidden") as "visible" | "hidden",
    pointerEvents: (flipped ? "auto" : "none") as "none" | "auto",
  };

  return (
    <Portal lockScroll>
      <div
        id="pt-root-el"
        className="pt-root"
        onClick={handleClose}
        role="dialog"
        aria-modal="true"
        aria-label={`Client details for ${client.name}`}
      >
        <div
          className="pt-frame"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            id="pt-card-el"
            className="pt-card"
            style={{
              transformStyle: "preserve-3d",
              perspective: "1400px",
            }}
          >
            {/* ================= FRONT (Details) ================= */}
            <div className="pt-face pt-face-front" style={faceFrontStyle}>
              {/* Glow accents */}
              <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-amber-500/25 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -right-12 h-48 w-48 rounded-full bg-cyan-500/25 blur-3xl" />

              {/* Sticky Header */}
              <div className="pt-sticky-header">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-amber-300/40 shadow-[0_0_18px_rgba(251,191,36,0.3)]">
                    {client.photo ? (
                      <img src={client.photo} alt={client.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-base font-black text-amber-300">
                        {client.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{client.name}</p>
                    <p className="truncate text-[11px] text-cyan-200/80">{client.phone}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="pt-icon-btn h-9 w-9 shrink-0 rounded-full border border-white/10 bg-black/40 text-zinc-300 hover:border-rose-400/50 hover:text-rose-300"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="pt-scroll">
                <div className="flex flex-col items-center text-center">
                  <div className="relative h-24 w-24 overflow-hidden rounded-2xl border-2 border-amber-300/40 shadow-[0_0_35px_rgba(251,191,36,0.4)]">
                    {client.photo ? (
                      <img src={client.photo} alt={client.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-3xl font-black text-amber-300">
                        {client.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <h2 className="mt-2.5 text-lg font-black tracking-wide text-amber-50">{client.name}</h2>
                  <p className="text-[11px] text-cyan-200/80">{client.phone}</p>
                  <span
                    className={`mt-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${status.className}`}
                  >
                    {status.label}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                    <p className="text-zinc-400">Start Date</p>
                    <p className="mt-0.5 font-semibold text-zinc-100">{formatDate(client.payDate)}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                    <p className="text-zinc-400">Next Payment</p>
                    <p className="mt-0.5 font-semibold text-amber-200">{formatDate(client.dueDate)}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                    <p className="text-zinc-400">Days Remaining</p>
                    <p className={`mt-0.5 font-semibold ${daysUntilDue < 0 ? "text-rose-300" : daysUntilDue === 0 ? "text-amber-200" : "text-cyan-200"}`}>
                      {Number.isNaN(daysUntilDue) ? "-" : daysUntilDue < 0 ? `${Math.abs(daysUntilDue)}d overdue` : `${daysUntilDue}d`}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                    <p className="text-zinc-400">Training Days</p>
                    <p className="mt-0.5 font-semibold text-emerald-300">{totalDays}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                    <p className="text-zinc-400">Payment Status</p>
                    <p className="mt-0.5 font-semibold text-zinc-100">
                      {client.paid ? "Paid" : "Pending"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                    <p className="text-zinc-400">Last Paid</p>
                    <p className="mt-0.5 font-semibold text-zinc-100">{lastPayment ? formatDate(lastPayment.paidDate) : "—"}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-amber-300/30 bg-gradient-to-r from-amber-500/15 to-amber-500/5 p-2.5 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-amber-200/80">Amount Due</p>
                  <p className="mt-0.5 text-2xl font-black text-amber-200">Rs {client.amount.toLocaleString("en-IN")}</p>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button type="button" onClick={callClient} className="pt-action flex flex-col items-center gap-0.5 rounded-xl border border-cyan-300/35 bg-cyan-500/10 py-2 text-[10px] font-semibold text-cyan-200">
                    <span className="text-base">📞</span>Call
                  </button>
                  <button type="button" onClick={() => openWhatsApp()} className="pt-action flex flex-col items-center gap-0.5 rounded-xl border border-emerald-300/35 bg-emerald-500/10 py-2 text-[10px] font-semibold text-emerald-200">
                    <span className="text-base">💬</span>WhatsApp
                  </button>
                  <button type="button" onClick={sendReminder} className="pt-action flex flex-col items-center gap-0.5 rounded-xl border border-amber-300/35 bg-amber-500/10 py-2 text-[10px] font-semibold text-amber-200">
                    <span className="text-base">🔔</span>Reminder
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {onReceivePayment && (
                    <button
                      type="button"
                      onClick={() => onReceivePayment(client)}
                      className="pt-action rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-2.5 text-sm font-semibold text-white"
                    >
                      💰 Receive
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onEdit(client)}
                    className="pt-action rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-2.5 text-sm font-semibold text-black"
                  >
                    ✏️ Edit
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setTab("history")}
                  className="pt-action mt-3 w-full rounded-xl border border-cyan-300/40 bg-cyan-500/10 py-2.5 text-sm font-semibold text-cyan-200"
                >
                  📜 Payment History
                </button>

                {onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete ${client.name}? This action cannot be undone.`)) {
                        onDelete(client);
                        handleClose();
                      }
                    }}
                    className="mt-3 w-full rounded-xl border border-rose-500/30 bg-rose-500/10 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                  >
                    🗑️ Delete Client
                  </button>
                )}

                {/* Bottom close button */}
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-4 w-full rounded-xl border border-white/10 bg-zinc-900/70 py-2.5 text-sm font-semibold text-zinc-200 hover:border-amber-300/40 hover:text-amber-200"
                >
                  Close
                </button>
              </div>
            </div>

            {/* ================= BACK (Payment History) ================= */}
            <div className="pt-face pt-face-back" style={faceBackStyle}>
              <div className="pt-sticky-header">
                <button
                  type="button"
                  onClick={() => setFlipped(false)}
                  className="pt-icon-btn rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-300/50 hover:text-amber-200"
                  aria-label="Back to details"
                >
                  ← Back
                </button>
                <p className="text-sm font-semibold text-white">
                  Payment History
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="pt-icon-btn h-9 w-9 rounded-full border border-white/10 bg-black/40 text-zinc-300 hover:border-rose-400/50 hover:text-rose-300"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {tab === "history" && (
                <div className="pt-scroll">
                  {clientHistory.length === 0 && (
                    <div className="rounded-xl border border-white/10 bg-black/30 p-6 text-center text-sm text-zinc-400">
                      No payments recorded yet.
                    </div>
                  )}
                  {clientHistory.map((entry, idx) => {
                    const d = new Date(`${entry.paidDate}T00:00:00`);
                    d.setDate(d.getDate() + 30);
                    const nextDueIso = toIsoDate(d);
                    return (
                      <div
                        key={entry.id}
                        className="mb-2 rounded-xl border border-emerald-500/20 bg-black/35 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-emerald-200">{formatDate(entry.paidDate)}</p>
                          <p className="text-base font-bold text-emerald-300">Rs {entry.amount.toLocaleString("en-IN")}</p>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
                          <span className="rounded-full border border-white/10 bg-zinc-900/60 px-2 py-0.5 text-zinc-300">
                            Next due: {formatDate(nextDueIso)}
                          </span>
                          <span className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-0.5 text-cyan-200">
                            Method: Cash
                          </span>
                          {idx === 0 && (
                            <span className="rounded-full border border-amber-300/40 bg-amber-500/10 px-2 py-0.5 text-amber-200">
                              Latest
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {clientHistory.length > 0 && (
                    <p className="pt-1 text-center text-[10px] text-zinc-500">End of history</p>
                  )}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="mt-4 w-full rounded-xl border border-white/10 bg-zinc-900/70 py-2.5 text-sm font-semibold text-zinc-200 hover:border-amber-300/40 hover:text-amber-200"
                  >
                    Close
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>

      <style>{`
        /* ============== PORTAL MODAL CORE ============== */
        .pt-root {
          position: fixed;
          inset: 0;
          z-index: 9998;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px;
          background-color: rgba(0, 0, 0, 0);
          overflow: hidden;
          -webkit-tap-highlight-color: transparent;
          /* Default (desktop) state: dark overlay only. JS adds the
             pt-backdrop-in class to play the entry animation, or
             pt-backdrop-instant for reduced-motion. */
        }
        @media (min-width: 640px) {
          .pt-root { padding: 24px; }
        }

        .pt-frame {
          position: relative;
          z-index: 9999;
          width: min(95vw, 500px);
          max-height: 90vh;
          display: flex;
          flex-direction: column;
        }

        /* Real min-height so absolutely-positioned faces have a container. */
        .pt-card {
          position: relative;
          width: 100%;
          min-height: 520px;
          flex: 1 1 auto;
          transform-style: preserve-3d;
          /* GPU acceleration hints */
          will-change: transform, opacity;
          transform: translateZ(0);
          opacity: 1;
        }
        @media (max-height: 700px) {
          .pt-card { min-height: 0; }
        }
        @media (max-width: 480px) {
          .pt-card { min-height: 480px; }
        }

         .pt-face {
           position: absolute;
           inset: 0;
           display: flex;
           flex-direction: column;
           width: 100%;
           max-height: 90vh;
           border-radius: 1.5rem;
           overflow: hidden;
           /* The 3D flip is handled by the inline rotateY transform; we
              don't need an extra translateZ(0) layer which can interfere
              with hit-testing on mobile. */
           will-change: transform, opacity;
           backface-visibility: hidden;
           -webkit-backface-visibility: hidden;
           transition: opacity 200ms ease, visibility 200ms ease;
           /* The front face must be on top of the back face so its
              buttons always receive clicks. Inline z-index handles the
              actual ordering, but we set safe defaults here. */
         }
         .pt-face-front { z-index: 2; }
         /* The back face never receives clicks by default. The inline
            style toggles pointer-events when the user flips to it. */
         .pt-face-back { z-index: 1; pointer-events: none; }
        .pt-face-front {
          background: linear-gradient(135deg, rgba(24,24,27,0.97), rgba(9,9,11,0.97) 50%, rgba(8,47,73,0.45));
          border: 1px solid rgba(252, 211, 77, 0.3);
          box-shadow: 0 30px 90px -25px rgba(251, 191, 36, 0.55);
        }
        .pt-face-back {
          background: linear-gradient(135deg, rgba(24,24,27,0.97), rgba(8,47,73,0.35) 50%, rgba(9,9,11,0.97));
          border: 1px solid rgba(103, 232, 249, 0.3);
          box-shadow: 0 30px 90px -25px rgba(34, 211, 238, 0.55);
        }

        .pt-sticky-header {
          position: sticky;
          top: 0;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(9, 9, 11, 0.88);
          padding: 12px 16px;
        }

        .pt-scroll {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 16px;
          scrollbar-width: thin;
          -webkit-overflow-scrolling: touch;
        }

        /* ============== SINGLE ENTRY ANIMATION (300ms) ==============
           Card opens with: opacity 0->1, scale 0.95->1, rotateY 15deg->0deg
           Backdrop fades in concurrently via a separate class on .pt-root.
           Both run for 300ms with ease-out and forwards fill mode. */

        @keyframes ptCardIn {
          0% {
            opacity: 0;
            transform: scale(0.95) rotateY(15deg) translateZ(0);
          }
          100% {
            opacity: 1;
            transform: scale(1) rotateY(0deg) translateZ(0);
          }
        }
        @keyframes ptBackdropIn {
          0% { background-color: rgba(0, 0, 0, 0); }
          100% { background-color: rgba(0, 0, 0, 0.78); }
        }
        @keyframes ptCardOut {
          0% {
            opacity: 1;
            transform: scale(1) rotateY(0deg) translateZ(0);
          }
          100% {
            opacity: 0;
            transform: scale(0.95) rotateY(0deg) translateZ(0);
          }
        }
        @keyframes ptBackdropOut {
          0% { background-color: rgba(0, 0, 0, 0.78); }
          100% { background-color: rgba(0, 0, 0, 0); }
        }

        .pt-card-in {
          animation: ptCardIn 300ms ease-out forwards;
          /* GPU layer */
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .pt-backdrop-in {
          animation: ptBackdropIn 300ms ease-out forwards;
        }
        .pt-card-out {
          animation: ptCardOut 200ms ease-in forwards;
        }
        .pt-backdrop-out {
          animation: ptBackdropOut 200ms ease-in forwards;
        }

        /* Reduced-motion + low-power fallbacks: open instantly, no animation,
           and on low-power devices use a flat dark overlay instead of blur. */
        .pt-card-instant {
          opacity: 1;
          transform: scale(1) rotateY(0deg) translateZ(0);
        }
        .pt-backdrop-instant {
          background-color: rgba(0, 0, 0, 0.82);
        }

        /* Only enable the heavy blur on capable devices. The root has a
           default dark overlay, and the .pt-has-blur class adds the blur. */
        .pt-root.pt-has-blur {
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        @media (min-width: 768px) {
          /* Laptops/desktops: allow up to 10px. */
          .pt-root.pt-has-blur {
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
          }
        }

        /* ============== REDUCED-MOTION ============== */
        @media (prefers-reduced-motion: reduce) {
          .pt-card-in, .pt-card-out { animation: none; }
          .pt-backdrop-in, .pt-backdrop-out { animation: none; }
        }

        /* Buttons */
        .pt-action {
          transition: transform 200ms ease, box-shadow 200ms ease, filter 200ms ease;
        }
        .pt-action:hover {
          transform: translateY(-1px);
          filter: brightness(1.1);
          box-shadow: 0 8px 24px -12px rgba(0, 0, 0, 0.6);
        }
        .pt-action:active { transform: translateY(0); }

        .pt-icon-btn {
          transition: transform 200ms ease, background-color 200ms ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .pt-icon-btn:hover { transform: scale(1.05); }
      `}</style>
      <BlurEnabler lowPower={lowPower} />
    </Portal>
  );
}

// Adds the pt-has-blur class to the .pt-root element only when the device
// is capable. Runs once on mount so the animation is never re-triggered.
function BlurEnabler({ lowPower }: { lowPower: boolean }) {
  useEffect(() => {
    if (lowPower) return;
    const root = document.getElementById("pt-root-el");
    if (root) root.classList.add("pt-has-blur");
  }, [lowPower]);
  return null;
}
