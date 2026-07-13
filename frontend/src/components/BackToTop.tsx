import { useEffect, useState } from "react";
import type { Heartbeat } from "../hooks/useScreener";

interface Props {
  heartbeat?: Heartbeat | null;
  totalSubscribed?: number;
}

export function BackToTop({ heartbeat, totalSubscribed = 0 }: Props) {
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll);
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!visible) return null;

  const timeStr = heartbeat
    ? new Date(heartbeat.epochMs).toLocaleTimeString("en-US", { hour12: false })
    : null;
  const ageMs = heartbeat ? now - heartbeat.receivedAt : Infinity;
  const isStale = ageMs > 3000;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed bottom-6 right-6 shadow-lg transition-colors flex items-center gap-2 z-50 rounded-full pl-3 pr-4 py-2 text-white ${
        isStale ? "bg-gray-600 hover:bg-gray-700" : "bg-blue-600 hover:bg-blue-700"
      }`}
      title={heartbeat ? `Connected · server ${heartbeat.serverTime}` : "Back to top"}
      aria-label="Back to top"
    >
      <span className="text-lg leading-none">&uarr;</span>
      {timeStr && (
        <span className="flex items-center gap-1.5 text-xs font-mono">
          <span className={`w-1.5 h-1.5 rounded-full ${isStale ? "bg-red-400" : "bg-green-400 animate-pulse"}`} />
          {timeStr}
        </span>
      )}
      {totalSubscribed > 0 && (
        <span className="text-xs font-medium bg-white/25 rounded-full px-2 py-0.5">
          {totalSubscribed} sub{totalSubscribed === 1 ? "" : "s"}
        </span>
      )}
    </button>
  );
}
