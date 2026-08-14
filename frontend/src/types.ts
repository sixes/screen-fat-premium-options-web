export interface ScreenResult {
  underlying: string;
  symbol: string;
  side: string;
  expiration: string;
  dte: number;
  strike: number;
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  iv: number;
  open_interest: number;
  volume: number;
  underlying_price: number;
  premium: number;
  collateral: number;
  ann_return_pct: number;
  iv_rank: number;
  pop: number;
  expected_value: number;
}

export interface ScreenParams {
  symbols: string[];
  side: string;
  min_annual_return: number;
  max_dte: number;
  min_otm: number;
  max_abs_delta: number;
  min_open_interest: number;
  max_spread_ratio: number;
  min_iv_rank: number;
  min_pop: number;
  pre_market: boolean;
}

export type SymbolStatus = "pending" | "screening" | "done" | "error";

export interface SymbolProgress {
  symbol: string;
  status: SymbolStatus;
  results: ScreenResult[];
  elapsed?: number;
}

export type WsMessage =
  | { type: "started"; symbols: string[]; total: number }
  | { type: "symbol_progress"; symbol: string; status: string }
  | { type: "symbol_done"; symbol: string; results: ScreenResult[]; count: number; elapsed: number; progress: number; total: number }
  | { type: "completed"; total_results: number; elapsed: number; skipped?: boolean }
  | { type: "heartbeat"; elapsed: number; progress: number; total: number }
  | { type: "log"; message: string; level: string }
  | { type: "update"; result: ScreenResult }
  | { type: "remove"; symbol: string }
  | { type: "contract_found"; result: ScreenResult }
  | { type: "subscribed"; count: number }
  | { type: "skipped"; underlyings: string[] }
  | { type: "stopped"; message: string }
  | { type: "state"; subscribed_underlyings: string[]; results: ScreenResult[] }
  | { type: "underlying_screening"; underlying: string }
  | { type: "underlying_subscribed"; underlying: string; count: number; results: ScreenResult[] }
  | { type: "underlying_no_results"; underlying: string }
  | { type: "underlying_removed"; underlying: string }
  | { type: "listener_heartbeat"; server_time: string; epoch_ms: number; subscribed_underlyings: number; total_contracts: number; listeners: number }
  | { type: "error"; message: string };
