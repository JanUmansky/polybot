import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { Strategy } from "@/lib/models";

export async function GET(_request, { params }) {
  try {
    await connectDb();
    const { id } = await params;
    const strategy = await Strategy.findById(id).lean();
    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }
    return NextResponse.json(strategy);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(_request, { params }) {
  try {
    await connectDb();
    const { id } = await params;
    const body = await _request.json();
    const strategy = await Strategy.findByIdAndUpdate(id, body, {
      new: true,
      runValidators: true,
    }).lean();
    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }
    return NextResponse.json(strategy);
  } catch (error) {
    const status = error.name === "ValidationError" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}

export async function DELETE(_request, { params }) {
  try {
    await connectDb();
    const { id } = await params;
    const strategy = await Strategy.findByIdAndDelete(id).lean();
    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
