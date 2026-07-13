import { useEffect, useState } from "react";
import type { Heartbeat } from "../hooks/useScreener";

interface Props {
  heartbeat: Heartbeat | null;
}

export function HeartbeatIndicator({ heartbeat }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!heartbeat) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <span className="w-2 h-2 rounded-full bg-gray-400" />
        <span>connecting…</span>
      </div>
    );
  }

  const ageMs = now - heartbeat.receivedAt;
  const isStale = ageMs > 3000;

  const serverTime = new Date(heartbeat.epochMs);
  const timeStr = serverTime.toLocaleTimeString("en-US", { hour12: false });

  return (
    <div
      className="flex items-center gap-3 text-xs"
      title={`Server: ${heartbeat.serverTime}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${isStale ? "bg-red-500" : "bg-green-500 animate-pulse"}`} />
        <span className={`font-mono ${isStale ? "text-red-600" : "text-gray-700"}`}>
          {timeStr}
        </span>
      </div>
      <span className="text-gray-500">
        {heartbeat.listeners} listener{heartbeat.listeners === 1 ? "" : "s"}
        {" · "}
        {heartbeat.subscribedUnderlyings} underlying{heartbeat.subscribedUnderlyings === 1 ? "" : "s"}
        {" · "}
        {heartbeat.totalContracts} contract{heartbeat.totalContracts === 1 ? "" : "s"}
      </span>
    </div>
  );
}
