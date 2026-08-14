import { useEffect, useMemo, useState } from "react";
import type { ScreenResult } from "../types";

interface Props {
  results: ScreenResult[];
  updatedSymbols?: Set<string>;
  newestFoundUnderlying?: string | null;
  screeningStatus?: Map<string, "pending" | "screening" | "stopping">;
  subscribedUnderlyings?: Set<string>;
  onStop?: (underlying: string) => void;
  onRestart?: (underlying: string) => void;
}

type SortKey = keyof ScreenResult;
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align?: "right"; prominent?: boolean }[] = [
  { key: "underlying_price", label: "Price", align: "right" },
  { key: "side", label: "Side" },
  { key: "expiration", label: "Exp" },
  { key: "dte", label: "DTE", align: "right", prominent: true },
  { key: "strike", label: "Strike", align: "right" },
  { key: "bid", label: "Bid", align: "right" },
  { key: "ask", label: "Ask", align: "right", prominent: true },
  { key: "mid", label: "Mid", align: "right" },
  { key: "ann_return_pct", label: "Ann Ret%", align: "right", prominent: true },
  { key: "delta", label: "Delta", align: "right" },
  { key: "iv", label: "IV", align: "right" },
  { key: "open_interest", label: "OI", align: "right" },
  { key: "iv_rank", label: "IVR", align: "right" },
  { key: "pop", label: "POP%", align: "right" },
  { key: "expected_value", label: "EV", align: "right" },
];

const CSV_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "underlying", label: "Symbol" },
  ...COLUMNS,
];

function formatCell(key: SortKey, value: unknown): string {
  if (value === null || value === undefined) return "-";
  switch (key) {
    case "underlying_price":
    case "strike":
    case "bid":
    case "ask":
    case "mid":
    case "expected_value":
      return (value as number).toFixed(2);
    case "delta":
      return (value as number).toFixed(3);
    case "iv":
      return ((value as number) * 100).toFixed(1) + "%";
    case "ann_return_pct":
    case "pop":
      return (value as number).toFixed(1);
    case "iv_rank":
      return (value as number).toFixed(0);
    default:
      return String(value);
  }
}

function returnColor(annReturn: number): string {
  if (annReturn >= 100) return "text-green-700 font-semibold";
  if (annReturn >= 50) return "text-green-600";
  if (annReturn >= 30) return "text-yellow-700";
  return "";
}

function compareRows(a: ScreenResult, b: ScreenResult, key: SortKey, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];
  if (av === bv) return 0;
  const cmp = av < bv ? -1 : 1;
  return dir === "asc" ? cmp : -cmp;
}

