import type { Session } from "../hooks/useScreener";
import type { ScreenResult, SymbolProgress } from "../types";

interface Props {
  sessions: Session[];
  results: ScreenResult[];
  onStop: (id: string) => void;
  onScreenAgain?: (symbol: string) => void;
}

function scrollToSymbol(underlying: string) {
  // Ask the target SymbolTable to unfold first
  window.dispatchEvent(new CustomEvent("unfold-symbol", { detail: { underlying } }));
  // Then scroll (use rAF so the DOM has a chance to expand)
  requestAnimationFrame(() => {
    const el = document.getElementById(`results-${underlying}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function maxReturnColor(ann: number): string {
  if (ann >= 100) return "text-green-700 font-bold";
  if (ann >= 70) return "text-green-600 font-semibold";
  if (ann >= 30) return "text-yellow-700";
  return "text-gray-600";
}

interface CardProps {
  session: Session;
  symbolProgress: SymbolProgress;
  results: ScreenResult[];
  onStop: (id: string) => void;
  onScreenAgain?: (symbol: string) => void;
}

function SymbolCard({ session, symbolProgress, results, onStop, onScreenAgain }: CardProps) {
  const { symbol, status, elapsed } = symbolProgress;
  const isBusy = session.state === "connecting" || session.state === "screening";
  const isStopping = session.state === "stopping";

  const symbolResults = results.filter((r) => r.underlying === symbol);
  const maxAnnReturn = symbolResults.reduce(
    (m, r) => (r.ann_return_pct > m ? r.ann_return_pct : m),
    -Infinity,
  );
  const hasReturn = symbolResults.length > 0 && Number.isFinite(maxAnnReturn);
  const isDone = status === "done";
  const isEmpty = isDone && symbolResults.length === 0;

  const displayState =
    isStopping ? "stopping" :
    status === "screening" ? "screening" :
    isEmpty ? "0 matches" :
    isDone && session.state === "done" ? "live" :
    isDone ? "done" :
    session.state === "error" ? "error" :
    "pending";

  const stateStyles =
    displayState === "screening" ? "bg-yellow-100 text-yellow-800" :
    displayState === "stopping" ? "bg-orange-100 text-orange-700" :
    displayState === "live" ? "bg-green-100 text-green-800" :
    displayState === "0 matches" ? "bg-gray-100 text-gray-600" :
    displayState === "done" ? "bg-green-50 text-green-700" :
    displayState === "error" ? "bg-red-100 text-red-800" :
    "bg-gray-100 text-gray-600";

  const stopLabel = isStopping ? "Stopping…" : isBusy ? "Stop" : isEmpty ? "Dismiss" : "\u2716";

  return (
    <div
      className={`bg-white border rounded-lg px-4 py-3 flex items-center gap-4 text-sm cursor-pointer hover:shadow-sm transition-all ${
        isEmpty ? "border-gray-200 opacity-75" : "border-gray-200 hover:border-blue-400"
      }`}
      onClick={() => !isEmpty && scrollToSymbol(symbol)}
      title={isEmpty ? "No contracts matched the filters" : "Click to jump to results"}
    >
      <div className="flex flex-col leading-tight">
        <span className="text-base font-bold text-gray-900">{symbol}</span>
        <span className="font-mono text-[10px] text-gray-400">{session.id}</span>
      </div>

      <span className={`px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1.5 ${stateStyles}`}>
        {displayState === "screening" && (
          <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
        )}
        {displayState}
      </span>

      {hasReturn && (
        <div className="flex flex-col items-end leading-tight">
          <span className="text-[10px] uppercase text-gray-400 tracking-wide">Max Ann Ret</span>
          <span className={`text-base ${maxReturnColor(maxAnnReturn)}`}>
            {maxAnnReturn.toFixed(1)}%
          </span>
        </div>
      )}

      {isDone && (
        <div className="flex flex-col items-end leading-tight">
          <span className="text-[10px] uppercase text-gray-400 tracking-wide">Contracts</span>
          <span className={`text-sm font-semibold ${symbolResults.length > 0 ? "text-blue-700" : "text-gray-400"}`}>
            {symbolResults.length}
          </span>
        </div>
      )}

      {elapsed !== undefined && elapsed > 0 && (
        <span className="text-xs text-gray-500">{elapsed.toFixed(0)}s</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {isEmpty && !isStopping && onScreenAgain && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onScreenAgain(symbol);
            }}
            className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
            title="Screen again with current filter settings"
          >
            Screen Again
          </button>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!isStopping) onStop(session.id);
          }}
          disabled={isStopping}
          className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
            isStopping
              ? "text-orange-600 bg-orange-50 cursor-not-allowed opacity-60"
              : isEmpty
              ? "text-gray-600 bg-gray-100 hover:bg-gray-200"
              : "text-red-600 bg-red-50 hover:bg-red-100"
          }`}
          title={isStopping ? "Waiting for backend to stop…" : isBusy ? "Stop screening" : isEmpty ? "Dismiss" : "Disconnect"}
        >
          {stopLabel}
        </button>
      </div>

      {session.error && (
        <span className="text-xs text-red-600" title={session.error}>error</span>
      )}
    </div>
  );
}

export function ProgressBar({ sessions, results, onStop, onScreenAgain }: Props) {
  if (sessions.length === 0) return null;

  const cards: { session: Session; sp: SymbolProgress }[] = [];
  for (const session of sessions) {
    const items = Array.from(session.progress.values());
    if (items.length === 0) {
      for (const sym of session.symbols) {
        cards.push({
          session,
          sp: { symbol: sym, status: "pending", results: [] },
        });
      }
    } else {
      for (const sp of items) cards.push({ session, sp });
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      {cards.map(({ session, sp }) => (
        <SymbolCard
          key={`${session.id}-${sp.symbol}`}
          session={session}
          symbolProgress={sp}
          results={results}
          onStop={onStop}
          onScreenAgain={onScreenAgain}
        />
      ))}
    </div>
  );
}
