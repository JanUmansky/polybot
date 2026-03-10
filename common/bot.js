import mongoose from "mongoose";
import { strategySchema } from "./strategy.js";

const orderSchema = new mongoose.Schema(
  {
    side: { type: String, enum: ["BUY", "SELL"], required: true },
    direction: { type: String },
    amount: { type: Number },
    limit: { type: Number },
    pmProb: { type: Number },
    tokenId: { type: String },
    orderId: { type: String },
    orderStatus: { type: String },
    taDirection: { type: String },
    orderType: { type: String },
    filledPrice: { type: Number, default: null },
    avgPrice: { type: Number, default: null },
    sizeMatched: { type: Number, default: null },
    originalSize: { type: Number, default: null },
    transactionsHash: { type: String, default: null },
    statusHistory: {
      type: [
        {
          status: { type: String },
          ts: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    createdAt: { type: Date, default: Date.now },
    matchedAt: { type: Date, default: null },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
);

const verdictSchema = new mongoose.Schema(
  {
    result: { type: String },
    bought: { type: String, default: null },
    actual: { type: String, default: null },
    reason: { type: String, default: null },
  },
  { _id: false }
);

const botRunSchema = new mongoose.Schema({
  market: { type: String, required: true, unique: true },
  question: { type: String, required: true },
  prediction: { type: String, default: null },
  marketStartTime: { type: Date },
  marketEndTime: { type: Date },
  status: {
    type: String,
    enum: ["created", "running", "ended", "resolved", "timeout", "crashed", "stopped"],
    default: "running",
  },
  resolution: { type: String, default: null },
  verdict: { type: verdictSchema, default: null },
  orders: { type: [orderSchema], default: [] },
  strategy: { type: strategySchema, default: null },
  runStartTime: { type: Date, default: Date.now },
  runEndTime: { type: Date, default: null },
  log: { type: [String], default: [] },
  triggerGroups: { type: mongoose.Schema.Types.Mixed, default: null },
  logs: { type: [mongoose.Schema.Types.Mixed], default: [] },
});

export { orderSchema, botRunSchema };

export const BotRun =
  mongoose.models.Bot || mongoose.model("Bot", botRunSchema);
