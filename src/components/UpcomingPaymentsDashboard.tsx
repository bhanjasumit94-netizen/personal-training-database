import { useMemo, useState } from "react";
import { Client, PaymentHistory } from "../db";
import { getDaysUntilDue } from "../App.helpers";
import ClientCard from "./ClientCard";
import ClientDetailsPopup from "./ClientDetailsPopup";
import NotificationCenter from "./NotificationCenter";
import SearchPanel from "./SearchPanel";

type Props = {
  adminId: string;
  clients: Client[];
  history: PaymentHistory[];
  onEditClient: (client: Client) => void;
  onDeleteClient?: (client: Client) => void;
  onReceivePayment?: (client: Client) => void;
  unreadCount: number;
};

// Sort priority:
//  1. Overdue (most negative days first)
//  2. Due Today
//  3. Upcoming (nearest first)
const statusRank = (days: number): number => {
  if (Number.isNaN(days)) return 9999;
  if (days < 0) return -1000 + days;
  if (days === 0) return 0;
  return 1000 + days;
};

const sortByUrgency = (a: Client, b: Client) => {
  const da = getDaysUntilDue(a.dueDate);
  const db = getDaysUntilDue(b.dueDate);
  const ra = statusRank(da);
  const rb = statusRank(db);
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name);
};

export default function UpcomingPaymentsDashboard({
  adminId,
  clients,
  history,
  onEditClient,
  onDeleteClient,
  onReceivePayment,
  unreadCount,
}: Props) {
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const sortedClients = useMemo(() => [...clients].sort(sortByUrgency), [clients]);

  const handleCardClick = (c: Client) => setSelectedClient(c);

  return (
    <section className="dashboard-shell mb-4 rounded-3xl border border-cyan-300/25 bg-[linear-gradient(150deg,rgba(34,211,238,0.10),rgba(9,9,11,0.7)_55%,rgba(251,191,36,0.08))] p-4 shadow-[0_30px_70px_-35px_rgba(34,211,238,0.55)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">Client Activity</p>
          <h2 className="mt-0.5 text-lg font-bold text-white">Upcoming Payments</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSearch(true)}
            className="group relative h-10 w-10 rounded-full border border-white/15 bg-black/40 text-lg text-zinc-200 transition hover:border-amber-300/50 hover:text-amber-200"
            aria-label="Search clients"
            title="Search clients"
          >
            <span className="absolute inset-0 flex items-center justify-center">🔍</span>
            <span className="pointer-events-none absolute -inset-1 rounded-full bg-amber-500/0 blur-md transition group-hover:bg-amber-500/20" />
          </button>
          <NotificationCenter adminId={adminId} unreadCount={unreadCount} />
        </div>
      </div>

      <div className="mt-3 max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
        {sortedClients.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-center">
            <p className="text-sm text-zinc-300">No clients yet</p>
            <p className="mt-1 text-[11px] text-zinc-500">Add your first client to see upcoming payments here.</p>
          </div>
        )}
        {sortedClients.map((client) => (
          <ClientCard key={client.id} client={client} onClick={handleCardClick} />
        ))}
      </div>

      {selectedClient && (
        <ClientDetailsPopup
          client={selectedClient}
          history={history}
          onClose={() => setSelectedClient(null)}
          onEdit={(c) => {
            setSelectedClient(null);
            onEditClient(c);
          }}
          onReceivePayment={(c) => {
            // Close the popup first so it unmounts (its `client` prop is
            // held in dashboard state and would otherwise stay stale).
            // The parent state update happens synchronously via the
            // `onReceivePayment` callback below.
            setSelectedClient(null);
            if (onReceivePayment) onReceivePayment(c);
          }}
          onDelete={onDeleteClient}
        />
      )}

      {showSearch && (
        <SearchPanel
          clients={clients}
          history={history}
          onClose={() => setShowSearch(false)}
          onSelectClient={(c: Client) => {
            setShowSearch(false);
            setSelectedClient(c);
          }}
          onEditClient={(c: Client) => {
            setShowSearch(false);
            onEditClient(c);
          }}
        />
      )}
    </section>
  );
}
