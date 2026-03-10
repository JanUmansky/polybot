"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TA_DIRECTIONS = ["UP", "DOWN", "NEUTRAL"];
const OUTCOMES = ["UP", "DOWN"];
const SIDES = ["BUY", "SELL"];

const EMPTY_TRIGGER = {
  conditions: { taDirection: null, pmThreshold: null, spreadThreshold: null, windowStartMs: 180000, windowEndMs: null },
  action: { outcome: "UP", side: "BUY", amount: 5, limit: null },
};

const EMPTY_GROUP = { label: "", triggers: [structuredClone(EMPTY_TRIGGER)] };

const EMPTY_STRATEGY = { name: "", pmSmaWindowMs: 30000, triggerGroups: [structuredClone(EMPTY_GROUP)] };

function NullableNumber({ label, hint, value, onChange, step, min, max, placeholder, unit }) {
  const isNull = value == null;
  return (
    <label className="space-y-1">
      <span className="text-[10px] text-muted-foreground">
        {label}
        {hint && <span className="text-muted-foreground/50"> ({hint})</span>}
      </span>
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={!isNull}
          onChange={(e) => onChange(e.target.checked ? (min ?? 0) : null)}
          className="h-3.5 w-3.5 rounded border-border accent-ring"
          title={isNull ? "Enable this field" : "Set to null (use default)"}
        />
        {isNull ? (
          <span className="flex-1 rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground/60 italic">
            {placeholder ?? "null"}
          </span>
        ) : (
          <input
            type="number"
            step={step}
            min={min}
            max={max}
            value={value}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              onChange(isNaN(n) ? null : n);
            }}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
          />
        )}
        {unit && !isNull && <span className="text-[10px] text-muted-foreground/60">{unit}</span>}
      </div>
    </label>
  );
}

