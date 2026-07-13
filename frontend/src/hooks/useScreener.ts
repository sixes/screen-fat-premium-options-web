import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenParams, ScreenResult, SymbolProgress, WsMessage } from "../types";

export type SessionState = "connecting" | "screening" | "done" | "error";

export interface LogEntry {
  message: string;
  level: string;
  timestamp: number;
  sessionId: string;
}

export interface Session {
  id: string;
  symbols: string[];
  state: SessionState;
  elapsed: number;
  progress: Map<string, SymbolProgress>;
  subscribedCount: number;
  restored?: boolean;
  error?: string;
}

export interface Heartbeat {
  serverTime: string;
  epochMs: number;
  receivedAt: number;
  subscribedUnderlyings: number;
  totalContracts: number;
  listeners: number;
}

let nextSessionId = 1;

export function useScreener() {
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [resultsMap, setResultsMap] = useState<Map<string, ScreenResult>>(new Map());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const wsMapRef = useRef<Map<string, WebSocket>>(new Map());
  const activeUnderlyingsRef = useRef<Set<string>>(new Set());
  const listenerRef = useRef<WebSocket | null>(null);

  const results = Array.from(resultsMap.values());

  const totalSubscribed = Array.from(sessions.values()).reduce(
    (sum, s) => sum + s.subscribedCount,
    0,
  );

  const updateSession = (id: string, updater: (s: Session) => Session) => {
    setSessions((prev) => {
      const next = new Map(prev);
      const existing = next.get(id);
      if (existing) next.set(id, updater(existing));
      return next;
    });
  };

  const removeSymbolsFromActive = (symbols: string[]) => {
    for (const s of symbols) activeUnderlyingsRef.current.delete(s);
  };

  const upsertRestoredSession = useCallback((underlying: string, contractResults: ScreenResult[]) => {
    activeUnderlyingsRef.current.add(underlying);
    setSessions((prev) => {
      // Find existing session for this underlying (screening or restored)
      for (const s of prev.values()) {
        if (s.symbols.length === 1 && s.symbols[0] === underlying) return prev;
      }
      const next = new Map(prev);
      const id = `R${nextSessionId++}`;
      const progress = new Map<string, SymbolProgress>();
      progress.set(underlying, {
        symbol: underlying,
        status: "done",
        results: contractResults,
      });
      next.set(id, {
        id,
        symbols: [underlying],
        state: "done",
        elapsed: 0,
        progress,
        subscribedCount: contractResults.length,
        restored: true,
      });
      return next;
    });
  }, []);

  const removeUnderlying = useCallback((underlying: string) => {
    activeUnderlyingsRef.current.delete(underlying);
    setResultsMap((prev) => {
      const next = new Map(prev);
      for (const [sym, r] of prev.entries()) {
        if (r.underlying === underlying) next.delete(sym);
      }
      return next;
    });
    setSessions((prev) => {
      const next = new Map(prev);
      for (const [id, s] of prev.entries()) {
        if (s.symbols.length === 1 && s.symbols[0] === underlying) {
          next.delete(id);
        } else if (s.symbols.includes(underlying)) {
          next.set(id, { ...s, symbols: s.symbols.filter((x) => x !== underlying) });
        }
      }
      return next;
    });
  }, []);

  // Fetch initial state and connect listener WebSocket on mount
  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectListener = () => {
      if (cancelled) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/listen`);
      listenerRef.current = ws;

      ws.onmessage = (event) => {
        const msg: WsMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "state":
            // ignore, we already fetched via REST
            break;
          case "update":
            setResultsMap((prev) => {
              const next = new Map(prev);
              next.set(msg.result.symbol, msg.result);
              return next;
            });
            break;
          case "underlying_subscribed":
            setResultsMap((prev) => {
              const next = new Map(prev);
              for (const r of msg.results) next.set(r.symbol, r);
              return next;
            });
            break;
          case "underlying_removed":
            removeUnderlying(msg.underlying);
            break;
          case "underlying_no_results":
            activeUnderlyingsRef.current.delete(msg.underlying);
            setNotice(`${msg.underlying}: 0 matches — try relaxing filters`);
            setTimeout(() => setNotice(null), 6000);
            break;
          case "listener_heartbeat":
            setHeartbeat({
              serverTime: msg.server_time,
              epochMs: msg.epoch_ms,
              receivedAt: Date.now(),
              subscribedUnderlyings: msg.subscribed_underlyings,
              totalContracts: msg.total_contracts,
              listeners: msg.listeners,
            });
            break;
        }
      };

      ws.onclose = () => {
        if (listenerRef.current === ws) listenerRef.current = null;
        if (!cancelled) {
          reconnectTimer = setTimeout(connectListener, 2000);
        }
      };

      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    };

    const initialize = async () => {
      try {
        const resp = await fetch("/api/state");
        const state: { subscribed_underlyings: string[]; results: ScreenResult[] } = await resp.json();
        if (cancelled) return;
        if (state.results.length > 0) {
          setResultsMap((prev) => {
            const next = new Map(prev);
            for (const r of state.results) next.set(r.symbol, r);
            return next;
          });
        }
        const byUnderlying = new Map<string, ScreenResult[]>();
        for (const r of state.results) {
          const arr = byUnderlying.get(r.underlying) ?? [];
          arr.push(r);
          byUnderlying.set(r.underlying, arr);
        }
        for (const underlying of state.subscribed_underlyings) {
          upsertRestoredSession(underlying, byUnderlying.get(underlying) ?? []);
        }
      } catch (e) {
        console.error("Failed to fetch initial state:", e);
      }

      if (cancelled) return;
      connectListener();
    };

    initialize();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (listenerRef.current) {
        listenerRef.current.close();
        listenerRef.current = null;
      }
    };
  }, [upsertRestoredSession, removeUnderlying]);

  const startScreening = useCallback((params: ScreenParams) => {
    const requestedSymbols = params.symbols;

    const alreadySubscribed = requestedSymbols.filter((s) => activeUnderlyingsRef.current.has(s));
    const toScreen = requestedSymbols.filter((s) => !activeUnderlyingsRef.current.has(s));

    if (alreadySubscribed.length > 0) {
      setNotice(`Skipped ${alreadySubscribed.join(", ")} — already subscribed`);
      setTimeout(() => setNotice(null), 4000);
    }

    if (toScreen.length === 0) return;

    for (const s of toScreen) activeUnderlyingsRef.current.add(s);

    // Purge stale empty (0-result) symbol entries from existing sessions for re-screened symbols
    const toScreenSet = new Set(toScreen);
    setSessions((prev) => {
      const next = new Map(prev);
      for (const [sid, s] of prev.entries()) {
        // find which of this session's symbols are (a) being re-screened and (b) currently empty
        const emptyOverlap = s.symbols.filter((sym) => {
          if (!toScreenSet.has(sym)) return false;
          const p = s.progress.get(sym);
          return p && p.status === "done" && p.results.length === 0;
        });
        if (emptyOverlap.length === 0) continue;

        const remaining = s.symbols.filter((sym) => !emptyOverlap.includes(sym));
        if (remaining.length === 0) {
          next.delete(sid);
        } else {
          const progress = new Map(s.progress);
          for (const sym of emptyOverlap) progress.delete(sym);
          next.set(sid, { ...s, symbols: remaining, progress });
        }
      }
      return next;
    });

    const filteredParams = { ...params, symbols: toScreen };
    const id = `S${nextSessionId++}`;

    setSessions((prev) => {
      const next = new Map(prev);
      next.set(id, {
        id,
        symbols: toScreen,
        state: "connecting",
        elapsed: 0,
        progress: new Map(),
        subscribedCount: 0,
      });
      return next;
    });

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/screen`);
    wsMapRef.current.set(id, ws);

    ws.onopen = () => {
      updateSession(id, (s) => ({ ...s, state: "screening" }));
      ws.send(JSON.stringify(filteredParams));
    };

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);

      switch (msg.type) {
        case "started":
          updateSession(id, (s) => {
            const progress = new Map(s.progress);
            for (const sym of msg.symbols) {
              progress.set(sym, { symbol: sym, status: "pending", results: [] });
            }
            return { ...s, progress };
          });
          break;

        case "symbol_progress":
          updateSession(id, (s) => {
            const progress = new Map(s.progress);
            const existing = progress.get(msg.symbol);
            progress.set(msg.symbol, {
              ...existing,
              symbol: msg.symbol,
              status: "screening",
              results: existing?.results || [],
            });
            return { ...s, progress };
          });
          break;

        case "symbol_done":
          setResultsMap((prev) => {
            const next = new Map(prev);
            for (const r of msg.results) next.set(r.symbol, r);
            return next;
          });
          updateSession(id, (s) => {
            const progress = new Map(s.progress);
            progress.set(msg.symbol, {
              symbol: msg.symbol,
              status: "done",
              results: msg.results,
              elapsed: msg.elapsed,
            });
            return { ...s, progress };
          });
          break;

        case "completed":
          updateSession(id, (s) => ({ ...s, state: "done", elapsed: msg.elapsed }));
          break;

        case "subscribed":
          updateSession(id, (s) => ({ ...s, subscribedCount: msg.count }));
          break;

        case "heartbeat":
          updateSession(id, (s) => ({ ...s, elapsed: msg.elapsed }));
          break;

        case "log":
          setLogs((prev) => [
            ...prev,
            { message: msg.message, level: msg.level, timestamp: Date.now(), sessionId: id },
          ]);
          break;

        case "stopped":
          removeSymbolsFromActive(toScreen);
          setSessions((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
          break;

        case "error":
          removeSymbolsFromActive(toScreen);
          updateSession(id, (s) => ({ ...s, state: "error", error: msg.message }));
          break;
      }
    };

    ws.onerror = () => {
      removeSymbolsFromActive(toScreen);
      updateSession(id, (s) => ({ ...s, state: "error", error: "WebSocket connection failed" }));
    };

    ws.onclose = () => {
      wsMapRef.current.delete(id);
    };
  }, []);

  const stopSession = useCallback(async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;

    const isBusy = session.state === "connecting" || session.state === "screening";
    const hasSubscriptions = session.subscribedCount > 0;

    if (isBusy) {
      const ws = wsMapRef.current.get(id);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send("stop");
      }
      removeSymbolsFromActive(session.symbols);
      setSessions((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    } else if (!hasSubscriptions) {
      // Empty result session — just dismiss locally, nothing to unsubscribe
      removeSymbolsFromActive(session.symbols);
      setSessions((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    } else {
      // Subscribed / done — unsubscribe via REST
      for (const underlying of session.symbols) {
        try {
          await fetch(`/api/unsubscribe/${underlying}`, { method: "POST" });
        } catch (e) {
          console.error(`Unsubscribe failed for ${underlying}:`, e);
        }
      }
      // The listener WS will receive underlying_removed and clean up state
    }
  }, [sessions]);

  const stopAll = useCallback(async () => {
    const active = Array.from(sessions.values());
    for (const s of active) {
      await stopSession(s.id);
    }
  }, [sessions, stopSession]);

  const clearResults = useCallback(() => {
    setResultsMap(new Map());
    setLogs([]);
  }, []);

  const anyBusy = Array.from(sessions.values()).some(
    (s) => s.state === "connecting" || s.state === "screening"
  );

  return {
    sessions: Array.from(sessions.values()),
    results,
    logs,
    anyBusy,
    totalSubscribed,
    notice,
    heartbeat,
    startScreening,
    stopSession,
    stopAll,
    clearResults,
  };
}
