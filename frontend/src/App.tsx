import { useRef, useCallback, useMemo } from "react";
import { ScreenerForm } from "./components/ScreenerForm";
import { ProgressBar } from "./components/ProgressBar";
import { ResultsTable } from "./components/ResultsTable";
import { LogPanel } from "./components/LogPanel";
import { BackToTop } from "./components/BackToTop";
import { HeartbeatIndicator } from "./components/HeartbeatIndicator";
import { useScreener } from "./hooks/useScreener";
import type { ScreenParams } from "./types";

function App() {
  const {
    sessions,
    results,
    logs,
    totalSubscribed,
    notice,
    heartbeat,
    updatedSymbols,
    newestFoundUnderlying,
    subscribedUnderlyings,
    startScreening,
    stopSession,
    stopUnderlying,
    addPendingRestart,
    clearUnderlying,
    stopAll,
    clearResults,
  } = useScreener();

  // Derive per-underlying screening status from active sessions
  const screeningStatus = useMemo(() => {
    const map = new Map<string, "pending" | "screening" | "stopping">();
    for (const session of sessions) {
      if (session.state === "stopping") {
        for (const sym of session.symbols) map.set(sym, "stopping");
      } else if (session.progress.size === 0) {
        for (const sym of session.symbols) map.set(sym, "pending");
      } else {
        for (const [sym, p] of session.progress) {
          if (p.status === "screening" || p.status === "pending") {
            map.set(sym, p.status);
          }
        }
      }
    }
    return map;
  }, [sessions]);

  const paramsRef = useRef<Omit<ScreenParams, "symbols">>({
    side: "put",
    min_annual_return: 20,
    max_dte: 70,
    min_otm: 0.1,
    max_abs_delta: 100,
    min_open_interest: 1,
    max_spread_ratio: 100,
    min_iv_rank: 0,
    min_pop: 0,
    pre_market: false,
  });

  const handleSubmit = (params: ScreenParams) => {
    startScreening(params);
  };

  const handleParamsChange = useCallback((p: Omit<ScreenParams, "symbols">) => {
    paramsRef.current = p;
  }, []);

  const handleScreenAgain = useCallback((symbol: string) => {
    startScreening({ ...paramsRef.current, symbols: [symbol] });
  }, [startScreening]);

  const handleRestart = useCallback((underlying: string) => {
    clearUnderlying(underlying);
    const session = sessions.find((s) => s.symbols.includes(underlying));
    const params = { ...paramsRef.current, symbols: [underlying] };
    if (session && session.state !== "stopping") {
      // Queue restart to fire after backend confirms the stop/unsubscribe
      addPendingRestart(underlying, params);
      stopSession(session.id);
    } else if (!session) {
      // No session — symbol is fully cleaned up, start directly
      startScreening(params);
    }
    // If state is already "stopping", addPendingRestart was already called; do nothing
  }, [clearUnderlying, sessions, addPendingRestart, stopSession, startScreening]);

  const handleStop = useCallback((underlying: string) => {
    const session = sessions.find((s) => s.symbols.includes(underlying));
    if (session) {
      stopSession(session.id);
    } else {
      stopUnderlying(underlying);
    }
  }, [sessions, stopSession, stopUnderlying]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Fat Premium Options Screener</h1>
          <div className="flex items-center gap-3">
            <HeartbeatIndicator heartbeat={heartbeat} />
            {totalSubscribed > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 font-medium">
                {totalSubscribed} live subscription{totalSubscribed > 1 ? "s" : ""}
              </span>
            )}
            {sessions.length > 0 && (
              <span className="text-xs text-gray-500">
                {sessions.length} session{sessions.length > 1 ? "s" : ""}
              </span>
            )}
            {results.length > 0 && (
              <button
                onClick={clearResults}
                className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
              >
                Clear Results
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <ScreenerForm
          onSubmit={handleSubmit}
          disabled={false}
          onParamsChange={handleParamsChange}
          onStop={sessions.length > 0 ? stopAll : undefined}
          stopLabel={sessions.length > 1 ? "Stop All" : "Stop"}
        />

        {notice && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-sm text-yellow-800">
            {notice}
          </div>
        )}

        <ProgressBar
          sessions={sessions}
          results={results}
          onStop={stopSession}
          onScreenAgain={handleScreenAgain}
        />

        <LogPanel logs={logs} />

        <ResultsTable
          results={results}
          updatedSymbols={updatedSymbols}
          newestFoundUnderlying={newestFoundUnderlying}
          screeningStatus={screeningStatus}
          subscribedUnderlyings={subscribedUnderlyings}
          onStop={handleStop}
          onRestart={handleRestart}
        />
      </main>

      <BackToTop heartbeat={heartbeat} totalSubscribed={totalSubscribed} />
    </div>
  );
}

export default App;
