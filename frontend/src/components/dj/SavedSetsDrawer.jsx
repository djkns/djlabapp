import { useEffect, useState } from "react";
import { X, Disc } from "lucide-react";

export default function SavedSetsDrawer({ open, onClose }) {
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/mixes`)
      .then((r) => r.json())
      .then((d) => setSets(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="saved-sets-drawer">
      <div className="bg-[#141414] border border-white/10 rounded-lg w-full max-w-2xl p-6 relative shadow-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <button onClick={onClose} className="absolute top-3 right-3 text-[#52525B] hover:text-white">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 mb-1 text-[#FF1F1F]">
          <Disc className="w-4 h-4" />
          <span className="label-tiny" style={{ color: "#FF1F1F" }}>Vault</span>
        </div>
        <h2 className="font-display font-black text-2xl tracking-tight mb-4">My Sets</h2>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="text-sm text-[#52525B]">Loading…</div>}
          {!loading && sets.length === 0 && (
            <div className="text-sm text-[#52525B] p-6 text-center border border-dashed border-white/10 rounded">
              No saved sets yet. Hit <span className="text-white">Record</span>, mix a set, then <span className="text-white">Save</span>.
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {sets.map((s) => (
              <li key={s.id} className="border border-white/10 rounded px-4 py-3 flex items-center justify-between hover:border-[#FF1F1F]/50 transition" data-testid={`saved-set-${s.id}`}>
                <div className="min-w-0">
                  <div className="font-display font-bold text-white truncate">{s.name}</div>
                  <div className="text-xs text-[#A1A1AA] truncate">
                    {s.notes || "No notes"}
                  </div>
                </div>
                <div className="text-right text-[10px] tracking-[0.2em] uppercase text-[#52525B] ml-4 shrink-0">
                  <div className="font-mono-dj text-[#FF1F1F]">
                    {Math.floor((s.duration_seconds || 0) / 60)}:{String(Math.floor((s.duration_seconds || 0) % 60)).padStart(2, "0")}
                  </div>
                  <div>{new Date(s.created_at).toLocaleString()}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
