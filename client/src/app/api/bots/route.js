import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { BotRun } from "@/lib/models";

export async function GET() {
  try {
    await connectDb();
    const bots = await BotRun.find()
      .sort({ runStartTime: -1 })
      .limit(50)
      .select("name question status prediction runStartTime verdict orders")
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
