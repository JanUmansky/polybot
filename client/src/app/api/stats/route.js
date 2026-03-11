import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { BotRun } from "@/lib/models";

export async function GET() {
  try {
    await connectDb();

    const [
      verdictCounts,
      pnlAgg,
      botRuns,
      winPnlAgg,
      lossPnlAgg,
      timelineRaw,
      hourlyAgg,
      streakData,
    ] = await Promise.all([
      BotRun.aggregate([
        { $match: { verdict: { $ne: null } } },
        {
          $group: {
            _id: {
              $cond: {
                if: { $eq: [{ $type: "$verdict" }, "string"] },
                then: "$verdict",
                else: "$verdict.result",
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),

      BotRun.aggregate([
        { $match: { "verdict.pnl": { $ne: null } } },
        {
          $group: {
            _id: null,
            totalPnl: { $sum: "$verdict.pnl" },
            maxPnl: { $max: "$verdict.pnl" },
            minPnl: { $min: "$verdict.pnl" },
          },
        },
      ]),

      BotRun.countDocuments(),

      BotRun.aggregate([
        { $match: { "verdict.result": "WIN", "verdict.pnl": { $ne: null } } },
        {
          $group: {
            _id: null,
            avgWin: { $avg: "$verdict.pnl" },
            totalWinPnl: { $sum: "$verdict.pnl" },
            count: { $sum: 1 },
            avgPositionSize: { $avg: "$verdict.positionSize" },
          },
        },
      ]),

      BotRun.aggregate([
        { $match: { "verdict.result": "LOSS", "verdict.pnl": { $ne: null } } },
        {
          $group: {
            _id: null,
            avgLoss: { $avg: "$verdict.pnl" },
            totalLossPnl: { $sum: "$verdict.pnl" },
            count: { $sum: 1 },
            avgPositionSize: { $avg: "$verdict.positionSize" },
          },
        },
      ]),

      BotRun.aggregate([
        {
          $match: {
            "verdict.result": { $in: ["WIN", "LOSS"] },
            runEndTime: { $ne: null },
          },
        },
        { $sort: { runEndTime: 1 } },
        {
          $project: {
            result: "$verdict.result",
            pnl: "$verdict.pnl",
            runEndTime: 1,
          },
        },
      ]),

      BotRun.aggregate([
        {
          $match: {
            "verdict.result": { $in: ["WIN", "LOSS"] },
            runEndTime: { $ne: null },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%dT%H:00:00.000Z", date: "$runEndTime" },
            },
            wins: {
              $sum: { $cond: [{ $eq: ["$verdict.result", "WIN"] }, 1, 0] },
            },
            losses: {
              $sum: { $cond: [{ $eq: ["$verdict.result", "LOSS"] }, 1, 0] },
            },
            pnl: { $sum: { $ifNull: ["$verdict.pnl", 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      BotRun.find(
        { "verdict.result": { $in: ["WIN", "LOSS"] } },
        { "verdict.result": 1, runEndTime: 1 }
      )
        .sort({ runEndTime: 1 })
        .lean(),
    ]);

    const stats = {};
    for (const r of verdictCounts) {
      stats[r._id] = r.count;
    }
    stats.total = Object.values(stats).reduce((a, b) => a + b, 0);
    stats.botRuns = botRuns;

    const wins = stats.WIN || 0;
    const losses = stats.LOSS || 0;

    stats.totalPnl = pnlAgg[0]?.totalPnl ?? 0;
    stats.maxPnl = pnlAgg[0]?.maxPnl ?? 0;
    stats.minPnl = pnlAgg[0]?.minPnl ?? 0;

    stats.winRate =
      wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : null;

    stats.avgWinSize = winPnlAgg[0]?.avgWin ?? 0;
    stats.avgLossSize = lossPnlAgg[0]?.avgLoss ?? 0;
    stats.totalWinPnl = winPnlAgg[0]?.totalWinPnl ?? 0;
    stats.totalLossPnl = lossPnlAgg[0]?.totalLossPnl ?? 0;
    stats.avgWinPositionSize = winPnlAgg[0]?.avgPositionSize ?? 0;
    stats.avgLossPositionSize = lossPnlAgg[0]?.avgPositionSize ?? 0;

    const totalWinAmount = Math.abs(stats.totalWinPnl);
    const totalLossAmount = Math.abs(stats.totalLossPnl);

    // Profit Factor: total $ won / total $ lost (naturally weights by frequency + size)
    stats.profitFactor =
      totalLossAmount > 0 ? +(totalWinAmount / totalLossAmount).toFixed(3) : null;

    // Expectancy: expected P&L per resolved trade = (winRate * avgWin) + (lossRate * avgLoss)
    const resolved = wins + losses;
    if (resolved > 0) {
      const winRate = wins / resolved;
      const lossRate = losses / resolved;
      const avgWin = stats.avgWinSize;   // positive
      const avgLoss = stats.avgLossSize; // negative
      stats.expectancy = +(winRate * avgWin + lossRate * avgLoss).toFixed(4);
    } else {
      stats.expectancy = null;
    }

    const resolvedTimes = streakData
      .filter((d) => d.runEndTime)
      .map((d) => new Date(d.runEndTime).getTime());

    if (resolvedTimes.length >= 2) {
      const earliest = Math.min(...resolvedTimes);
      const latest = Math.max(...resolvedTimes);
      const hours = (latest - earliest) / (1000 * 60 * 60);
      stats.winsPerHour = hours > 0 ? +(wins / hours).toFixed(2) : 0;
      stats.lossesPerHour = hours > 0 ? +(losses / hours).toFixed(2) : 0;
      stats.totalHours = +hours.toFixed(1);
    } else {
      stats.winsPerHour = 0;
      stats.lossesPerHour = 0;
      stats.totalHours = 0;
    }

    let currentStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let tmpWin = 0;
    let tmpLoss = 0;
    for (const d of streakData) {
      const r = d.verdict?.result;
      if (r === "WIN") {
        tmpWin++;
        tmpLoss = 0;
        maxWinStreak = Math.max(maxWinStreak, tmpWin);
      } else if (r === "LOSS") {
        tmpLoss++;
        tmpWin = 0;
        maxLossStreak = Math.max(maxLossStreak, tmpLoss);
      }
    }
    if (streakData.length > 0) {
      const lastResult = streakData[streakData.length - 1].verdict?.result;
      currentStreak = lastResult === "WIN" ? tmpWin : -tmpLoss;
    }
    stats.currentStreak = currentStreak;
    stats.maxWinStreak = maxWinStreak;
    stats.maxLossStreak = maxLossStreak;

    const tradesPerHour = stats.totalHours > 0 ? (wins + losses) / stats.totalHours : 0;
    const proj24hTrades = +(tradesPerHour * 24).toFixed(1);
    const proj24hWins = +(stats.winsPerHour * 24).toFixed(1);
    const proj24hLosses = +(stats.lossesPerHour * 24).toFixed(1);
    const proj24hProfit = +(stats.winsPerHour * 24 * stats.avgWinSize).toFixed(2);
    const proj24hLoss = +(stats.lossesPerHour * 24 * Math.abs(stats.avgLossSize)).toFixed(2);
    const proj24hNet = +(proj24hProfit - proj24hLoss).toFixed(2);

    const avgCostPerTrade = await BotRun.aggregate([
      { $match: { "verdict.result": { $in: ["WIN", "LOSS"] }, "verdict.positionSize": { $ne: null }, "verdict.avgPrice": { $ne: null } } },
      { $project: { cost: { $multiply: ["$verdict.positionSize", "$verdict.avgPrice"] } } },
      { $group: { _id: null, avgCost: { $avg: "$cost" } } },
    ]);
    const avgInvestmentPerTrade = +(avgCostPerTrade[0]?.avgCost ?? 0).toFixed(2);

    const maxConsecutiveLosses = Math.max(stats.maxLossStreak, 1);
    const proj24hMinBalance = +(avgInvestmentPerTrade * (1 + maxConsecutiveLosses)).toFixed(2);

    const proj24hROI = proj24hMinBalance > 0
      ? +((proj24hNet / proj24hMinBalance) * 100).toFixed(1)
      : null;

    stats.projections = {
      trades: proj24hTrades,
      wins: proj24hWins,
      losses: proj24hLosses,
      grossProfit: proj24hProfit,
      grossLoss: proj24hLoss,
      netPnl: proj24hNet,
      avgInvestmentPerTrade,
      minBalance: proj24hMinBalance,
      maxConsecutiveLosses,
      roi: proj24hROI,
    };

    let cumulativeNet = 0;
    stats.timeline = timelineRaw.map((d) => {
      const delta = d.result === "WIN" ? 1 : -1;
      cumulativeNet += delta;
      return {
        time: d.runEndTime,
        result: d.result,
        pnl: d.pnl ?? 0,
        cumulativeNet,
      };
    });

    let cumulativePnl = 0;
    stats.hourlyData = hourlyAgg.map((h) => {
      cumulativePnl += h.pnl;
      return {
        hour: h._id,
        wins: h.wins,
        losses: h.losses,
        net: h.wins - h.losses,
        pnl: +h.pnl.toFixed(2),
        cumulativePnl: +cumulativePnl.toFixed(2),
      };
    });

    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
