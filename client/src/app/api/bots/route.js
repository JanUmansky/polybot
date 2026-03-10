import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { BotRun } from "@/lib/models";

export async function GET() {
  try {
    await connectDb();
    const bots = await BotRun.find().sort({ runStartTime: -1 }).lean();
    return NextResponse.json(bots);
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
