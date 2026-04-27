import { useEffect, useState } from "react";
import { useDJStore } from "@/store/djStore";

/**
 * Mic input device picker. Lists `audioinput` devices from
 * `enumerateDevices()`. Important Firefox quirk: device labels stay empty
 * until permission has been granted at least once via getUserMedia. We
 * surface a "Grant" link in that case rather than showing meaningless
 * device IDs.
 */
export default function MicDevicePicker() {
  const mic = useDJStore((s) => s.mic);
  const setMic = useDJStore((s) => s.setMic);
  const [devices, setDevices] = useState([]);
  const [needsPerm, setNeedsPerm] = useState(false);

  const refresh = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const ins = list.filter((d) => d.kind === "audioinput");
      // If Firefox returned zero devices OR labels are empty, we need
      // permission first to show meaningful entries.
      if (ins.length === 0 || !ins[0].label) {
        setNeedsPerm(true);
      } else {
        setNeedsPerm(false);
      }
      setDevices(ins);
    } catch {
      setNeedsPerm(true);
    }
  };

  // Fetch on mount and whenever device list changes (controller plug/unplug).
  useEffect(() => {
    refresh();
    const handler = () => refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
  }, []);

  // Re-enumerate after the user successfully enables the mic — that's
  // when Firefox will finally hand us non-empty device labels.
  useEffect(() => {
    if (mic.enabled) refresh();
  }, [mic.enabled]);

  const grant = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch { /* ignore */ }
  };

  return (
    <div className="flex flex-col items-center gap-0.5 w-full" data-testid="mic-source-picker">
      <span className="label-tiny text-[#A1A1AA]">SOURCE</span>
      {needsPerm ? (
        <button
          onClick={grant}
          data-testid="mic-grant"
          className="text-[9px] tracking-[0.2em] uppercase text-[#FF9500] hover:text-white"
        >
          · Grant to list
        </button>
      ) : (
        <select
          value={mic.deviceId}
          onChange={(e) => setMic({ deviceId: e.target.value })}
          data-testid="mic-device"
          className="bg-black/60 border border-white/10 rounded px-1 py-0.5 text-[9px] font-mono-dj text-white focus:outline-none focus:border-[#FF9500] max-w-[88px] truncate"
          title={devices.find((d) => d.deviceId === mic.deviceId)?.label || "Default"}
        >
          <option value="default">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {(d.label || `Mic ${d.deviceId.slice(0, 6)}`).slice(0, 22)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