interface SymbolTableProps {
  underlying: string;
  rows: ScreenResult[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  foldSignal?: { collapsed: boolean; version: number };
  updatedSymbols?: Set<string>;
  isNew?: boolean;
  screeningStatus?: "pending" | "screening" | "stopping";
  isLive?: boolean;
  onStop?: (underlying: string) => void;
  onRestart?: (underlying: string) => void;
}

function SymbolTable({ underlying, rows, sortKey, sortDir, onSort, foldSignal, updatedSymbols, isNew, screeningStatus, isLive, onStop, onRestart }: SymbolTableProps) {
  const [collapsed, setCollapsed] = useState(() => !isNew);

  // When this underlying is newly found: expand it and fold all others.
  // Running inside useEffect guarantees all sibling listeners are attached.
  useEffect(() => {
    if (isNew) {
      setCollapsed(false);
      window.dispatchEvent(new CustomEvent("unfold-symbol", { detail: { underlying } }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  useEffect(() => {
    if (foldSignal && foldSignal.version > 0) {
      setCollapsed(foldSignal.collapsed);
    }
  }, [foldSignal?.version, foldSignal?.collapsed]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ underlying: string }>).detail;
      if (!detail) return;
      setCollapsed(detail.underlying !== underlying);
    };
    window.addEventListener("unfold-symbol", handler);
    return () => window.removeEventListener("unfold-symbol", handler);
  }, [underlying]);

  // Stable sort order: only re-sorts when the symbol set changes or user clicks a header.
  // Live price updates change row values but not the order, so the table stays readable.
  const [sortOrder, setSortOrder] = useState<string[]>(() =>
    [...rows].sort((a, b) => compareRows(a, b, sortKey, sortDir)).map((r) => r.symbol)
  );

  // Detect structural changes (contracts added or removed) without re-sorting on value updates.
  const symbolsKey = useMemo(
    () => rows.map((r) => r.symbol).sort().join("|"),
    [rows]
  );

  useEffect(() => {
    setSortOrder([...rows].sort((a, b) => compareRows(a, b, sortKey, sortDir)).map((r) => r.symbol));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey]);

  // Re-sort when user explicitly changes the sort column/direction.
  useEffect(() => {
    setSortOrder([...rows].sort((a, b) => compareRows(a, b, sortKey, sortDir)).map((r) => r.symbol));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, sortDir]);

  // Map current row data onto the stable order so values update in-place.
  const sorted = useMemo(() => {
    const rowMap = new Map(rows.map((r) => [r.symbol, r]));
    return sortOrder.flatMap((sym) => {
      const row = rowMap.get(sym);
      return row ? [row] : [];
    });
  }, [sortOrder, rows]);

  const underlyingPrice = rows[0]?.underlying_price;
  const maxAnnReturn = rows.reduce((m, r) => (r.ann_return_pct > m ? r.ann_return_pct : m), -Infinity);
  const hasMax = rows.length > 0 && Number.isFinite(maxAnnReturn);

  const downloadCsv = () => {
    const header = CSV_COLUMNS.map((c) => c.label).join(",");
    const csvRows = sorted.map((r) => CSV_COLUMNS.map((c) => r[c.key]).join(","));
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${underlying}_results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div id={`results-${underlying}`} className="bg-white border border-gray-200 rounded-lg scroll-mt-4">
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 cursor-pointer hover:bg-gray-100"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-baseline gap-3">
          <span className="text-gray-400 text-xs">{collapsed ? "\u25B6" : "\u25BC"}</span>
          <h3 className="text-base font-bold text-gray-900">{underlying}</h3>
          {underlyingPrice !== undefined && (
            <span className="text-sm text-gray-600">${underlyingPrice.toFixed(2)}</span>
          )}
          <span className="text-xs text-gray-500">
            {rows.length} contract{rows.length > 1 ? "s" : ""}
          </span>
          {screeningStatus === "screening" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
              Screening
            </span>
          )}
          {screeningStatus === "pending" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
              Pending
            </span>
          )}
          {screeningStatus === "stopping" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
              <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
              Stopping…
            </span>
          )}
          {!screeningStatus && isLive && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              {rows.some((r) => updatedSymbols?.has(r.symbol)) && (
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              )}
              live
            </span>
          )}
          {!screeningStatus && !isLive && rows.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
              stopped
            </span>
          )}
          {hasMax && (
            <span className={`text-xs font-semibold ${
              maxAnnReturn >= 100 ? "text-green-700" :
              maxAnnReturn >= 70 ? "text-green-600" :
              maxAnnReturn >= 30 ? "text-yellow-700" :
              "text-gray-600"
            }`}>
              max {maxAnnReturn.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {(isLive || (screeningStatus && screeningStatus !== "stopping")) && onStop && (
            <button
              onClick={() => onStop(underlying)}
              className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              Stop
            </button>
          )}
          {!isLive && !screeningStatus && rows.length > 0 && onRestart && (
            <button
              onClick={() => onRestart(underlying)}
              className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Restart
            </button>
          )}
          <button
            onClick={downloadCsv}
            className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
          >
            CSV
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="overflow-x-auto overflow-y-auto max-h-[60vh]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-gray-200 shadow-sm">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => onSort(col.key)}
                    className={`py-2 cursor-pointer hover:bg-gray-100 whitespace-nowrap ${
                      col.align === "right" ? "text-right" : "text-left"
                    } ${col.prominent
                      ? "px-3 font-bold text-gray-900 bg-gray-50 border-b-2 border-indigo-400"
                      : "px-2 font-medium text-gray-500 bg-gray-50"
                    }`}
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span className="ml-0.5">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => {
                const isHot = row.ann_return_pct >= 70;
                const isFlashing = updatedSymbols?.has(row.symbol) ?? false;
                const highlightKeys: SortKey[] = ["dte", "ask", "strike"];
                const strikeGap = row.underlying_price > 0
                  ? ((row.strike - row.underlying_price) / row.underlying_price) * 100
                  : 0;
                return (
                  <tr
                    key={`${row.symbol}-${i}`}
                    className={`border-b border-gray-100 hover:bg-gray-50 ${isHot ? "bg-green-50" : ""} ${isFlashing ? "row-flash" : ""}`}
                  >
                    {COLUMNS.map((col) => {
                      const emphasize = isHot && highlightKeys.includes(col.key);
                      return (
                        <td
                          key={col.key}
                          className={`py-1.5 whitespace-nowrap ${
                            col.align === "right" ? "text-right" : "text-left"
                          } ${col.prominent ? "px-3 font-semibold text-[13px]" : "px-2"} ${
                            col.key === "ann_return_pct" ? returnColor(row.ann_return_pct) : ""
                          } ${
                            col.key === "side" ? (row.side === "put" ? "text-red-600" : "text-blue-600") : ""
                          } ${
                            emphasize ? "font-bold text-green-900 bg-green-200" : ""
                          }`}
                        >
                          {col.key === "strike" ? (
                            <span className="inline-flex items-baseline gap-1">
                              <span>{row.strike.toFixed(2)}</span>
                              <span className={`text-[10px] ${
                                emphasize ? "text-green-800" :
                                strikeGap < 0 ? "text-red-500" : "text-blue-500"
                              }`}>
                                {strikeGap >= 0 ? "+" : ""}{strikeGap.toFixed(1)}%
                              </span>
                            </span>
                          ) : (
                            formatCell(col.key, row[col.key])
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ResultsTable({ results, updatedSymbols, newestFoundUnderlying, screeningStatus, subscribedUnderlyings, onStop, onRestart }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("ann_return_pct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [foldSignal, setFoldSignal] = useState<{ collapsed: boolean; version: number }>({ collapsed: false, version: 0 });

  const grouped = useMemo(() => {
    const map = new Map<string, ScreenResult[]>();
    for (const r of results) {
      const arr = map.get(r.underlying) ?? [];
      arr.push(r);
      map.set(r.underlying, arr);
    }
    return Array.from(map.entries()).reverse();
  }, [results]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (results.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setFoldSignal((s) => ({ collapsed: true, version: s.version + 1 }))}
          className="px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
        >
          Fold All
        </button>
        <button
          onClick={() => setFoldSignal((s) => ({ collapsed: false, version: s.version + 1 }))}
          className="px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
        >
          Expand All
        </button>
      </div>
      {grouped.map(([underlying, rows]) => (
        <SymbolTable
          key={underlying}
          underlying={underlying}
          rows={rows}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          foldSignal={foldSignal}
          updatedSymbols={updatedSymbols}
          isNew={underlying === newestFoundUnderlying}
          screeningStatus={screeningStatus?.get(underlying)}
          isLive={subscribedUnderlyings?.has(underlying)}
          onStop={onStop}
          onRestart={onRestart}
        />
      ))}
    </div>
  );
}
