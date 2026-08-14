import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../hooks/useScreener";

interface Props {
  logs: LogEntry[];
}

export function LogPanel({ logs }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(logs.length);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnread(0);
    setAtBottom(true);
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 30;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setAtBottom(nearBottom);
    if (nearBottom) setUnread(0);
  };

  useEffect(() => {
    const added = logs.length - prevCountRef.current;
    prevCountRef.current = logs.length;
    if (added <= 0) return;

    if (atBottom && expanded) {
      // gentle instant scroll to keep up while at bottom
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    } else {
      setUnread((u) => u + added);
    }
  }, [logs.length, atBottom, expanded]);

  if (logs.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-300 hover:bg-gray-800"
      >
        <span>
          Logs ({logs.length})
          {unread > 0 && !expanded && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
              {unread} new
            </span>
          )}
        </span>
        <span>{expanded ? "\u25BC" : "\u25B6"}</span>
      </button>
      {!expanded && logs.length > 0 && (
        <div className="px-4 pb-2 font-mono text-[11px] leading-relaxed truncate text-gray-400">
          {logs[logs.length - 1].message}
        </div>
      )}
      {expanded && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-64 overflow-y-auto px-4 pb-3 font-mono text-[11px] leading-relaxed"
        >
          {logs.map((log, i) => (
            <div
              key={i}
              className={`${
                log.level === "error" ? "text-red-400" :
                log.level === "warning" ? "text-yellow-400" :
                "text-gray-400"
              }`}
            >
              <span className="text-cyan-500 mr-2">[{log.sessionId}]</span>
              {log.message}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {expanded && unread > 0 && !atBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 right-4 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-full shadow-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 animate-bounce"
        >
          {unread} new log{unread > 1 ? "s" : ""} \u2193
        </button>
      )}
    </div>
  );
}
