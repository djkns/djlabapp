import { useEffect, useState } from "react";
import { Headphones, Power } from "lucide-react";
import { useDJStore } from "@/store/djStore";
import {
  enableHeadphones,
  setHeadphoneMix,
  setHeadphoneVolume,
  setHeadphoneSinkId,
} from "@/lib/audioEngine";

export default function HeadphoneSection() {
  const hp = useDJStore((s) => s.hp);
  const setHp = useDJStore((s) => s.setHp);
  const [devices, setDevices] = useState([]);
  const [needsPerm, setNeedsPerm] = useState(false);

  // Enumerate output devices (requires user gesture + permission on some browsers)
  const refreshDevices = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const outs = list.filter((d) => d.kind === "audiooutput");
      if (outs.length === 0 || !outs[0].label) setNeedsPerm(true);
      setDevices(outs);
    } catch {
      setNeedsPerm(true);
    }
  };

  useEffect(() => { refreshDevices(); }, []);

  useEffect(() => { setHeadphoneMix(hp.mix); }, [hp.mix]);
  useEffect(() => { setHeadphoneVolume(hp.volume); }, [hp.volume]);
  useEffect(() => { enableHeadphones(hp.enabled); }, [hp.enabled]);
  useEffect(() => {
    if (hp.sinkId) setHeadphoneSinkId(hp.sinkId);
  }, [hp.sinkId, hp.enabled]);

  const grantPerm = async () => {
    try {
      // Request mic permission just to unlock device labels (common pattern)
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      await refreshDevices();
      setNeedsPerm(false);
    } catch { /* ignore */ }
  };

  return (
    <div className="w-full flex flex-col gap-2 pt-3 mt-2 border-t border-white/10" data-testid="headphone-section">
      <div className="flex items-center justify-between">
        <span className="label-tiny flex items-center gap-1.5">
          <Headphones className="w-3 h-3" /> Headphones
        </span>
        <button
          data-testid="hp-toggle"
          onClick={() => setHp({ enabled: !hp.enabled })}
          className={`w-6 h-6 rounded-full flex items-center justify-center border transition-all ${
            hp.enabled
              ? "bg-[#D10A0A] border-[#FF1F1F] text-white shadow-[0_0_10px_#FF1F1F]"
              : "border-white/20 text-[#A1A1AA] hover:border-white/50"
          }`}
          title={hp.enabled ? "Disable headphones" : "Enable headphones"}
        >
          <Power className="w-3 h-3" />
        </button>
      </div>

      {/* Mix knob: 0=master only, 1=cue only */}
      <div className="flex flex-col items-center gap-1">
        <span className="label-tiny">HP · Cue / Master</span>
        <input
          type="range" min={0} max={1} step={0.01}
          value={hp.mix}
          onChange={(e) => setHp({ mix: +e.target.value })}
          data-testid="hp-mix"
          className="w-full accent-[#D10A0A]"
        />
        <div className="flex justify-between w-full text-[9px] tracking-[0.2em] uppercase text-[#52525B]">
          <span>Master</span><span>Cue</span>
        </div>
      </div>

      {/* HP volume */}
      <div className="flex flex-col items-center gap-1">
        <span className="label-tiny">HP Volume</span>
        <input
          type="range" min={0} max={1.2} step={0.01}
          value={hp.volume}
          onChange={(e) => setHp({ volume: +e.target.value })}
          data-testid="hp-volume"
          className="w-full accent-[#D10A0A]"
        />
      </div>

      {/* Output device */}
      <div className="flex flex-col gap-1">
        <span className="label-tiny">HP Output Device</span>
        {needsPerm ? (
          <button onClick={grantPerm} className="text-[10px] tracking-[0.2em] uppercase text-[#FF1F1F] hover:text-white text-left" data-testid="hp-grant-perm">
            · Grant permission to list devices
          </button>
        ) : (
          <select
            value={hp.sinkId}
            onChange={(e) => setHp({ sinkId: e.target.value })}
            data-testid="hp-device"
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-[10px] font-mono-dj text-white focus:outline-none focus:border-[#D10A0A]"
          >
            <option value="default">System default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Device ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
