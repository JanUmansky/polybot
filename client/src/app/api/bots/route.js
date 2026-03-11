import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { BotRun } from "@/lib/models";

export async function GET(request) {
  try {
    await connectDb();
    const verdict = request.nextUrl.searchParams.get("verdict");

    let filter = {};
    if (verdict === "won") {
      filter = { "verdict.result": "WIN" };
    } else if (verdict === "lost") {
      filter = { "verdict.result": "LOSS" };
    } else if (verdict === "other") {
      filter = {
        verdict: { $ne: null },
        "verdict.result": { $nin: ["WIN", "LOSS"] },
      };
    }

    const bots = await BotRun.find(filter)
      .sort({ runStartTime: -1 })
      .limit(50)
      .select("name question status prediction runStartTime runEndTime verdict orders")
      .lean();
    const result = bots.map((b) => ({
      ...b,
      orderCount: b.orders?.length || 0,
      orders: undefined,
    }));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
