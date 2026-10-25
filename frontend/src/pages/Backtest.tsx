import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bt, BtInstrument, BtSession, BtState, BtTrade, Candle, INTRADAY, mergeTail, money, Timeframe, TIMEFRAMES, VwapPoint,
} from "../lib/backtestApi";
import { formatDateTime } from "../lib/format";
import BtChart, { BtChartHandle, ChartLine } from "../components/backtest/BtChart";
import OrderTicket, { Draft, sizeFor, snap } from "../components/backtest/OrderTicket";
import BtTradesTable from "../components/backtest/BtTradesTable";
import BtDashboard from "../components/backtest/BtDashboard";
import NewSessionModal from "../components/backtest/NewSessionModal";
import DataModal from "../components/backtest/DataModal";
import Lightbox from "../components/Lightbox";

const NEG = "#f0566b";
const POS = "#22c58b";
const SPEEDS = [1, 2, 4, 8];

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function store(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

const emptyDraft = (risk: number): Draft => ({ side: "long", stop: "", target: "", sizing: "risk", risk: String(risk), qty: "1", setup: "" });

export default function Backtest() {
  const [tab, setTab] = useState<"replay" | "dashboard">(stored("bt.tab", "replay"));
  const [instruments, setInstruments] = useState<BtInstrument[]>([]);
  const [sessions, setSessions] = useState<BtSession[]>([]);
  const [strategies, setStrategies] = useState<string[]>([]);
  const [setups, setSetups] = useState<string[]>([]);
  const [sid, setSid] = useState<number | null>(stored("bt.session", null));
  const [tf, setTf] = useState<Timeframe>("1h");
  const [st, setSt] = useState<BtState | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [vwap, setVwap] = useState<VwapPoint[]>([]);
  const [resetKey, setResetKey] = useState("init");
  const [showVwap, setShowVwap] = useState<boolean>(stored("bt.vwap", true));
  const [showBands, setShowBands] = useState<boolean>(stored("bt.bands", false));
  const [showVolume, setShowVolume] = useState<boolean>(stored("bt.volume", true));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [playUnit, setPlayUnit] = useState<"bar" | "candle">(stored("bt.playUnit", "candle"));
  const [draft, setDraft] = useState<Draft>(emptyDraft(100));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState("");
  const [snapVersion, setSnapVersion] = useState(String(Date.now()));
  const [viewer, setViewer] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [statsKey, setStatsKey] = useState(0);

  const chartRef = useRef<BtChartHandle>(null);
  const tailRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const playRef = useRef(false);
  const resetN = useRef(0);

  const session = sessions.find((s) => s.id === sid) ?? st?.session ?? null;

  const loadRefs = useCallback(() => {
    bt.instruments().then(setInstruments).catch(() => {});
    bt.sessions().then(setSessions).catch(() => {});
    bt.strategies().then(setStrategies).catch(() => {});
    bt.setups().then(setSetups).catch(() => {});
  }, []);
  useEffect(loadRefs, [loadRefs]);

  // Pick a session when none is selected (or the remembered one is gone).
  useEffect(() => {
    if (sessions.length && (sid === null || !sessions.some((s) => s.id === sid))) {
      setSid(sessions.find((s) => !s.archived)?.id ?? sessions[0].id);
    }
  }, [sessions]);

  useEffect(() => { store("bt.session", sid); }, [sid]);
  useEffect(() => { store("bt.tab", tab); }, [tab]);
  useEffect(() => { store("bt.playUnit", playUnit); }, [playUnit]);
  useEffect(() => { store("bt.vwap", showVwap); store("bt.bands", showBands); store("bt.volume", showVolume); }, [showVwap, showBands, showVolume]);

  // Apply a state payload from the server (full redraw or incremental tail).
  const apply = useCallback((s: BtState, reset: boolean) => {
    if (reset || !s.incremental) {
      setCandles(s.chart.candles);
      setVwap(s.chart.vwap);
      resetN.current += 1;
      setResetKey(`${s.session.id}-${s.tf}-${resetN.current}`);
    } else {
      setCandles((prev) => mergeTail(prev, s.chart.candles));
      setVwap((prev) => mergeTail(prev, s.chart.vwap));
    }
    tailRef.current = s.chart.tail_from ?? tailRef.current;
    setSt(s);
    setSessions((list) => list.map((x) => (x.id === s.session.id ? s.session : x)));
    if (s.message) setNote(s.message);
    if (s.events.length) {
      const parts = s.events.map((e) => `${e.reason === "stop" ? "Stopped out" : e.reason === "target" ? "Target hit" : "Closed"} ${money(e.net)}${e.r !== null ? ` (${e.r}R)` : ""}`);
      setNote(parts.join(" · "));
      // Save a picture of the chart at the exit for each closed trade.
      setTimeout(async () => {
        const png = await chartRef.current?.screenshot();
        if (!png) return;
        await Promise.all(s.events.map((e) => bt.uploadSnapshot(e.trade_id, png).catch(() => {})));
        setSnapVersion(String(Date.now()));
      }, 150);
      setStatsKey((k) => k + 1);
    }
  }, []);

  const run = useCallback(async (fn: () => Promise<BtState>, reset = false): Promise<BtState | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      const s = await fn();
      apply(s, reset);
      return s;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [apply]);

  // Full load on session / timeframe change.
  useEffect(() => {
    if (sid === null) return;
    setPlaying(false);
    tailRef.current = null;
    run(() => bt.state(sid, tf), true);
  }, [sid, tf]);

  // Use the session's last timeframe and risk when switching session.
  useEffect(() => {
    const s = sessions.find((x) => x.id === sid);
    if (s) {
      setTf(s.timeframe);
      setDraft(emptyDraft(s.risk_per_trade));
    }
  }, [sid, sessions.length]);

  const step = useCallback((mode: "bar" | "candle") => {
    if (sid === null) return Promise.resolve(null);
    return run(() => bt.step(sid, { tf, mode, since: tailRef.current }));
  }, [sid, tf, run]);

  // Play: one bar (finest data) or one chart candle per tick; pauses on an exit or at the end.
  useEffect(() => {
    playRef.current = playing;
    if (!playing) return;
    let cancelled = false;
    (async () => {
      while (playRef.current && !cancelled) {
        const s = await step(playUnit);
        if (!s || s.events.length || s.chart.at_end || s.message) { setPlaying(false); break; }
        await new Promise((r) => setTimeout(r, 1000 / speed));
      }
    })();
    return () => { cancelled = true; };
  }, [playing, speed, step, playUnit]);

  // Keyboard: → next bar, Shift+→ next candle, Space play/pause.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tab !== "replay" || ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); step(e.shiftKey ? "candle" : "bar"); }
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, step]);

  const price = st?.last.price ?? null;
  const openTrades = (st?.trades ?? []).filter((t) => t.status === "open");

  async function place() {
    if (sid === null || !session) return;
    const { qty } = sizeFor(draft, price, session);
    const s = await run(() => bt.order(sid, {
      direction: draft.side, qty,
      stop: draft.stop === "" ? null : Number(draft.stop),
      target: draft.target === "" ? null : Number(draft.target),
      setup: draft.setup, tf, since: tailRef.current,
    }));
    if (s) {
      setDraft({ ...draft, stop: "", target: "" });
      bt.setups().then(setSetups).catch(() => {});
      bt.strategies().then(setStrategies).catch(() => {});
    }
  }

  function closeTrade(t: BtTrade, qty?: number) {
    run(() => bt.closeTrade(t.id, { qty: qty ?? null, tf, since: tailRef.current }));
  }

  function patchTrade(tid: number, patch: { stop?: number | null; target?: number | null; setup?: string; notes?: string }) {
    run(() => bt.updateTrade(tid, { ...patch, tf, since: tailRef.current })).then((s) => {
      if (!s && sid !== null) run(() => bt.state(sid, tf, tailRef.current)); // put a rejected line back
      if (patch.setup !== undefined) bt.setups().then(setSetups).catch(() => {});
    });
  }

  function onLineDrag(id: string, p: number) {
    if (!session) return;
    const v = snap(p, session.tick_size);
    if (id === "draft-stop") return setDraft((d) => ({ ...d, stop: String(v) }));
    if (id === "draft-target") return setDraft((d) => ({ ...d, target: String(v) }));
    const m = /^t(\d+)-(stop|target)$/.exec(id);
    if (m) patchTrade(Number(m[1]), { [m[2]]: v });
  }

  const lines: ChartLine[] = useMemo(() => {
    const out: ChartLine[] = [];
    for (const l of st?.lines ?? []) {
      out.push({
        id: `t${l.trade_id}-${l.kind}`, price: l.price,
        color: l.kind === "stop" ? NEG : l.kind === "target" ? POS : "#9aa6b8",
        title: l.kind === "entry" ? `#${l.trade_id} entry` : `#${l.trade_id} ${l.kind === "stop" ? "SL" : "TP"}`,
        draggable: l.kind !== "entry",
      });
    }
    const n = (v: string) => (v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
    const ds = n(draft.stop), dt = n(draft.target);
    if (ds !== null) out.push({ id: "draft-stop", price: ds, color: NEG, title: "new SL", draggable: true, dashed: true });
    if (dt !== null) out.push({ id: "draft-target", price: dt, color: POS, title: "new TP", draggable: true, dashed: true });
    return out;
  }, [st?.lines, draft.stop, draft.target]);

  async function deleteSession() {
    if (!session) return;
    if (!confirm(`Delete backtest session "${session.name}" and its ${session.trades + session.open_trades} trades? This can't be undone.`)) return;
    await bt.deleteSession(session.id);
    setSid(null);
    setSt(null);
    loadRefs();
    setStatsKey((k) => k + 1);
  }

  async function toggleArchive() {
    if (!session) return;
    await bt.updateSession(session.id, { archived: !session.archived });
    loadRefs();
  }

  const snaps = (st?.trades ?? []).filter((t) => t.snapshot);
  const tz = st?.tz ?? "Asia/Kolkata";

  return (
    <div>
      <datalist id="bt-setups">{setups.map((s) => <option key={s} value={s} />)}</datalist>

      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Backtest</h1>
          <div className="flex p-1 bg-bg-soft rounded-lg">
            {(["replay", "dashboard"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-md text-xs font-medium ${tab === t ? "bg-card text-ink" : "text-ink-muted"}`}>
                {t === "replay" ? "Replay" : "Dashboard"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tab === "replay" && sessions.length > 0 && (
            <select className="input !w-auto !py-1.5" value={sid ?? ""} onChange={(e) => setSid(Number(e.target.value))}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.archived ? "[archived] " : ""}{s.name} · {s.trades} trades · {money(s.net)}
                </option>
              ))}
            </select>
          )}
          <button className="btn-ghost" onClick={() => setDataOpen(true)}>Market data</button>
          <button className="btn-primary" onClick={() => setNewOpen(true)}>+ New session</button>
        </div>
      </div>

      <p className="text-xs text-ink-faint -mt-2 mb-3">
        Practice only &mdash; backtest trades are stored separately and never appear in your journal, dashboard or reports.
      </p>

      {tab === "dashboard" ? (
        <BtDashboard sessions={sessions} strategies={strategies} refreshKey={statsKey} />
      ) : sessions.length === 0 ? (
        <div className="card p-10 text-center">
          <h2 className="text-lg font-semibold mb-1">Replay the market and practise your strategies</h2>
          <p className="text-sm text-ink-muted mb-4">
            1. Load history for ES, NQ, Gold or Crude &nbsp;·&nbsp; 2. Start a session from any date &nbsp;·&nbsp;
            3. Step candle by candle and Buy / Sell &nbsp;·&nbsp; 4. Compare strategies in the Dashboard.
          </p>
          <div className="flex justify-center gap-2">
            <button className="btn-ghost" onClick={() => setDataOpen(true)}>Market data</button>
            <button className="btn-primary" onClick={() => setNewOpen(true)}>+ New session</button>
          </div>
        </div>
      ) : session && (
        <>
          {/* Toolbar */}
          <div className="card p-2 mb-3 flex flex-wrap items-center gap-2">
            <div className="flex gap-0.5 bg-bg-soft rounded-lg p-0.5">
              {TIMEFRAMES.map((t) => (
                <button key={t} onClick={() => setTf(t)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono ${tf === t ? "bg-accent/30 text-ink" : "text-ink-muted hover:text-ink"}`}>
                  {t}
                </button>
              ))}
            </div>
            <span className="w-px h-6 bg-card-border" />
            <button className="btn-ghost !py-1 text-xs" disabled={busy || playing} onClick={() => step("bar")} title="Next bar (→)">
              ▶ Bar
            </button>
            <button className="btn-ghost !py-1 text-xs" disabled={busy || playing} onClick={() => step("candle")} title={`Next ${tf} candle (Shift+→)`}>
              ⏭ {tf} candle
            </button>
            <button className={`btn !py-1 text-xs ${playing ? "bg-warn/20 text-warn" : "bg-accent/20 text-accent-soft"}`}
              onClick={() => setPlaying((p) => !p)} title="Play / pause (Space)">
              {playing ? "❚❚ Pause" : "▶▶ Play"}
            </button>
            <select className="input !w-auto !py-1 text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s} / sec</option>)}
            </select>
            <select className="input !w-auto !py-1 text-xs" value={playUnit} title="What Play advances by"
              onChange={(e) => setPlayUnit(e.target.value as "bar" | "candle")}>
              <option value="candle">by {tf} candle</option>
              <option value="bar">by {st?.chart.step_base ?? "data"} bar</option>
            </select>
            <span className="w-px h-6 bg-card-border" />
            <input type="date" className="input !w-auto !py-1 text-xs" value={jumpTo} onChange={(e) => setJumpTo(e.target.value)} />
            <button className="btn-ghost !py-1 text-xs" disabled={!jumpTo || busy}
              onClick={() => sid !== null && run(() => bt.jump(sid, jumpTo, tf), true)}>
              Jump
            </button>
            <span className="w-px h-6 bg-card-border" />
            <Toggle on={showVwap} set={setShowVwap} label="VWAP" disabled={!INTRADAY.includes(tf)} />
            <Toggle on={showBands} set={setShowBands} label="±σ bands" disabled={!showVwap || !INTRADAY.includes(tf)} />
            <Toggle on={showVolume} set={setShowVolume} label="Volume" />
            <div className="ml-auto text-right text-xs leading-tight">
              <div className="text-ink-muted">Replay time</div>
              <div className="font-mono">{st ? formatDateTime(st.last.time, tz) : "—"}</div>
            </div>
          </div>

          {(err || note) && (
            <div className={`card px-3 py-2 mb-3 text-sm flex items-center justify-between ${err ? "text-neg" : "text-ink"}`}>
              <span>{err ?? note}</span>
              <button className="text-ink-faint hover:text-ink" onClick={() => { setErr(null); setNote(null); }}>&times;</button>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-3 mb-4">
            <div className="card p-0 overflow-hidden relative h-[560px]">
              <BtChart
                ref={chartRef}
                candles={candles}
                vwap={vwap}
                markers={st?.markers ?? []}
                lines={lines}
                showVwap={showVwap && INTRADAY.includes(tf)}
                showBands={showBands}
                showVolume={showVolume}
                intraday={INTRADAY.includes(tf)}
                tick={session.tick_size}
                resetKey={resetKey}
                onLineDrag={onLineDrag}
              />
              <div className="absolute top-2 left-3 text-xs pointer-events-none">
                <span className="font-mono font-semibold text-ink">{session.contract_label}</span>
                <span className="text-ink-faint"> · {tf}</span>
                {st?.chart.step_base && <span className="text-ink-faint"> · steps of {st.chart.step_base}</span>}
                {candles.length === 0 && (
                  <span className="text-warn"> · no data here — load history in Market data or jump to a covered date</span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="card p-3 grid grid-cols-3 gap-2 text-xs">
                <div><div className="text-ink-faint">Balance</div><div className="font-mono font-semibold">{money(st?.balance)}</div></div>
                <div><div className="text-ink-faint">Open P&amp;L</div><div className={`font-mono ${(st?.open_pnl ?? 0) >= 0 ? "text-pos" : "text-neg"}`}>{money(st?.open_pnl)}</div></div>
                <div><div className="text-ink-faint">Equity</div><div className="font-mono">{money(st?.equity)}</div></div>
              </div>
              <OrderTicket session={session} price={price} candles={candles} draft={draft} setDraft={setDraft} onPlace={place} busy={busy} />
              {openTrades.length > 0 && (
                <div className="card p-3 space-y-2">
                  <h3 className="text-sm font-medium">Open positions</h3>
                  {openTrades.map((t) => (
                    <div key={t.id} className="text-xs border border-card-border rounded-lg p-2">
                      <div className="flex justify-between">
                        <span className={t.direction === "long" ? "text-pos" : "text-neg"}>
                          #{t.id} {t.direction === "long" ? "Long" : "Short"} {t.remaining}{t.remaining !== t.qty ? `/${t.qty}` : ""} @ {t.entry_price}
                        </span>
                        <span className={`font-mono ${t.unrealized >= 0 ? "text-pos" : "text-neg"}`}>{money(t.unrealized)}</span>
                      </div>
                      <div className="text-ink-faint mt-0.5">SL {t.stop ?? "—"} · TP {t.target ?? "—"}{t.setup ? ` · ${t.setup}` : ""}</div>
                      <div className="flex gap-1 mt-1.5">
                        <button className="btn-ghost !py-0.5 !px-2 text-xs" disabled={busy} onClick={() => closeTrade(t)}>Close</button>
                        {t.remaining >= 2 && (
                          <button className="btn-ghost !py-0.5 !px-2 text-xs" disabled={busy} onClick={() => closeTrade(t, Math.floor(t.remaining / 2))}>Close ½</button>
                        )}
                        <button className="btn-ghost !py-0.5 !px-2 text-xs" disabled={busy} title="Move stop to the entry price"
                          onClick={() => patchTrade(t.id, { stop: t.entry_price })}>SL → BE</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="card p-3 text-xs text-ink-muted space-y-1">
                <div className="flex justify-between"><span>Strategy</span><span className="text-ink">{session.strategy}</span></div>
                <div className="flex justify-between"><span>Started</span><span>{formatDateTime(session.start_at, tz)}</span></div>
                <div className="flex justify-between"><span>Fees / contract (RT)</span><span>{money(session.fee_per_contract)}</span></div>
                <div className="flex gap-2 pt-1">
                  <button className="text-ink-faint hover:text-ink" onClick={toggleArchive}>{session.archived ? "Unarchive" : "Archive"}</button>
                  <button className="text-ink-faint hover:text-neg" onClick={deleteSession}>Delete session</button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="font-medium text-sm px-4 pt-3">Trades in this session</h3>
            <BtTradesTable
              trades={st?.trades ?? []}
              tz={tz}
              snapVersion={snapVersion}
              onPatch={(tid, p) => patchTrade(tid, p)}
              onDelete={async (tid) => {
                await bt.deleteTrade(tid);
                if (sid !== null) await run(() => bt.state(sid, tf), true);
                setStatsKey((k) => k + 1);
              }}
              onView={(tid) => setViewer(snaps.findIndex((t) => t.id === tid))}
            />
          </div>
          <p className="text-[11px] text-ink-faint mt-2">
            Keys: → next bar · Shift+→ next candle · Space play/pause. Fills: market orders at the last close; if one bar
            touches both stop and target, the stop is assumed first.
          </p>
        </>
      )}

      {viewer !== null && viewer >= 0 && snaps[viewer] && (
        <Lightbox images={snaps.map((t) => ({ src: bt.snapshotUrl(t.id, snapVersion), name: `#${t.id} ${t.direction} ${money(t.net)}` }))}
          index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
      {newOpen && (
        <NewSessionModal instruments={instruments} strategies={strategies}
          onClose={() => setNewOpen(false)}
          onOpenData={() => { setNewOpen(false); setDataOpen(true); }}
          onCreated={(s) => { setNewOpen(false); setSessions((l) => [s, ...l]); setSid(s.id); setTf(s.timeframe); setTab("replay"); loadRefs(); }} />
      )}
      {dataOpen && <DataModal instruments={instruments} onClose={() => setDataOpen(false)} onChanged={() => bt.instruments().then(setInstruments)} />}
    </div>
  );
}

function Toggle({ on, set, label, disabled }: { on: boolean; set: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={() => set(!on)}
      className={`btn !py-1 !px-2 text-xs ${disabled ? "opacity-40" : ""} ${on && !disabled ? "bg-warn/15 text-warn" : "bg-card-hover text-ink-faint"}`}>
      {label}
    </button>
  );
}
