import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { Strategy } from "@/lib/models";

export async function GET() {
  try {
    await connectDb();
    const strategies = await Strategy.find().sort({ updatedAt: -1 }).lean();
    return NextResponse.json(strategies);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await connectDb();
    const body = await request.json();
    const strategy = await Strategy.create(body);
    return NextResponse.json(strategy, { status: 201 });
  } catch (error) {
    const status = error.name === "ValidationError" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
