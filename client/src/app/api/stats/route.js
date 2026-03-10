import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { BotRun } from "@/lib/models";

export async function GET() {
  try { 
    await connectDb();
    const result = await BotRun.aggregate([
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
    ]);
    const stats = {};
    for (const r of result) {
      stats[r._id] = r.count;
    }
    stats.total = Object.values(stats).reduce((a, b) => a + b, 0);
    const wins = stats.WIN || 0;
    const losses = stats.LOSS || 0;
    stats.winRate =
      wins + losses > 0
        ? ((wins / (wins + losses)) * 100).toFixed(1)
        : null;
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
