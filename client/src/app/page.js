"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { useWebSocket } from "@/lib/useWebSocket";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";

const STATUS_VARIANT = {
  running: "bg-green-500/20 text-green-400 border-green-500/30",
  created: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ended: "bg-muted text-muted-foreground border-border",
  resolved: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  timeout: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  crashed: "bg-red-500/20 text-red-400 border-red-500/30",
};

const EVENT_LABELS = {
  bot_spawned: { icon: "🟢", label: "Bot Spawned" },
  bot_ended: { icon: "⏹", label: "Bot Ended" },
  bot_crashed: { icon: "💥", label: "Bot Crashed" },
  market_resolved: { icon: "🏁", label: "Market Resolved" },
  next_market: { icon: "➡", label: "Next Market" },
  info: { icon: "ℹ", label: "Info" },
  warn: { icon: "⚠", label: "Warning" },
  error: { icon: "✖", label: "Error" },
};

function StatusBadge({ status }) {
  const colors = STATUS_VARIANT[status] || STATUS_VARIANT.ended;
  return (
    <Badge variant="outline" className={`capitalize border ${colors}`}>
      {status}
    </Badge>
  );
}


function BotCard({ bot }) {
  const started = bot.runStartTime
    ? new Date(bot.runStartTime).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  const verdictResult = bot.verdict?.result ?? bot.verdict;
  const verdictColor =
    verdictResult === "WIN"
      ? "text-green-400"
      : verdictResult === "LOSS"
        ? "text-red-400"
        : "text-muted-foreground";


  return (
    <Link href={`/bots/${bot._id}`} className="group hover:scale-103 transition-all hover:shadow-primary hover:shadow-lg" >
      <Card className={`transition-all border-2 hover:border-primary hover:shadow-2xl shadow-primary rounded-2xl ${verdictResult==="WIN" ? "border-green-900/80" : verdictResult==="LOSS" ? "border-red-900/60" : "border-muted"}`}>
        <CardHeader>
          <div className="flex items-start gap-3 min-w-0">
            <Avatar size="lg" className="bg-secondary p-1" >
              <AvatarImage src={`https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(bot._id)}`} />
              <AvatarFallback>{(bot.name || "?").slice(0, 2)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              {bot.name && (
                <p className="text-sm font-bold text-secondary-foreground mb-1">{bot.name}</p>
              )}
              <CardTitle className="text-xs font-medium leading-snug line-clamp-2">
                {bot.question}
              </CardTitle>
            </div>
          </div>
          <CardAction>
            <StatusBadge status={bot.status} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">Technical Analysis</span>
              <p className="mt-0.5 font-medium">{bot.prediction || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Orders</span>
              <p className="mt-0.5 font-medium">{bot.orderCount || 0}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Started</span>
              <p className="mt-0.5 font-medium">{started}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Verdict</span>
              <p className={`mt-0.5 font-medium ${verdictColor}`}>
                {verdictResult || "—"}
                {bot.verdict?.reason && (
                  <span className="text-muted-foreground font-normal"> ({bot.verdict.reason})</span>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function formatEventTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventSummary(evt) {
  const d = evt.data || {};
  switch (evt.event) {
    case "bot_spawned":
      return `Bot#${d.botId} on ${d.slug} (${d.activeBots} active)`;
    case "bot_ended":
      return `Bot#${d.botId} — ${d.slug}`;
    case "bot_crashed":
      return `Bot#${d.botId} — ${d.error}`;
    case "market_resolved":
      return `${d.slug} → ${d.winner}`;
    case "next_market":
      return d.question || d.slug;
    case "info":
    case "warn":
    case "error":
      return d.message;
    default:
      return evt.event;
  }
}

function LiveFeed({ events, connected }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <Card className="flex h-full w-full flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Live Feed</CardTitle>
        <CardAction>
          <span className={`inline-flex items-center gap-1.5 text-xs ${connected ? "text-green-400" : "text-muted-foreground"}`}>
            <span className={`size-1.5 rounded-full ${connected ? "bg-green-400" : "bg-muted-foreground"}`} />
            {connected ? "Connected" : "Disconnected"}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto rounded-lg bg-black/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground"
        >
          {events.length === 0 && (
            <p className="text-muted-foreground/50">Waiting for events...</p>
          )}
          {events.map((evt, i) => {
            const meta = EVENT_LABELS[evt.event] || { icon: "·", label: evt.event };
            const isError = evt.event === "error" || evt.event === "bot_crashed";
            const isWarn = evt.event === "warn";
            const color = isError
              ? "text-red-400"
              : isWarn
                ? "text-yellow-400"
                : "text-muted-foreground";
            return (
              <div key={i} className={`py-0.5 ${color}`}>
                <span className="text-muted-foreground/50">{formatEventTime(evt.ts)}</span>{" "}
                <span>{meta.icon}</span>{" "}
                <span className="text-muted-foreground/70">{meta.label}</span>{" "}
                <span>{eventSummary(evt)}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const [bots, setBots] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { events, connected } = useWebSocket("orchestrator");
  const prevEventsLen = useRef(0);

  function refreshStats() {
    fetch("/api/stats")
      .then((res) => res.ok && res.json())
      .then((data) => data && setStats(data))
      .catch(() => {});
  }

  useEffect(() => {
    fetch("/api/bots")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch bots");
        return res.json();
      })
      .then(setBots)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    refreshStats();
  }, []);

  useEffect(() => {
    if (events.length <= prevEventsLen.current) {
      prevEventsLen.current = events.length;
      return;
    }
    prevEventsLen.current = events.length;

    const latest = events[events.length - 1];
    const refreshEvents = ["bot_spawned", "bot_ended", "bot_crashed", "bot_status", "market_resolved", "order_update"];
    if (refreshEvents.includes(latest?.event)) {
      fetch("/api/bots")
        .then((res) => res.ok && res.json())
        .then((data) => data && setBots(data))
        .catch(() => {});
    }
    if (latest?.event === "bot_status" && latest?.data?.status === "resolved") {
      refreshStats();
    }
    if (latest?.event === "market_resolved") {
      refreshStats();
    }
  }, [events]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 shrink-0  bg-background px-6 flex items-center justify-between h-22">
          <div className="flex items-center gap-12">
            <h1 className="text-3xl font-bold tracking-tight text-primary">Polybot</h1>
            {stats && (
              <div className="flex items-center gap-6">
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-[10px]">Won</span>
                  <span className="text-lg font-semibold text-green-400">{stats.WIN || 0}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-[10px]">Lost</span>
                  <span className="text-lg font-semibold text-red-400">{stats.LOSS || 0}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-[10px]">Skipped</span>
                  <span className="text-lg font-semibold text-secondary-foreground/80">{stats.SKIP}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-[10px]">Total Runs</span>
                  <span className="text-lg font-semibold text-secondary-foreground/80">{stats.botRuns}</span>
                </div>
                {stats.winRate !== null && (
                  <div className="flex flex-col">
                    <span className="text-muted-foreground text-[10px]">Win Rate</span>
                    <span className="text-lg font-semibold text-secondary-foreground/80">{stats.winRate}%</span>
                  </div>
                )}
                
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Link href="/strategies" className="text-xs text-muted-foreground hover:text-foreground transition-colors border border-border rounded-md px-2.5 py-1">
              Strategies
            </Link>
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <ScrollArea className="flex-1">
          {loading && (
            <p className="text-sm text-muted-foreground">Loading bots...</p>
          )}
          {error && (
            <p className="text-sm text-destructive">Error: {error}</p>
          )}
          {!loading && !error && bots.length === 0 && (
            <p className="text-sm text-muted-foreground">No bot runs found.</p>
          )}
          {!loading && !error && bots.length > 0 && (
            <div className="grid gap-4 sm:gap-6 lg:gap-8 xl:gap-10 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {bots.map((bot) => (
                <BotCard key={bot._id} bot={bot} />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* <aside className="hidden w-96 shrink-0 lg:flex p-4">
          <LiveFeed events={events} connected={connected} />
        </aside> */}
      </main>
    </div>
  );
}
