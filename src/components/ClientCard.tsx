import { useRef } from "react";
import { Client } from "../db";
import { getDaysUntilDue, type ClientStatus } from "../App.helpers";

type Props = {
  client: Client;
  onClick: (client: Client) => void;
};

const getStatus = (dueDate: string): ClientStatus => {
  const days = getDaysUntilDue(dueDate);
  if (Number.isNaN(days)) return "unknown";
  if (days < 0) return "overdue";
  if (days === 0) return "due";
  return "upcoming";
};

const daysLabel = (status: ClientStatus, days: number): string => {
  if (status === "due") return "Due Today";
  if (status === "overdue") return `${Math.abs(days)} ${Math.abs(days) === 1 ? "Day" : "Days"} Overdue`;
  if (status === "upcoming") return `${days} ${days === 1 ? "Day" : "Days"} Remaining`;
  return "—";
};

// Status colors:
// 🟦 Upcoming  = blue   (sky)
// 🟨 Due Today = yellow (amber)
// 🟥 Overdue   = red    (rose)
// Glow intensity is half-strength for a calmer mobile look.
const glowPalette = (status: ClientStatus) => {
  switch (status) {
    case "overdue":
      return {
        text: "text-rose-300",
        textShadow: "0 0 6px rgba(244,63,94,0.30), 0 0 12px rgba(244,63,94,0.15)",
        border: "rgba(244,63,94,0.35)",
        halo: "rgba(244,63,94,0.18)",
        avatarBorder: "rgba(244,63,94,0.45)",
        avatarShadow: "0 0 9px rgba(244,63,94,0.30)",
        cardShadow: "0 0 11px -3px rgba(244,63,94,0.25), 0 9px 20px -11px rgba(244,63,94,0.30)",
      };
    case "due":
      return {
        text: "text-amber-200",
        textShadow: "0 0 6px rgba(251,191,36,0.35), 0 0 12px rgba(251,191,36,0.15)",
        border: "rgba(251,191,36,0.35)",
        halo: "rgba(251,191,36,0.18)",
        avatarBorder: "rgba(251,191,36,0.45)",
        avatarShadow: "0 0 9px rgba(251,191,36,0.30)",
        cardShadow: "0 0 11px -3px rgba(251,191,36,0.25), 0 9px 20px -11px rgba(251,191,36,0.30)",
      };
    case "upcoming":
      return {
        text: "text-sky-300",
        textShadow: "0 0 6px rgba(56,189,248,0.30), 0 0 12px rgba(56,189,248,0.15)",
        border: "rgba(56,189,248,0.35)",
        halo: "rgba(56,189,248,0.18)",
        avatarBorder: "rgba(56,189,248,0.45)",
        avatarShadow: "0 0 9px rgba(56,189,248,0.30)",
        cardShadow: "0 0 11px -3px rgba(56,189,248,0.25), 0 9px 20px -11px rgba(56,189,248,0.30)",
      };
    default:
      return {
        text: "text-zinc-300",
        textShadow: "none",
        border: "rgba(255,255,255,0.10)",
        halo: "rgba(255,255,255,0.05)",
        avatarBorder: "rgba(255,255,255,0.20)",
        avatarShadow: "none",
        cardShadow: "0 9px 20px -11px rgba(0,0,0,0.6)",
      };
  }
};

export default function ClientCard({ client, onClick }: Props) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const status = getStatus(client.dueDate);
  const days = getDaysUntilDue(client.dueDate);
  const palette = glowPalette(status);

  // Ripple effect — spawns a colored circle at the click position.
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ripple = document.createElement("span");
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    ripple.className = "client-card-ripple";
    el.appendChild(ripple);
    setTimeout(() => {
      ripple.remove();
    }, 600);
  };

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={() => onClick(client)}
      onPointerDown={handlePointerDown}
      aria-label={`Open details for ${client.name}, ${daysLabel(status, days)}`}
      className="client-card group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border bg-black/35 px-3 py-2 text-left outline-none transition-transform duration-150 ease-out active:scale-[0.98] hover:bg-black/50 focus-visible:ring-2 focus-visible:ring-amber-300/70 sm:gap-4 sm:px-4"
      style={{
        height: "100px", // 90-110px target band
        borderColor: palette.border,
        boxShadow: palette.cardShadow,
      }}
    >
      {/* Soft pulsing halo behind the card — breathes every 2s */}
      <span
        aria-hidden
        className="client-card-halo pointer-events-none absolute -inset-2 rounded-2xl opacity-50 blur-xl"
        style={{ background: `radial-gradient(60% 60% at 25% 50%, ${palette.halo}, transparent 70%)` }}
      />

      {/* LEFT: 55x55 circular avatar with soft glowing border */}
      <div
        className="relative h-[55px] w-[55px] shrink-0 overflow-hidden rounded-full"
        style={{
          border: `1.5px solid ${palette.avatarBorder}`,
          boxShadow: palette.avatarShadow,
        }}
      >
        {client.photo ? (
          <img
            src={client.photo}
            alt={client.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-950 text-base font-black text-amber-300">
            {client.name.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>

      {/* RIGHT: Name + days remaining stacked */}
      <div className="relative min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold leading-tight text-white sm:text-base">
          {client.name}
        </p>
        <p
          className={`client-card-glow mt-0.5 truncate text-xs font-bold leading-tight sm:text-sm ${palette.text}`}
          style={{ textShadow: palette.textShadow }}
        >
          {daysLabel(status, days)}
        </p>
      </div>

      <style>{`
        .client-card {
          -webkit-tap-highlight-color: transparent;
          animation: clientCardBreath 2s ease-in-out infinite;
        }
        @keyframes clientCardBreath {
          0%, 100% {
            filter: brightness(1) saturate(1);
            transform: translateZ(0) scale(1);
          }
          50% {
            filter: brightness(1.04) saturate(1.08);
            transform: translateZ(0) scale(1.003);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .client-card { animation: none; }
          .client-card-halo { animation: none; opacity: 0.30; }
        }

        .client-card-halo {
          animation: clientCardHalo 2s ease-in-out infinite;
        }
        @keyframes clientCardHalo {
          0%, 100% { opacity: 0.30; transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(1.02); }
        }

        .client-card-glow {
          animation: clientCardGlow 2s ease-in-out infinite;
          will-change: filter, opacity;
        }
        @keyframes clientCardGlow {
          0%, 100% { filter: drop-shadow(0 0 2px currentColor); opacity: 0.95; }
          50%      { filter: drop-shadow(0 0 5px currentColor); opacity: 1; }
        }

        .client-card-ripple {
          position: absolute;
          border-radius: 9999px;
          background: currentColor;
          opacity: 0.18;
          transform: scale(0);
          animation: clientCardRipple 600ms ease-out forwards;
          pointer-events: none;
          color: rgb(251, 191, 36);
          will-change: transform, opacity;
        }
        @keyframes clientCardRipple {
          0%   { transform: scale(0);   opacity: 0.30; }
          100% { transform: scale(2.5); opacity: 0;    }
        }
      `}</style>
    </button>
  );
}
