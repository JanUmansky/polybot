"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  LineChart,
  Line,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Trophy,
  Target,
  Clock,
  Zap,
  Scale,
  Flame,
  Activity,
  DollarSign,
  BarChart3,
  Telescope,
  Wallet,
  ArrowUpDown,
  Percent,
} from "lucide-react";
import { FiChevronLeft } from "react-icons/fi";

const VALUE_SIZE = {
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
  "4xl": "text-4xl",
};

function StatCard({ title, value, valueSize = "2xl", subtitle, icon: Icon, trend, className = "" }) {
  const trendColor =
    trend === "positive"
      ? "text-green-400"
      : trend === "negative"
        ? "text-red-400"
        : "text-muted-foreground";

  return (
    <Card className={`relative overflow-hidden ${className}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardDescription className="text-xs font-medium">{title}</CardDescription>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className={`${VALUE_SIZE[valueSize] || "text-2xl"} font-bold tabular-nums ${trendColor}`}>
          {value}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHour(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
  });
}

const cumulativeChartConfig = {
  cumulativeNet: {
    label: "Cumulative W-L",
    color: "var(--chart-1)",
  },
};

const pnlChartConfig = {
  pnl: {
    label: "P&L",
    color: "var(--chart-3)",
  },
  cumulativePnl: {
    label: "Cumulative P&L",
    color: "var(--chart-1)",
  },
};

const hourlyChartConfig = {
  wins: {
    label: "Wins",
    color: "#05df72",
  },
  losses: {
    label: "Losses",
    color: "#ff6467",
  },
};

export default function StatsPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch stats");
        return res.json();
      })
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground animate-pulse">Loading statistics...</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-destructive">Failed to load statistics</p>
      </div>
    );
  }

  const wins = stats.WIN || 0;
  const losses = stats.LOSS || 0;
  const streakLabel =
    stats.currentStreak > 0
      ? `${stats.currentStreak}W`
      : stats.currentStreak < 0
        ? `${Math.abs(stats.currentStreak)}L`
        : "—";
  const streakTrend =
    stats.currentStreak > 0
      ? "positive"
      : stats.currentStreak < 0
        ? "negative"
        : undefined;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 h-22 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-between px-6 border-b border-border/20">
          <div className="flex items-center gap-4">
            <Link href="/" className="inline-flex border-r border-border pr-4 items-center  text-xs text-muted-foreground hover:text-foreground transition-colors self-stretch">
              <FiChevronLeft className="size-4" />
              Back
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-primary">Statistics</h1>
          </div>
          <div className="flex items-center gap-4">
            {stats.totalPnl != null && (
              <div className="flex flex-col ">
                <span className="text-xs text-muted-foreground">Total P&L</span>
                <span
                  className={`text-2xl font-bold font-mono ${stats.totalPnl > 0 ? "text-green-400" : stats.totalPnl < 0 ? "text-red-400" : "text-muted-foreground"}`}
                >
                  {stats.totalPnl > 0 ? "+" : ""}
                  {stats.totalPnl.toFixed(2)}
                </span>
              </div>
            )}
          </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {/* Overview Cards */}
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-4">Overview</h2>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
            <StatCard
              title="Wins"
              value={wins}
              icon={Trophy}
              valueSize="3xl"
              trend="positive"
            />
            <StatCard
              title="Losses"
              value={losses}
              icon={TrendingDown}
              valueSize="3xl"
              trend="negative"
            />
            <StatCard
              title="Win Rate"
              value={stats.winRate ? `${stats.winRate}%` : "—"}
              subtitle={`${wins + losses} resolved`}
              icon={Target}
              valueSize="3xl"
            />
            <StatCard
              title="Skipped"
              value={stats.SKIP || 0}
              icon={Activity}
              valueSize="3xl"
            />
            <StatCard
              title="Total Runs"
              value={stats.botRuns}
              icon={Zap}
              valueSize="3xl"
            />
            <StatCard
              title="Win / Loss"
              value={<><span className="text-green-400">{wins}</span><span className="text-muted-foreground/40"> / </span><span className="text-red-400">{losses}</span></>}
              icon={Scale}
              valueSize="3xl"
            />
          </div>
        </section>

        {/* Detailed Metrics */}
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-4">
            Detailed Metrics
          </h2>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            <StatCard
              title="Avg Win Size"
              value={
                stats.avgWinSize
                  ? `+${stats.avgWinSize.toFixed(2)}`
                  : "—"
              }
              subtitle="Average profit per win"
              icon={TrendingUp}
              trend="positive"
            />
            <StatCard
              title="Avg Loss Size"
              value={
                stats.avgLossSize
                  ? stats.avgLossSize.toFixed(2)
                  : "—"
              }
              subtitle="Average loss per loss"
              icon={TrendingDown}
              trend="negative"
            />
            <StatCard
              title="Expectancy"
              value={
                stats.expectancy != null
                  ? `${stats.expectancy > 0 ? "+" : ""}${stats.expectancy.toFixed(4)}`
                  : "—"
              }
              subtitle="Expected P&L per trade"
              icon={Scale}
              trend={
                stats.expectancy > 0
                  ? "positive"
                  : stats.expectancy != null && stats.expectancy < 0
                    ? "negative"
                    : undefined
              }
            />
            <StatCard
              title="Profit Factor"
              value={
                stats.profitFactor != null
                  ? stats.profitFactor.toFixed(2)
                  : "—"
              }
              subtitle="Total $ won / total $ lost"
              icon={BarChart3}
              trend={
                stats.profitFactor > 1
                  ? "positive"
                  : stats.profitFactor != null && stats.profitFactor < 1
                    ? "negative"
                    : undefined
              }
            />
            <StatCard
              title="Wins / Hour"
              value={stats.winsPerHour ?? "—"}
              subtitle={`Over ${stats.totalHours}h`}
              icon={Clock}
              trend="positive"
            />
            <StatCard
              title="Losses / Hour"
              value={stats.lossesPerHour ?? "—"}
              subtitle={`Over ${stats.totalHours}h`}
              icon={Clock}
              trend="negative"
            />
            <StatCard
              title="Best Trade"
              value={
                stats.maxPnl
                  ? `+${stats.maxPnl.toFixed(2)}`
                  : "—"
              }
              icon={TrendingUp}
              trend="positive"
            />
            <StatCard
              title="Worst Trade"
              value={stats.minPnl ? stats.minPnl.toFixed(2) : "—"}
              icon={TrendingDown}
              trend="negative"
            />
          </div>
        </section>

        {/* Streaks */}
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-4">Streaks</h2>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
            <StatCard
              title="Current Streak"
              value={streakLabel}
              icon={Flame}
              trend={streakTrend}
            />
            <StatCard
              title="Max Win Streak"
              value={stats.maxWinStreak}
              icon={Trophy}
              trend="positive"
            />
            <StatCard
              title="Max Loss Streak"
              value={stats.maxLossStreak}
              icon={TrendingDown}
              trend="negative"
            />
          </div>
        </section>

        {/* 24h Projections */}
        {stats.projections && stats.totalHours > 0 && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-4">
              24h Projections
              <span className="ml-2 text-[10px] text-muted-foreground/60 font-normal">based on {stats.totalHours}h of data</span>
            </h2>
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              <StatCard
                title="Expected Trades"
                value={stats.projections.trades}
                subtitle={`${stats.projections.wins} wins / ${stats.projections.losses} losses`}
                icon={ArrowUpDown}
              />
              <StatCard
                title="Gross Profit"
                value={
                  stats.projections.grossProfit > 0
                    ? `+${stats.projections.grossProfit.toFixed(2)}`
                    : "—"
                }
                subtitle={`From ~${stats.projections.wins} winning trades`}
                icon={TrendingUp}
                trend="positive"
              />
              <StatCard
                title="Gross Loss"
                value={
                  stats.projections.grossLoss > 0
                    ? `-${stats.projections.grossLoss.toFixed(2)}`
                    : "—"
                }
                subtitle={`From ~${stats.projections.losses} losing trades`}
                icon={TrendingDown}
                trend="negative"
              />
              <StatCard
                title="Net P&L"
                value={`${stats.projections.netPnl > 0 ? "+" : ""}${stats.projections.netPnl.toFixed(2)}`}
                subtitle="Projected profit after losses"
                icon={DollarSign}
                trend={
                  stats.projections.netPnl > 0
                    ? "positive"
                    : stats.projections.netPnl < 0
                      ? "negative"
                      : undefined
                }
              />
              <StatCard
                title="Avg Cost Per Trade"
                value={
                  stats.projections.avgInvestmentPerTrade > 0
                    ? `$${stats.projections.avgInvestmentPerTrade.toFixed(2)}`
                    : "—"
                }
                subtitle="Recycled each trade"
                icon={Wallet}
              />
              <StatCard
                title="Min Balance"
                value={
                  stats.projections.minBalance > 0
                    ? `$${stats.projections.minBalance.toFixed(2)}`
                    : "—"
                }
                subtitle={`Covers ${stats.projections.maxConsecutiveLosses} consecutive losses`}
                icon={Wallet}
              />
              {stats.projections.roi != null && (
                <StatCard
                  title="24h ROI"
                  value={`${stats.projections.roi > 0 ? "+" : ""}${stats.projections.roi}%`}
                  subtitle="Net P&L vs min balance"
                  icon={Percent}
                  trend={
                    stats.projections.roi > 0
                      ? "positive"
                      : stats.projections.roi < 0
                        ? "negative"
                        : undefined
                  }
                />
              )}
            </div>
          </section>
        )}

        {/* Charts */}
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-4">Charts</h2>

          <Tabs defaultValue="cumulative" className="space-y-4">
            <TabsList>
              <TabsTrigger value="cumulative">Win-Loss Curve</TabsTrigger>
              <TabsTrigger value="pnl">P&L Over Time</TabsTrigger>
              <TabsTrigger value="hourly">Hourly Breakdown</TabsTrigger>
            </TabsList>

            <TabsContent value="cumulative">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Cumulative Wins − Losses
                  </CardTitle>
                  <CardDescription>
                    Each point is a resolved position. Upward = win, downward = loss.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {stats.timeline?.length > 0 ? (
                    <ChartContainer
                      config={cumulativeChartConfig}
                      className="h-[350px] w-full"
                    >
                      <AreaChart data={stats.timeline}>
                        <defs>
                          <linearGradient
                            id="cumNetGrad"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="var(--color-cumulativeNet)"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor="var(--color-cumulativeNet)"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-border/30"
                        />
                        <XAxis
                          dataKey="time"
                          tickFormatter={formatTime}
                          tick={{ fontSize: 11 }}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={{ fontSize: 11 }} />
                        <ReferenceLine y={0} stroke="hsl(var(--border))" />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(v) => formatTime(v)}
                            />
                          }
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                        <Area
                          type="monotone"
                          dataKey="cumulativeNet"
                          stroke="var(--color-cumulativeNet)"
                          fill="url(#cumNetGrad)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ChartContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground py-12 text-center">
                      No resolved positions yet
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="pnl">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">P&L Over Time</CardTitle>
                  <CardDescription>
                    Cumulative profit and loss curve
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {stats.hourlyData?.length > 0 ? (
                    <ChartContainer
                      config={pnlChartConfig}
                      className="h-[350px] w-full"
                    >
                      <LineChart data={stats.hourlyData}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-border/30"
                        />
                        <XAxis
                          dataKey="hour"
                          tickFormatter={formatHour}
                          tick={{ fontSize: 11 }}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={{ fontSize: 11 }} />
                        <ReferenceLine y={0} stroke="hsl(var(--border))" />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(v) => formatHour(v)}
                            />
                          }
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                        <Line
                          type="monotone"
                          dataKey="cumulativePnl"
                          stroke="var(--color-cumulativePnl)"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="pnl"
                          stroke="var(--color-pnl)"
                          strokeWidth={1}
                          strokeDasharray="4 4"
                          dot={false}
                        />
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground py-12 text-center">
                      No P&L data yet
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="hourly">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Hourly Win/Loss Breakdown</CardTitle>
                  <CardDescription>
                    Wins and losses grouped by hour
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {stats.hourlyData?.length > 0 ? (
                    <ChartContainer
                      config={hourlyChartConfig}
                      className="h-[350px] w-full"
                    >
                      <BarChart data={stats.hourlyData}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-border/30"
                        />
                        <XAxis
                          dataKey="hour"
                          tickFormatter={formatHour}
                          tick={{ fontSize: 11 }}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={{ fontSize: 11 }} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(v) => formatHour(v)}
                            />
                          }
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                        <Bar
                          dataKey="wins"
                          fill="var(--color-wins)"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="losses"
                          fill="var(--color-losses)"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground py-12 text-center">
                      No hourly data yet
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
}