function NullableSelect({ label, hint, value, onChange, options, placeholder, defaultValue }) {
  const isNull = value == null;
  return (
    <label className="space-y-1">
      <span className="text-[10px] text-muted-foreground">
        {label}
        {hint && <span className="text-muted-foreground/50"> ({hint})</span>}
      </span>
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={!isNull}
          onChange={(e) => onChange(e.target.checked ? (defaultValue ?? options[0]) : null)}
          className="h-3.5 w-3.5 rounded border-border accent-ring"
          title={isNull ? "Enable this field" : "Set to null (use default)"}
        />
        {isNull ? (
          <span className="flex-1 rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground/60 italic">
            {placeholder ?? "null"}
          </span>
        ) : (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
          >
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
      </div>
    </label>
  );
}

function StrategyForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(() => structuredClone(initial || EMPTY_STRATEGY));

  const updateGroup = useCallback((gi, patch) => {
    setForm((prev) => {
      const groups = [...prev.triggerGroups];
      groups[gi] = { ...groups[gi], ...patch };
      return { ...prev, triggerGroups: groups };
    });
  }, []);

  const updateTrigger = useCallback((gi, ti, patch) => {
    setForm((prev) => {
      const groups = [...prev.triggerGroups];
      const triggers = [...groups[gi].triggers];
      triggers[ti] = {
        ...triggers[ti],
        conditions: { ...triggers[ti].conditions, ...patch.conditions },
        action: { ...triggers[ti].action, ...patch.action },
      };
      groups[gi] = { ...groups[gi], triggers };
      return { ...prev, triggerGroups: groups };
    });
  }, []);

  const addGroup = () => {
    setForm((prev) => ({
      ...prev,
      triggerGroups: [...prev.triggerGroups, structuredClone(EMPTY_GROUP)],
    }));
  };

  const removeGroup = (gi) => {
    setForm((prev) => ({
      ...prev,
      triggerGroups: prev.triggerGroups.filter((_, i) => i !== gi),
    }));
  };

  const addTrigger = (gi) => {
    setForm((prev) => {
      const groups = [...prev.triggerGroups];
      groups[gi] = {
        ...groups[gi],
        triggers: [...groups[gi].triggers, structuredClone(EMPTY_TRIGGER)],
      };
      return { ...prev, triggerGroups: groups };
    });
  };

  const removeTrigger = (gi, ti) => {
    setForm((prev) => {
      const groups = [...prev.triggerGroups];
      groups[gi] = {
        ...groups[gi],
        triggers: groups[gi].triggers.filter((_, i) => i !== ti),
      };
      return { ...prev, triggerGroups: groups };
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <label className="block space-y-1.5">
        <span className="text-xs text-muted-foreground">Strategy Name</span>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          placeholder="e.g. Conservative Buy"
        />
      </label>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Settings</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">PM SMA Window (seconds)</span>
            <input
              type="number"
              required
              step={1}
              min={10}
              max={120}
              value={form.pmSmaWindowMs / 1000}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setForm({ ...form, pmSmaWindowMs: isNaN(v) ? 30000 : Math.round(v * 1000) });
              }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Trigger Groups</h3>
          <Button type="button" variant="outline" size="sm" onClick={addGroup}>
            + Group
          </Button>
        </div>

        {form.triggerGroups.map((group, gi) => (
          <Card key={gi}>
            <CardHeader>
              <CardTitle className="text-xs">
                <input
                  type="text"
                  required
                  value={group.label}
                  onChange={(e) => updateGroup(gi, { label: e.target.value })}
                  className="rounded border border-border bg-transparent px-2 py-1 text-sm font-semibold text-foreground outline-none focus:border-ring"
                  placeholder="Group label"
                />
              </CardTitle>
              <CardAction>
                <div className="flex gap-1.5">
                  <Button type="button" variant="outline" size="xs" onClick={() => addTrigger(gi)}>
                    + Trigger
                  </Button>
                  {form.triggerGroups.length > 1 && (
                    <Button type="button" variant="destructive" size="xs" onClick={() => removeGroup(gi)}>
                      Remove
                    </Button>
                  )}
                </div>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-5">
              {group.triggers.map((trigger, ti) => (
                <div key={ti} className="space-y-3 rounded-lg border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">Trigger {ti + 1}</span>
                    {group.triggers.length > 1 && (
                      <Button type="button" variant="ghost" size="icon-xs" onClick={() => removeTrigger(gi, ti)}>
                        <span className="text-destructive">×</span>
                      </Button>
                    )}
                  </div>

                  <div className="pl-2">
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Condition</div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pl-2">
                      <NullableSelect
                        label="TA Direction"
                        hint="any"
                        value={trigger.conditions.taDirection}
                        onChange={(v) => updateTrigger(gi, ti, { conditions: { taDirection: v } })}
                        options={TA_DIRECTIONS}
                        defaultValue="UP"
                        placeholder="any"
                      />
                      <NullableNumber
                        label="PM Threshold"
                        hint="none"
                        value={trigger.conditions.pmThreshold}
                        onChange={(v) => updateTrigger(gi, ti, { conditions: { pmThreshold: v } })}
                        step={0.01}
                        min={0}
                        max={1}
                        placeholder="none"
                      />
                      <NullableNumber
                        label="Spread Threshold"
                        hint="none"
                        value={trigger.conditions.spreadThreshold}
                        onChange={(v) => updateTrigger(gi, ti, { conditions: { spreadThreshold: v } })}
                        step={0.01}
                        placeholder="none"
                      />
                      <NullableNumber
                        label="Window Start"
                        hint="default 0s"
                        value={trigger.conditions.windowStartMs != null ? trigger.conditions.windowStartMs / 1000 : null}
                        onChange={(v) => updateTrigger(gi, ti, { conditions: { windowStartMs: v != null ? Math.round(v * 1000) : null } })}
                        step={1}
                        min={0}
                        placeholder="default (0s)"
                        unit="s"
                      />
                      <NullableNumber
                        label="Window End"
                        hint="default ∞"
                        value={trigger.conditions.windowEndMs != null ? trigger.conditions.windowEndMs / 1000 : null}
                        onChange={(v) => updateTrigger(gi, ti, { conditions: { windowEndMs: v != null ? Math.round(v * 1000) : null } })}
                        step={1}
                        min={0}
                        placeholder="no limit (∞)"
                        unit="s"
                      />
                    </div>
                  </div>

                  <div className="pl-2">
                    <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Action</div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pl-2">
                      <label className="space-y-1">
                        <span className="text-[10px] text-muted-foreground">Outcome</span>
                        <select
                          value={trigger.action.outcome}
                          onChange={(e) => updateTrigger(gi, ti, { action: { outcome: e.target.value } })}
                          className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
                        >
                          {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-muted-foreground">Side</span>
                        <select
                          value={trigger.action.side}
                          onChange={(e) => updateTrigger(gi, ti, { action: { side: e.target.value } })}
                          className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
                        >
                          {SIDES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-muted-foreground">
                          {trigger.action.limit != null ? "Size (shares)" : "Amount ($)"}
                        </span>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          required
                          value={trigger.action.amount}
                          onChange={(e) => updateTrigger(gi, ti, { action: { amount: parseFloat(e.target.value) || 1 } })}
                          className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
                        />
                      </label>
                      <NullableNumber
                        label="Limit"
                        hint="market order"
                        value={trigger.action.limit}
                        onChange={(v) => updateTrigger(gi, ti, { action: { limit: v } })}
                        step={0.01}
                        min={0}
                        max={1}
                        placeholder="market order"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Strategy"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StrategyCard({ strategy, onEdit, onDelete, onDuplicate, deleting }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{strategy.name}</CardTitle>
        <CardAction>
          <div className="flex gap-1.5">
            <Button variant="outline" size="xs" onClick={() => onDuplicate(strategy)}>
              Duplicate
            </Button>
            <Button variant="outline" size="xs" onClick={() => onEdit(strategy)}>
              Edit
            </Button>
            <Button variant="destructive" size="xs" onClick={() => onDelete(strategy._id)} disabled={deleting}>
              Delete
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>SMA Window: <span className="text-foreground">{strategy.pmSmaWindowMs / 1000}s</span></span>
          <span>Groups: <span className="text-foreground">{strategy.triggerGroups?.length || 0}</span></span>
          <span>
            Triggers: <span className="text-foreground">
              {(strategy.triggerGroups || []).reduce((sum, g) => sum + (g.triggers?.length || 0), 0)}
            </span>
          </span>
        </div>

        {strategy.triggerGroups?.map((group, gi) => (
          <div key={gi}>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {group.label || `Group ${gi + 1}`}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-1.5 pr-3 font-medium">#</th>
                    <th className="pb-1.5 pr-3 font-medium">TA</th>
                    <th className="pb-1.5 pr-3 font-medium">PM Thresh</th>
                    <th className="pb-1.5 pr-3 font-medium">Spread</th>
                    <th className="pb-1.5 pr-3 font-medium">Window</th>
                    <th className="pb-1.5 pr-3 font-medium">Outcome</th>
                    <th className="pb-1.5 pr-3 font-medium">Side</th>
                    <th className="pb-1.5 pr-3 font-medium">Amt/Size</th>
                    <th className="pb-1.5 font-medium">Limit</th>
                  </tr>
                </thead>
                <tbody>
                  {(group.triggers || []).map((t, ti) => {
                    const c = t.conditions || {};
                    const a = t.action || {};
                    const start = c.windowStartMs != null ? `${c.windowStartMs / 1000}s` : "0s";
                    const end = c.windowEndMs != null ? `${c.windowEndMs / 1000}s` : "∞";
                    return (
                      <tr key={ti} className="border-b border-border/50">
                        <td className="py-1.5 pr-3 text-muted-foreground">{ti + 1}</td>
                        <td className="py-1.5 pr-3">{c.taDirection ?? <span className="text-muted-foreground/50 italic">any</span>}</td>
                        <td className="py-1.5 pr-3 font-mono">{c.pmThreshold != null ? `${Math.round(c.pmThreshold * 100)}c` : <span className="text-muted-foreground/50 italic">—</span>}</td>
                        <td className="py-1.5 pr-3 font-mono">{c.spreadThreshold != null ? <span className={c.spreadThreshold >= 0 ? "text-green-400" : "text-red-400"}>{c.spreadThreshold >= 0 ? ">" : "<"}{c.spreadThreshold}</span> : <span className="text-muted-foreground/50 italic">—</span>}</td>
                        <td className="py-1.5 pr-3 font-mono">{start}–{end}</td>
                        <td className="py-1.5 pr-3">
                          <span className={a.outcome === "UP" ? "text-green-400" : "text-red-400"}>{a.outcome}</span>
                        </td>
                        <td className="py-1.5 pr-3">
                          <span className={a.side === "BUY" ? "text-green-400" : "text-red-400"}>{a.side}</span>
                        </td>
                        <td className="py-1.5 pr-3 font-mono">{a.limit != null ? `${a.amount} sh` : `$${a.amount}`}</td>
                        <td className="py-1.5 font-mono">{a.limit != null ? `${Math.round(a.limit * 100)}c` : "MKT"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {gi < strategy.triggerGroups.length - 1 && (
              <div className="mt-2 text-center text-[10px] italic text-muted-foreground/60">AND</div>
            )}
          </div>
        ))}

        {strategy.updatedAt && (
          <div className="text-[10px] text-muted-foreground/60">
            Updated {new Date(strategy.updatedAt).toLocaleString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("list"); // list | create | edit
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchStrategies = useCallback(async () => {
    try {
      const res = await fetch("/api/strategies");
      if (!res.ok) throw new Error("Failed to fetch strategies");
      setStrategies(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStrategies(); }, [fetchStrategies]);

  const handleCreate = async (data) => {
    setSaving(true);
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create");
      }
      await fetchStrategies();
      setMode("list");
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (data) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/strategies/${editing._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update");
      }
      await fetchStrategies();
      setMode("list");
      setEditing(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this strategy?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/strategies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchStrategies();
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleEdit = (strategy) => {
    setEditing(strategy);
    setMode("edit");
  };

  const handleDuplicate = (strategy) => {
    const { _id, createdAt, updatedAt, __v, ...rest } = strategy;
    setEditing({ ...rest, name: `${rest.name} (copy)` });
    setMode("create");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background px-6 py-5">
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to dashboard
        </Link>
        <div className="mt-3 flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight">Strategies</h1>
          {mode === "list" && (
            <Button variant="outline" size="sm" onClick={() => { setEditing(null); setMode("create"); }}>
              + New Strategy
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {error && (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {mode === "create" && (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">New Strategy</h2>
            <StrategyForm
              initial={editing || EMPTY_STRATEGY}
              onSave={handleCreate}
              onCancel={() => { setMode("list"); setEditing(null); }}
              saving={saving}
            />
          </div>
        )}

        {mode === "edit" && editing && (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">Edit Strategy</h2>
            <StrategyForm
              initial={editing}
              onSave={handleUpdate}
              onCancel={() => { setMode("list"); setEditing(null); }}
              saving={saving}
            />
          </div>
        )}

        {mode === "list" && (
          <div className="space-y-4">
            {strategies.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">No strategies yet. Create one to get started.</p>
                </CardContent>
              </Card>
            ) : (
              strategies.map((s) => (
                <StrategyCard
                  key={s._id}
                  strategy={s}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  deleting={deleting}
                />
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
