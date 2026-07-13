import { useEffect, useState } from "react";
import type { ScreenParams } from "../types";

interface Props {
  onSubmit: (params: ScreenParams) => void;
  disabled: boolean;
  onStop?: () => void;
  stopLabel?: string;
  onParamsChange?: (params: Omit<ScreenParams, "symbols">) => void;
}

const DEFAULT_PARAMS: Omit<ScreenParams, "symbols"> = {
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
};

const GROUP_LABELS: Record<string, string> = {
  core: "Core",
  nasdaq100: "Nasdaq-100",
  leveraged_etfs: "Leveraged ETFs",
};

export function ScreenerForm({ onSubmit, disabled, onStop, stopLabel, onParamsChange }: Props) {
  const [availableSymbols, setAvailableSymbols] = useState<Record<string, string[]>>({});
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [customSymbol, setCustomSymbol] = useState("");
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ core: true });

  useEffect(() => {
    onParamsChange?.(params);
  }, [params, onParamsChange]);

  useEffect(() => {
    fetch("/api/universe")
      .then((r) => r.json())
      .then((data) => {
        setAvailableSymbols(data.groups || {});
        setSelectedSymbols(["KORU"]);
      })
      .catch(() => {});
  }, []);

  const toggleSymbol = (symbol: string) => {
    setSelectedSymbols((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]
    );
  };

  const addCustomSymbol = () => {
    const s = customSymbol.trim().toUpperCase();
    if (s && !selectedSymbols.includes(s)) {
      setSelectedSymbols((prev) => [...prev, s]);
    }
    setCustomSymbol("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSymbols.length === 0) return;
    onSubmit({ ...params, symbols: selectedSymbols });
  };

  const groupOrder = ["core", "leveraged_etfs", "nasdaq100"];
  const orderedGroups = groupOrder
    .filter((g) => availableSymbols[g])
    .concat(Object.keys(availableSymbols).filter((g) => !groupOrder.includes(g)));

  const renderSymbolButton = (s: string) => (
    <button
      key={s}
      type="button"
      onClick={() => toggleSymbol(s)}
      className={`px-2.5 py-1 text-xs rounded border transition-colors ${
        selectedSymbols.includes(s)
          ? "bg-blue-600 text-white border-blue-600"
          : "bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100"
      }`}
    >
      {s}
    </button>
  );

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-6 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Symbols</h3>

        <div className="space-y-3">
          {orderedGroups.map((group) => {
            const symbols = availableSymbols[group] ?? [];
            const isCore = group === "core";
            const isExpanded = expanded[group] ?? false;
            const label = GROUP_LABELS[group] ?? group;

            return (
              <div key={group} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded((p) => ({ ...p, [group]: !isExpanded }))}
                  className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left"
                >
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                    {label} <span className="text-gray-400 font-normal">({symbols.length})</span>
                  </span>
                  <span className="text-xs text-gray-400">
                    {isExpanded ? "\u25BC" : "\u25B6"}
                  </span>
                </button>
                {(isExpanded || isCore) && (
                  <div className="p-3 flex flex-wrap gap-1.5">
                    {symbols.map(renderSymbolButton)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 mt-3">
          <input
            type="text"
            value={customSymbol}
            onChange={(e) => setCustomSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomSymbol())}
            placeholder="Add custom symbol..."
            className="px-2 py-1 text-sm border border-gray-300 rounded"
          />
          <button type="button" onClick={addCustomSymbol} className="px-3 py-1 text-sm bg-gray-100 rounded border border-gray-300 hover:bg-gray-200">
            Add
          </button>
        </div>

        {selectedSymbols.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <div className="text-xs text-gray-500 mb-1.5">Selected ({selectedSymbols.length}):</div>
            <div className="flex flex-wrap gap-1">
              {selectedSymbols.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">
                  {s}
                  <button type="button" onClick={() => toggleSymbol(s)} className="text-blue-500 hover:text-blue-700">&times;</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Side</label>
          <select
            value={params.side}
            onChange={(e) => setParams({ ...params, side: e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          >
            <option value="both">Both</option>
            <option value="put">Put</option>
            <option value="call">Call</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Min Annual Return %</label>
          <input
            type="number"
            step="1"
            value={params.min_annual_return}
            onChange={(e) => setParams({ ...params, min_annual_return: +e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Max DTE</label>
          <input
            type="number"
            value={params.max_dte}
            onChange={(e) => setParams({ ...params, max_dte: +e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Min OTM %</label>
          <input
            type="number"
            step="0.01"
            value={params.min_otm}
            onChange={(e) => setParams({ ...params, min_otm: +e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Max Abs Delta</label>
          <input
            type="number"
            step="0.01"
            value={params.max_abs_delta}
            onChange={(e) => setParams({ ...params, max_abs_delta: +e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Min Open Interest</label>
          <input
            type="number"
            value={params.min_open_interest}
            onChange={(e) => setParams({ ...params, min_open_interest: +e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Max Spread Ratio</label>
          <input
            type="number"
            step="0.1"
            value={params.max_spread_ratio}
            onChange={(e) => setParams({ ...params, max_spread_ratio: +e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Min IV Rank</label>
          <input
            type="number"
            value={params.min_iv_rank}
            onChange={(e) => setParams({ ...params, min_iv_rank: +e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Min POP %</label>
          <input
            type="number"
            step="1"
            value={params.min_pop}
            onChange={(e) => setParams({ ...params, min_pop: +e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={params.pre_market}
              onChange={(e) => setParams({ ...params, pre_market: e.target.checked })}
              className="rounded"
            />
            Pre-market mode
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled || selectedSymbols.length === 0}
          className="flex-1 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {`Start Screening (${selectedSymbols.length} symbols)`}
        </button>
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="px-6 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
          >
            {stopLabel || "Stop"}
          </button>
        )}
      </div>
    </form>
  );
}
