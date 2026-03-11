"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FiChevronLeft } from "react-icons/fi";
import { useWebSocket } from "@/lib/useWebSocket";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

const STATUS_VARIANT = {
  running: "bg-green-500/20 text-green-400 border-green-500/30",
  created: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ended: "bg-muted text-muted-foreground border-border",
  resolved: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  timeout: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  crashed: "bg-red-500/20 text-red-400 border-red-500/30",
  stopped: "bg-muted text-muted-foreground border-border",
};

function StatusBadge({ status }) {
  const colors = STATUS_VARIANT[status] || STATUS_VARIANT.ended;
  return (
    <Badge variant="outline" className={`capitalize border ${colors}`}>
      {status}
    </Badge>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function cents(v) {
  if (v == null) return "——";
  return `${Math.round(v * 100)}c`;
}

const ORDER_STATUS_COLORS = {
  pending: "text-yellow-400",
  live: "text-blue-400",
  LIVE: "text-blue-400",
  matched: "text-green-400",
  MATCHED: "text-green-400",
  placed: "text-blue-400",
  error: "text-red-400",
  REJECTED: "text-red-400",
  CANCELED: "text-muted-foreground",
  CANCELLED: "text-muted-foreground",
  EXPIRED: "text-muted-foreground",
};

function OrderStatusBadge({ status }) {
  const color = ORDER_STATUS_COLORS[status] || "text-muted-foreground";
  return <span className={color}>{status}</span>;
}

function mergeTriggerGroups(liveGroups, dbGroups) {
  if (!liveGroups?.length) return dbGroups || [];
  if (!dbGroups?.length) return liveGroups;
  return liveGroups.map((group, gi) => {
    const dbGroup = dbGroups[gi];
    if (!dbGroup) return group;
    const triggers = (group.triggers || []).map((t, ti) => {
      const dbTrigger = dbGroup.triggers?.[ti];
      return { ...t, fired: t.fired || dbTrigger?.fired || false };
    });
    const fired = group.fired || triggers.some((t) => t.fired);
    return { ...group, triggers, fired };
  });
}

function LiveState({ state, connected, dbOrders, dbStrategy }) {
  const logRef = useRef(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state?.logs?.length]);

  if (!state) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={state.status} />
          {state.countdown && (
            <span className="font-mono text-xs text-yellow-400">{state.countdown}</span>
          )}
          {state.verdict && (
            <>
              <span className={`text-sm font-bold ${state.verdict.result === "WIN" ? "text-green-400" : state.verdict.result === "LOSS" ? "text-red-400" : "text-muted-foreground"}`}>
                {state.verdict.result}
              </span>
              {state.verdict.pnl != null && state.verdict.pnl !== 0 && (
                <span className={`text-sm font-mono font-bold ${state.verdict.pnl > 0 ? "text-green-400" : "text-red-400"}`}>
                  {state.verdict.pnl > 0 ? "+" : ""}{state.verdict.pnl.toFixed(2)}
                </span>
              )}
              {state.verdict.reason && (
                <span className="text-xs text-muted-foreground">({state.verdict.reason})</span>
              )}
            </>
          )}
          {state.resolution && !state.verdict && (
            <span className={`text-sm font-bold ${state.resolution === "Up" ? "text-green-400" : "text-red-400"}`}>
              {state.resolution}
            </span>
          )}
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs ${connected ? "text-green-400 animate-pulse" : "text-muted-foreground"}`}>
          <span className={`size-1.5 rounded-full ${connected ? "bg-green-400" : "bg-muted-foreground"}`} />
          {connected ? "Live" : "Disconnected"}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 font-mono text-xs">
        {(state.livePrice != null || state.targetPrice != null) && (
          <Card size="sm" className="flex-row items-center gap-2 px-3 py-2">
            {state.targetPrice != null && (
              <>
                <span className="text-muted-foreground">Ref</span>
                <span className="text-foreground">{Number(state.targetPrice).toFixed(2)}</span>
              </>
            )}
            {state.livePrice != null && (
              <>
                <span className="text-muted-foreground">Live</span>
                <span className="font-bold text-cyan-400">{Number(state.livePrice).toFixed(2)}</span>
              </>
            )}
            {state.priceDiff != null && (
              <span className={state.priceDiff >= 0 ? "text-green-400" : "text-red-400"}>
                {state.priceDiff >= 0 ? "+" : ""}{Number(state.priceDiff).toFixed(2)}
              </span>
            )}
          </Card>
        )}
        {/* {state.pm?.upPrice != null && (
          <Card size="sm" className="flex-row items-center gap-2 px-3 py-2">
            <span className="text-muted-foreground">PM</span>
            <span className="text-green-400">Up {cents(state.pm.upPrice)}</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="text-red-400">Dn {cents(state.pm.downPrice)}</span>
          </Card>
        )} */}
        {state.sma?.upProb != null && (
          <Card size="sm" className="flex-row items-center gap-2 px-3 py-2">
            <span className="text-muted-foreground">SMA</span>
            <span className="text-green-400">Up {cents(state.sma.upProb)}</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="text-red-400">Dn {cents(state.sma.downProb)}</span>
            <span className="text-muted-foreground/50">({state.sma.samples})</span>
          </Card>
        )}
        {/* {state.bufferSize > 0 && (
          <Card size="sm" className="flex-row items-center gap-2 px-3 py-2">
            <span className="text-muted-foreground">Buffer</span>
            <span>{state.bufferSize} candles</span>
          </Card>
        )} */}
      </div>

      {(() => {
        const liveOrders = state.orders?.length > 0 ? state.orders : null;
        const fallbackOrders = !liveOrders && dbOrders?.length > 0
          ? dbOrders.map((o) => ({
              side: o.side,
              direction: o.direction,
              amount: o.amount,
              limit: o.limit,
              pmProb: o.pmProb,
              taDirection: o.taDirection,
              status: o.orderStatus ?? o.status,
              filledPrice: o.filledPrice,
              avgPrice: o.avgPrice,
              sizeMatched: o.sizeMatched,
              originalSize: o.originalSize ?? o.amount,
            }))
          : null;
        const orders = liveOrders || fallbackOrders;
        if (!orders) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-xs">Orders ({orders.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">Side</th>
                      <th className="pb-2 pr-4 font-medium">Direction</th>
                      <th className="pb-2 pr-4 font-medium">Amount</th>
                      <th className="pb-2 pr-4 font-medium">Limit</th>
                      <th className="pb-2 pr-4 font-medium">Filled</th>
                      <th className="pb-2 pr-4 font-medium">Matched</th>
                      <th className="pb-2 pr-4 font-medium">PM Prob</th>
                      <th className="pb-2 pr-4 font-medium">TA</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-2 pr-4">
                          <span className={o.side === "BUY" ? "text-green-400" : "text-red-400"}>{o.side}</span>
                          {o.isStopLoss && <span className="ml-1 text-[10px] text-orange-400 font-medium">SL</span>}
                        </td>
                        <td className="py-2 pr-4">{o.direction}</td>
                        <td className="py-2 pr-4 font-mono">{o.amount}</td>
                        <td className="py-2 pr-4 font-mono">{Math.round((o.limit || 0) * 100)}c</td>
                        <td className="py-2 pr-4 font-mono">
                          {o.avgPrice != null ? `${Math.round(o.avgPrice * 100)}c` : o.filledPrice != null ? `${Math.round(o.filledPrice * 100)}c` : "—"}
                        </td>
                        <td className="py-2 pr-4 font-mono">
                          {o.sizeMatched != null ? `${o.sizeMatched}/${o.originalSize ?? o.amount}` : "—"}
                        </td>
                        <td className="py-2 pr-4 font-mono">{cents(o.pmProb)}</td>
                        <td className="py-2 pr-4">{o.taDirection || "—"}</td>
                        <td className="py-2">
                          <OrderStatusBadge status={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {state.candle && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xs">Last Candle</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 font-mono text-xs">
              <span className="text-muted-foreground">O <span className="text-foreground">{state.candle.open}</span></span>
              <span className="text-muted-foreground">H <span className="text-foreground">{state.candle.high}</span></span>
              <span className="text-muted-foreground">L <span className="text-foreground">{state.candle.low}</span></span>
              <span className="text-muted-foreground">C <span className="font-bold text-foreground">{state.candle.close}</span></span>
              <span className="text-muted-foreground">V <span className="text-foreground">{state.candle.volume}</span></span>
            </div>
          </CardContent>
        </Card>
      )}

      {state.prediction && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xs">Technical Analysis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className={`font-bold ${state.prediction.direction === "UP" ? "text-green-400" : state.prediction.direction === "DOWN" ? "text-red-400" : "text-yellow-400"}`}>
                {state.prediction.direction}
              </span>
              <span className="text-xs text-muted-foreground">conviction: <span className="text-foreground">{state.prediction.conviction}%</span></span>
              <span className="text-xs text-muted-foreground">score: <span className="text-foreground">{state.prediction.score}</span></span>
              <span className="text-xs text-muted-foreground">lookback: <span className="text-foreground">{state.bufferSize} candles</span></span>
            </div>
            {state.prediction.breakdown?.length > 0 && (
              <div className="space-y-0.5 font-mono text-xs">
                {state.prediction.breakdown.map((ind, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="w-28 text-muted-foreground">{ind.name}</span>
                    <span className={`w-12 ${ind.signal === "BULL" ? "text-green-400" : ind.signal === "BEAR" ? "text-red-400" : "text-muted-foreground"}`}>{ind.signal}</span>
                    <span>{ind.value ?? "—"}</span>
                  </div>
                ))}
              </div>
            )}
            {state.prediction.stats && (
              <div className="text-xs text-muted-foreground">
                W/L: <span className="text-green-400">{state.prediction.stats.correct}</span>/<span className="text-red-400">{state.prediction.stats.wrong}</span>
                {state.prediction.stats.neutral > 0 && <span> ({state.prediction.stats.neutral} skipped)</span>}
                {" "}| Accuracy: <span className="text-foreground">{state.prediction.accuracy}%</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(() => {
        const groups = mergeTriggerGroups(state.strategy?.triggerGroups, dbStrategy?.triggerGroups);
        if (!groups?.length) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-xs">
                Trigger Groups ({groups.filter(g => g.fired).length}/{groups.length} fired)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {groups.map((group, gi) => (
                <div key={gi}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-muted-foreground">{group.label ?? `Group ${gi + 1}`}</span>
                    {group.fired
                      ? <span className="text-[10px] text-green-400 font-medium">FIRED</span>
                      : <span className="text-[10px] text-muted-foreground">waiting</span>}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">#</th>
                          <th className="pb-2 pr-4 font-medium">Outcome</th>
                          <th className="pb-2 pr-4 font-medium">TA</th>
                          <th className="pb-2 pr-4 font-medium">PM Threshold</th>
                          <th className="pb-2 pr-4 font-medium">Spread</th>
                          <th className="pb-2 pr-4 font-medium">Window</th>
                          <th className="pb-2 pr-4 font-medium">Side</th>
                          <th className="pb-2 pr-4 font-medium">Amount</th>
                          <th className="pb-2 pr-4 font-medium">Limit</th>
                          <th className="pb-2 pr-4 font-medium">Stop Loss</th>
                          <th className="pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(group.triggers || []).map((t, ti) => {
                          const start = t.windowStartMs != null ? `${t.windowStartMs / 1000}s` : "0s";
                          const end = t.windowEndMs != null ? `${t.windowEndMs / 1000}s` : "∞";
                          const dimmed = group.fired && !t.fired;
                          return (
                            <tr key={ti} className={`border-b border-border/50 ${dimmed ? "opacity-40" : ""}`}>
                              <td className="py-2 pr-4 text-muted-foreground">{ti + 1}</td>
                              <td className="py-2 pr-4">
                                <span className={t.outcome === "UP" ? "text-green-400" : "text-red-400"}>{t.outcome}</span>
                              </td>
                              <td className="py-2 pr-4">{t.taDirection ?? "any"}</td>
                              <td className="py-2 pr-4 font-mono">{t.pmThreshold != null ? `${Math.round(t.pmThreshold * 100)}c` : "—"}</td>
                              <td className="py-2 pr-4 font-mono">
                                {t.spreadThreshold != null
                                  ? <span className={t.spreadThreshold >= 0 ? "text-green-400" : "text-red-400"}>
                                      {t.spreadThreshold >= 0 ? ">" : "<"}{t.spreadThreshold}
                                    </span>
                                  : "—"}
                              </td>
                              <td className="py-2 pr-4 font-mono">{start}–{end}</td>
                              <td className="py-2 pr-4">
                                <span className={t.side === "BUY" ? "text-green-400" : "text-red-400"}>{t.side}</span>
                              </td>
                              <td className="py-2 pr-4 font-mono">{t.amount}</td>
                              <td className="py-2 pr-4 font-mono">{Math.round((t.limit || 0) * 100)}c</td>
                              <td className="py-2 pr-4 font-mono">{t.stopLoss != null ? <span className="text-orange-400">{Math.round(t.stopLoss * 100)}c</span> : "—"}</td>
                              <td className="py-2">
                                {t.fired
                                  ? <span className="text-green-400">Fired</span>
                                  : group.fired
                                    ? <span className="text-muted-foreground">Skipped</span>
                                    : <span className="text-muted-foreground">Waiting</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {gi < groups.length - 1 && (
                    <div className="text-center text-[10px] text-muted-foreground/60 italic mt-2">AND</div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })()}

      {state.logs?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xs">Logs ({state.logs.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              ref={logRef}
              className="max-h-64 overflow-y-auto rounded-lg bg-black/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground"
            >
              {state.logs.map((entry, i) => {
                const color = entry.level === "error" ? "text-red-400" : entry.level === "warn" ? "text-yellow-400" : "text-blue-400";
                const time = new Date(entry.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                return (
                  <div key={i} className={`py-0.5 ${color}`}>
                    <span className="text-muted-foreground/50">{time}</span> {entry.msg}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RawJsonView({ data }) {
  return (
    <div className="overflow-auto rounded-lg bg-black/50 p-4 font-mono text-xs leading-relaxed text-muted-foreground">
      <pre className="whitespace-pre-wrap break-all">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function ViewToggle({ view, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-border text-xs">
      <button
        onClick={() => onChange("ui")}
        className={`px-3 py-1.5 rounded-l-md transition-colors text-bold ${view === "ui" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        UI
      </button>
      <button
        onClick={() => onChange("json")}
        className={`px-3 py-1.5 rounded-r-md border-l border-border transition-colors ${view === "json" ? "bg-accent text-background" : "text-muted-foreground hover:text-foreground"}`}
      >
        JSON
      </button>
    </div>
  );
}

export default function BotDetail() {
  const { botId } = useParams();
  const [bot, setBot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState("ui");

  useEffect(() => {
    fetch(`/api/bots/${botId}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Bot not found" : "Failed to fetch bot");
        return res.json();
      })
      .then(setBot)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [botId]);

  const { events, connected } = useWebSocket(`bot:${botId}`);

  const latestState = events.length > 0 ? events[events.length - 1]?.data : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to dashboard
        </Link>
      </div>
    );
  }

  const isLive = (bot.status === "running" || bot.status === "ended") && latestState;
  const jsonData = isLive ? latestState : bot;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 flex items-center justify-between h-22">
        <div className="flex items-center gap-4 min-w-0">
          <Link href="/" className="inline-flex border border-border rounded-md p-1 items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <FiChevronLeft className="size-4" />
          </Link>
          <Avatar size="lg" className="bg-secondary p-1" >
            <AvatarImage src={`https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(bot._id)}`} />
            <AvatarFallback>{(bot.name || "?").slice(0, 2)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            {bot.name && (
              <p className="text-sm font-medium text-muted-foreground mb-1">{bot.name}</p>
            )}
            <h1 className="text-lg font-bold tracking-tight leading-snug">
              {bot.question}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle view={view} onChange={setView} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {view === "json" ? (
          <RawJsonView data={jsonData} />
        ) : isLive ? (
          <LiveState state={latestState} connected={connected} dbOrders={bot.orders} dbStrategy={bot.strategy} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <StatusBadge status={bot.status} />
              {bot.verdict && (
                <>
                  <span className={`text-sm font-bold ${bot.verdict.result === "WIN" ? "text-green-400" : bot.verdict.result === "LOSS" ? "text-red-400" : "text-muted-foreground"}`}>
                    {bot.verdict.result}
                  </span>
                  {bot.verdict.pnl != null && bot.verdict.pnl !== 0 && (
                    <span className={`text-sm font-mono font-bold ${bot.verdict.pnl > 0 ? "text-green-400" : "text-red-400"}`}>
                      {bot.verdict.pnl > 0 ? "+" : ""}{bot.verdict.pnl.toFixed(2)}
                    </span>
                  )}
                  {bot.verdict.reason && (
                    <span className="text-xs text-muted-foreground">({bot.verdict.reason})</span>
                  )}
                </>
              )}
              {bot.resolution && (
                <span className={`text-sm font-bold ${bot.resolution === "Up" ? "text-green-400" : "text-red-400"}`}>
                  {bot.resolution}
                </span>
              )}
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  <Field label="Market" value={bot.market} />
                  <Field label="Technical Analysis" value={bot.prediction} />
                  <Field label="Resolution" value={bot.resolution} />
                  <Field label="Verdict" value={bot.verdict ? `${bot.verdict.result}${bot.verdict.reason ? ` (${bot.verdict.reason})` : ""}` : null} />
                  {bot.verdict?.pnl != null && <Field label="P&L" value={`${bot.verdict.pnl > 0 ? "+" : ""}${bot.verdict.pnl.toFixed(4)}`} />}
                  {bot.verdict?.positionSize != null && <Field label="Position Size" value={bot.verdict.positionSize} />}
                  {bot.verdict?.avgPrice != null && <Field label="Avg Price" value={`${Math.round(bot.verdict.avgPrice * 100)}c`} />}
                  <Field label="Run Started" value={formatDate(bot.runStartTime)} />
                  <Field label="Run Ended" value={formatDate(bot.runEndTime)} />
                  <Field label="Market Start" value={formatDate(bot.marketStartTime)} />
                  <Field label="Market End" value={formatDate(bot.marketEndTime)} />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Orders ({bot.orders?.length || 0})</CardTitle>
              </CardHeader>
              <CardContent>
                {bot.orders?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Side</th>
                          <th className="pb-2 pr-4 font-medium">Direction</th>
                          <th className="pb-2 pr-4 font-medium">Amount</th>
                          <th className="pb-2 pr-4 font-medium">Limit</th>
                          <th className="pb-2 pr-4 font-medium">Filled Price</th>
                          <th className="pb-2 pr-4 font-medium">Matched</th>
                          <th className="pb-2 pr-4 font-medium">PM Prob</th>
                          <th className="pb-2 pr-4 font-medium">TA</th>
                          <th className="pb-2 pr-4 font-medium">Status</th>
                          <th className="pb-2 font-medium">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bot.orders.map((order) => (
                          <tr key={order._id} className="border-b border-border/50">
                            <td className="py-2.5 pr-4">
                              <span className={order.side === "BUY" ? "text-green-400" : "text-red-400"}>
                                {order.side}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4">{order.direction || "—"}</td>
                            <td className="py-2.5 pr-4 font-mono">{order.amount ?? "—"}</td>
                            <td className="py-2.5 pr-4 font-mono">
                              {order.limit != null ? `${Math.round(order.limit * 100)}c` : "—"}
                            </td>
                            <td className="py-2.5 pr-4 font-mono">
                              {order.avgPrice != null
                                ? `${Math.round(order.avgPrice * 100)}c`
                                : order.filledPrice != null
                                  ? `${Math.round(order.filledPrice * 100)}c`
                                  : "—"}
                            </td>
                            <td className="py-2.5 pr-4 font-mono">
                              {order.sizeMatched != null
                                ? `${order.sizeMatched}/${order.originalSize ?? order.amount}`
                                : "—"}
                            </td>
                            <td className="py-2.5 pr-4 font-mono">
                              {order.pmProb != null ? `${(order.pmProb * 100).toFixed(1)}%` : "—"}
                            </td>
                            <td className="py-2.5 pr-4">{order.taDirection || "—"}</td>
                            <td className="py-2.5 pr-4">
                              <OrderStatusBadge status={order.orderStatus} />
                            </td>
                            <td className="py-2.5">{formatDate(order.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No orders placed.</p>
                )}
              </CardContent>
            </Card>

            {bot.triggerGroups?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Trigger Groups ({bot.triggerGroups.filter(g => g.fired).length}/{bot.triggerGroups.length} fired)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {bot.triggerGroups.map((group, gi) => (
                    <div key={gi}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-muted-foreground">{group.label ?? `Group ${gi + 1}`}</span>
                        {group.fired
                          ? <span className="text-[10px] text-green-400 font-medium">FIRED</span>
                          : <span className="text-[10px] text-muted-foreground">waiting</span>}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b text-muted-foreground">
                              <th className="pb-2 pr-4 font-medium">#</th>
                              <th className="pb-2 pr-4 font-medium">Outcome</th>
                              <th className="pb-2 pr-4 font-medium">TA</th>
                              <th className="pb-2 pr-4 font-medium">PM Threshold</th>
                              <th className="pb-2 pr-4 font-medium">Spread</th>
                              <th className="pb-2 pr-4 font-medium">Window</th>
                              <th className="pb-2 pr-4 font-medium">Side</th>
                              <th className="pb-2 pr-4 font-medium">Amount</th>
                              <th className="pb-2 pr-4 font-medium">Limit</th>
                              <th className="pb-2 pr-4 font-medium">Stop Loss</th>
                              <th className="pb-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(group.triggers || []).map((t, ti) => {
                              const start = t.windowStartMs != null ? `${t.windowStartMs / 1000}s` : "0s";
                              const end = t.windowEndMs != null ? `${t.windowEndMs / 1000}s` : "∞";
                              const dimmed = group.fired && !t.fired;
                              return (
                                <tr key={ti} className={`border-b border-border/50 ${dimmed ? "opacity-40" : ""}`}>
                                  <td className="py-2 pr-4 text-muted-foreground">{ti + 1}</td>
                                  <td className="py-2 pr-4">
                                    <span className={t.outcome === "UP" ? "text-green-400" : "text-red-400"}>{t.outcome}</span>
                                  </td>
                                  <td className="py-2 pr-4">{t.taDirection ?? "any"}</td>
                                  <td className="py-2 pr-4 font-mono">{t.pmThreshold != null ? `${Math.round(t.pmThreshold * 100)}c` : "—"}</td>
                                  <td className="py-2 pr-4 font-mono">
                                    {t.spreadThreshold != null
                                      ? <span className={t.spreadThreshold >= 0 ? "text-green-400" : "text-red-400"}>
                                          {t.spreadThreshold >= 0 ? ">" : "<"}{t.spreadThreshold}
                                        </span>
                                      : "—"}
                                  </td>
                                  <td className="py-2 pr-4 font-mono">{start}–{end}</td>
                                  <td className="py-2 pr-4">
                                    <span className={t.side === "BUY" ? "text-green-400" : "text-red-400"}>{t.side}</span>
                                  </td>
                                  <td className="py-2 pr-4 font-mono">{t.amount}</td>
                                  <td className="py-2 pr-4 font-mono">{Math.round((t.limit || 0) * 100)}c</td>
                                  <td className="py-2 pr-4 font-mono">{t.stopLoss != null ? <span className="text-orange-400">{Math.round(t.stopLoss * 100)}c</span> : "—"}</td>
                                  <td className="py-2">
                                    {t.fired
                                      ? <span className="text-green-400">Fired</span>
                                      : group.fired
                                        ? <span className="text-muted-foreground">Skipped</span>
                                        : <span className="text-muted-foreground">Waiting</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {gi < bot.triggerGroups.length - 1 && (
                        <div className="text-center text-[10px] text-muted-foreground/60 italic mt-2">AND</div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {bot.logs?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Logs ({bot.logs.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-80 overflow-y-auto rounded-lg bg-black/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                    {bot.logs.map((entry, i) => {
                      const color = entry.level === "error" ? "text-red-400" : entry.level === "warn" ? "text-yellow-400" : "text-blue-400";
                      const time = new Date(entry.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                      return (
                        <div key={i} className={`py-0.5 ${color}`}>
                          <span className="text-muted-foreground/50">{time}</span> {entry.msg}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {bot.log?.length > 0 && !bot.logs?.length && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Log ({bot.log.length} entries)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-80 overflow-y-auto rounded-lg bg-black/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                    {bot.log.map((line, i) => (
                      <div key={i} className="py-0.5">{line}</div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
