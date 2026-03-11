"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { useWebSocket } from "@/lib/useWebSocket";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { FaSkull } from "react-icons/fa";
import { RiRobot2Fill } from "react-icons/ri";
import { BarChart3, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";


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


const TWITCH_VARIANTS = ["idle-twitch", "idle-twitch-alt", "idle-twitch-late"];

function idleStyle(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const n = Math.abs(h);
  return {
    "--idle-bob": `${2.8 + (n % 17) * 0.1}s`,
    "--idle-tilt": `${3.6 + ((n >> 4) % 19) * 0.1}s`,
    "--idle-breathe": `${4.5 + ((n >> 8) % 23) * 0.1}s`,
    "--idle-delay-bob": `-${(n % 30) * 0.1}s`,
    "--idle-delay-tilt": `-${((n >> 5) % 40) * 0.1}s`,
    "--idle-delay-breathe": `-${((n >> 10) % 50) * 0.1}s`,
    "--idle-twitch": TWITCH_VARIANTS[n % 3],
    "--idle-twitch-dur": `${6 + ((n >> 3) % 9)}s`,
    "--idle-delay-twitch": `-${((n >> 7) % 60) * 0.1}s`,
  };
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

  const ended = bot.runEndTime
    ? new Date(bot.runEndTime).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  const avatarIdle = useMemo(() => idleStyle(bot._id), [bot._id]);

  return (
    <Link href={`/bots/${bot._id}`} className="group hover:scale-103 transition-all group" >
      <Card className={`transition-all border-2 group-hover:border-primary rounded-2xl ${verdictResult==="WIN" ? "border-green-900/80" : verdictResult==="LOSS" ? "border-red-900/60" : "border-muted"}`}>
        <CardHeader>
          <div className="flex items-start gap-3 min-w-0">
            <Avatar size="lg" className="overflow-hidden bg-secondary p-1 flex items-center justify-center">
              {(bot.verdict?.result) === "LOSS" ? (
                <FaSkull className="w-6 h-6 text-muted-foreground/60" style={{ rotate: `${(Math.abs(bot._id.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 31) - 15}deg` }} />
              ) : (
                <>
                  <AvatarImage className="animate-idle" style={avatarIdle} src={`https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(bot._id)}`} />
                  <AvatarFallback>{(bot.name || "?").slice(0, 2)}</AvatarFallback>
                </>
              )}
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
            <div className={`${bot.status === "running" ? "animate-pulse" : ""}`}>
              <StatusBadge status={bot.status} />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">Technical Analysis</span>
              <p className="mt-0.5 font-medium">{(typeof bot.prediction === "object" ? bot.prediction?.direction : bot.prediction) || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Orders</span>
              <p className="mt-0.5 font-medium">{bot.orderCount || 0}</p>
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
            <div>
              <span className="text-muted-foreground">Started</span>
              <p className="mt-0.5 font-medium">{started}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Ended</span>
              <p className="mt-0.5 font-medium">{ended}</p>
            </div>
            {bot.verdict?.pnl != null && bot.verdict.pnl !== 0 && (
              <div>
                <span className="text-muted-foreground">P&L</span>
                <p className={`mt-0.5 font-mono font-medium ${bot.verdict.pnl > 0 ? "text-green-400" : "text-red-400"}`}>
                  {bot.verdict.pnl > 0 ? "+" : ""}{bot.verdict.pnl.toFixed(2)}
                  {bot.verdict.positionSize > 0 && bot.verdict.avgPrice > 0 && (
                    <span className="text-muted-foreground font-normal"> ({((bot.verdict.pnl / (bot.verdict.positionSize * bot.verdict.avgPrice)) * 100).toFixed(1)}%)</span>
                  )}
                </p>
              </div>
            )}
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

const VERDICT_FILTERS = [
  { key: "all", label: "All" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "other", label: "Other" },
];

export default function Home() {
  const [bots, setBots] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [verdictFilter, setVerdictFilter] = useState("all");
  const { events, connected } = useWebSocket("orchestrator");
  const prevEventsLen = useRef(0);

  function fetchBots(verdict) {
    const params = verdict && verdict !== "all" ? `?verdict=${verdict}` : "";
    return fetch(`/api/bots${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch bots");
        return res.json();
      });
  }

  function refreshStats() {
    fetch("/api/stats")
      .then((res) => res.ok && res.json())
      .then((data) => data && setStats(data))
      .catch(() => {});
  }

  useEffect(() => {
    setLoading(true);
    fetchBots(verdictFilter)
      .then(setBots)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    refreshStats();
  }, [verdictFilter]);

  useEffect(() => {
    if (events.length <= prevEventsLen.current) {
      prevEventsLen.current = events.length;
      return;
    }
    prevEventsLen.current = events.length;

    const latest = events[events.length - 1];
    const refreshEvents = ["bot_spawned", "bot_ended", "bot_crashed", "bot_status", "market_resolved", "order_update"];
    if (refreshEvents.includes(latest?.event)) {
      fetchBots(verdictFilter)
        .then((data) => data && setBots(data))
        .catch(() => {});
    }
    if (latest?.event === "bot_status" && latest?.data?.status === "resolved") {
      refreshStats();
    }
    if (latest?.event === "market_resolved") {
      refreshStats();
    }
  }, [events, verdictFilter]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 flex items-center justify-between h-22">
          <div className="flex items-center gap-12">
            <div className="flex items-center gap-1">
              <RiRobot2Fill className="animate-idle w-8 h-8 text-primary mb-1" style={{ "--idle-bob": "3.2s", "--idle-tilt": "4.1s", "--idle-breathe": "5.3s", "--idle-delay-bob": "-1.2s", "--idle-delay-tilt": "-2.7s", "--idle-delay-breathe": "-0.8s", "--idle-twitch": "idle-twitch-alt", "--idle-twitch-dur": "9s", "--idle-delay-twitch": "-3.5s" }} />
              <h1 className="text-3xl font-bold tracking-tight text-primary">Polybot</h1>
            </div>
            
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
                {stats.totalPnl != null && (
                  <div className="flex flex-col">
                    <span className="text-muted-foreground text-[10px]">P&L</span>
                    <span className={`text-lg font-semibold font-mono ${stats.totalPnl > 0 ? "text-green-400" : stats.totalPnl < 0 ? "text-red-400" : "text-secondary-foreground/80"}`}>
                      {stats.totalPnl > 0 ? "+" : ""}{stats.totalPnl.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
              {VERDICT_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setVerdictFilter(f.key)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    verdictFilter === f.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div> */}
            <Button variant="outline" size="lg" asChild>
              <Link href="/stats" className="flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Statistics</Link>
            </Button>
            
            <Button variant="outline" size="lg" asChild>
              <Link href="/strategies" className="flex items-center gap-2"><Settings2 className="w-4 h-4" /> Strategies</Link>
            </Button>
        </div>
      </header>

      <main>
          {loading && (
            <p className="text-sm text-muted-foreground p-4">Loading bots...</p>
          )}
          {error && (
            <p className="text-sm text-destructive p-4">Error: {error}</p>
          )}
          {!loading && !error && bots.length === 0 && (
            <p className="text-sm text-muted-foreground p-4">No bot runs found.</p>
          )}
          {!loading && !error && bots.length > 0 && (
            <div className="grid gap-4 sm:gap-6 lg:gap-8 xl:gap-10 p-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {bots.map((bot) => (
                <BotCard key={bot._id} bot={bot} />
              ))}
            </div>
          )}
      </main>
    </div>
  );
}
