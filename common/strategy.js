import mongoose from "mongoose";

const triggerConditionSchema = new mongoose.Schema(
  {
    taDirection: { type: String, enum: ["UP", "DOWN", "NEUTRAL"], default: null },
    pmThreshold: { type: Number, default: null },
    spreadThreshold: { type: Number, default: null },
    windowStartMs: { type: Number, default: 0 },
    windowEndMs: { type: Number, default: null },
  },
  { _id: false }
);

const triggerActionSchema = new mongoose.Schema(
  {
    outcome: { type: String, enum: ["UP", "DOWN"], required: true },
    side: { type: String, enum: ["BUY", "SELL"], default: "BUY" },
    amount: { type: Number, required: true },
    limit: { type: Number, default: null },
  },
  { _id: false }
);

const triggerSchema = new mongoose.Schema(
  {
    fired: { type: Boolean, default: false },
    conditions: { type: triggerConditionSchema, required: true },
    action: { type: triggerActionSchema, required: true },
  },
  { _id: true }
);

const triggerGroupSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    triggers: { type: [triggerSchema], default: [] },
  },
  { _id: true }
);

const strategySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    pmSmaWindowMs: { type: Number, required: true, min: 10_000, max: 120_000 },
    triggerGroups: { type: [triggerGroupSchema], default: [] },
  },
  { timestamps: true }
);

export { strategySchema };

export const Strategy =
  mongoose.models.Strategy || mongoose.model("Strategy", strategySchema);
