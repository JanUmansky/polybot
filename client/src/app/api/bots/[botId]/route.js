import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { BotRun } from "@/lib/models";

export async function GET(_request, { params }) {
  try {
    const { botId } = await params;
    await connectDb();
    const bot = await BotRun.findById(botId).lean();

    if (!bot) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    return NextResponse.json(bot);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
