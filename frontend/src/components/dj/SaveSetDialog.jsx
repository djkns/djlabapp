import { useEffect, useState } from "react";
import { X, Save } from "lucide-react";
import { toast } from "sonner";

export default function SaveSetDialog({ open, onClose, defaultDuration = 0, defaultTracks = [] }) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(`Set · ${new Date().toLocaleString()}`);
      setNotes("");
    }
  }, [open]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/mixes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          duration_seconds: defaultDuration,
          notes: notes.trim(),
          tracks_used: defaultTracks,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Set saved to vault");
      onClose();
    } catch (e) {
      toast.error("Couldn't save set", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="save-set-dialog">
      <div className="bg-[#141414] border border-white/10 rounded-lg w-full max-w-md p-6 relative shadow-2xl">
        <button onClick={onClose} className="absolute top-3 right-3 text-[#52525B] hover:text-white" data-testid="save-set-close">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 mb-1 text-[#FF1F1F]">
          <Save className="w-4 h-4" />
          <span className="label-tiny" style={{ color: "#FF1F1F" }}>Save Set</span>
        </div>
        <h2 className="font-display font-black text-2xl tracking-tight mb-4">Store your mix</h2>

        <label className="label-tiny block mb-1">Set name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="save-set-name"
          className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D10A0A] mb-3"
        />

        <label className="label-tiny block mb-1">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          data-testid="save-set-notes"
          className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D10A0A] mb-3 resize-none"
        />

        <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-[#52525B] mb-4">
          <span>Duration</span>
          <span className="font-mono-dj text-[#A1A1AA]">
            {Math.floor(defaultDuration / 60)}:{String(Math.floor(defaultDuration % 60)).padStart(2, "0")}
          </span>
          <span className="mx-2">·</span>
          <span>{defaultTracks.length} tracks</span>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded border border-white/15 text-xs font-bold uppercase tracking-[0.2em] text-[#A1A1AA] hover:text-white hover:border-white/30"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            data-testid="save-set-confirm"
            className="px-5 py-2 rounded border border-[#D10A0A] bg-[#D10A0A] text-white text-xs font-bold uppercase tracking-[0.2em] hover:bg-[#FF1F1F] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
