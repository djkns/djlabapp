import { useEffect, useState } from "react";
import { Headphones } from "lucide-react";
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

  // Sync HP state → audio engine
  useEffect(() => { setHeadphoneMix(hp.mix); }, [hp.mix]);
  useEffect(() => { setHeadphoneVolume(hp.volume); }, [hp.volume]);
  useEffect(() => { enableHeadphones(hp.enabled); }, [hp.enabled]);
  useEffect(() => {
    if (hp.sinkId) setHeadphoneSinkId(hp.sinkId);
  }, [hp.sinkId, hp.enabled]);

  const grantPerm = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      await refreshDevices();
      setNeedsPerm(false);
    } catch { /* ignore */ }
  };

  return (
    <div className="w-full flex flex-col gap-1 pt-2 mt-1 border-t border-white/10" data-testid="headphone-section">
      <span className="label-tiny flex items-center gap-1.5">
        <Headphones className="w-3 h-3" /> HP Output Device
      </span>
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
  );
}
