/**
 * Screening loop: walk candidates in order (z_HSA descending), judge ONE at a time,
 * reject pairs without synergy support, keep supported ones, stop at TARGET_KEEP.
 * Pure logic (no network) so it can be unit-tested with a fake evaluator.
 */
import { LENIENT_SYNERGY_CLASSES, STRICT_SYNERGY_CLASSES } from "./constants.ts";
import type { Assessment } from "./types.ts";

export type SynergyMode = "strict" | "include_mechanistic";

export function synergyModeFromEnv(env: string | undefined = process.env.SYNERGY_ACCEPT): SynergyMode {
  return env === "include_mechanistic" ? "include_mechanistic" : "strict";
}

export interface Decision {
  keep: boolean;
  reason: string;
}

/** The synergy gate. Decided in code from the Proposer/Critic result, not by asking the model again. */
export function decideSynergy(a: Assessment, mode: SynergyMode = "strict"): Decision {
  const allowed = mode === "strict" ? STRICT_SYNERGY_CLASSES : LENIENT_SYNERGY_CLASSES;
  if (a.final_status === "rejected" || a.final_status === "failed") {
    return { keep: false, reason: `final_status=${a.final_status}` };
  }
  if (!allowed.includes(a.evidence_class)) {
    return { keep: false, reason: `evidence_class=${a.evidence_class} is not synergy evidence (mode=${mode})` };
  }
  if (a.direct_experimental_synergy === "no" && a.evidence_class !== "mechanistic_pathway_only") {
    return { keep: false, reason: "direct_experimental_synergy=no" };
  }
  return { keep: true, reason: `evidence_class=${a.evidence_class}, status=${a.final_status}` };
}

export interface ScreenRecord {
  order: number;
  pair_id: string;
  decision: "keep" | "reject" | "error";
  reason: string;
  evidence_class: string;
  score: number | "";
  rounds_used: number | "";
}

export type StopReason = "target_reached" | "max_examined" | "candidates_exhausted";

export async function screenUntilKept<C>(args: {
  candidates: C[];
  idOf: (c: C) => string;
  evaluate: (c: C) => Promise<Assessment>;
  decide: (a: Assessment) => Decision;
  targetKeep: number;
  maxExamine: number;
  onStep?: (rec: ScreenRecord, kept: Assessment[], screened: ScreenRecord[]) => Promise<void>;
}): Promise<{ kept: Assessment[]; screened: ScreenRecord[]; stopReason: StopReason }> {
  const kept: Assessment[] = [];
  const screened: ScreenRecord[] = [];
  let stopReason: StopReason = "candidates_exhausted";
  for (const c of args.candidates) {
    if (kept.length >= args.targetKeep) { stopReason = "target_reached"; break; }
    if (screened.length >= args.maxExamine) { stopReason = "max_examined"; break; }
    const id = args.idOf(c);
    let rec: ScreenRecord;
    try {
      const a = await args.evaluate(c);
      const d = args.decide(a);
      if (d.keep) kept.push(a);
      rec = { order: screened.length + 1, pair_id: id, decision: d.keep ? "keep" : "reject", reason: d.reason,
        evidence_class: a.evidence_class, score: a.score, rounds_used: a.rounds_used };
    } catch (err) {
      rec = { order: screened.length + 1, pair_id: id, decision: "error", reason: (err as Error).message,
        evidence_class: "", score: "", rounds_used: "" };
    }
    screened.push(rec);
    if (args.onStep) await args.onStep(rec, kept, screened);
  }
  if (kept.length >= args.targetKeep) stopReason = "target_reached";
  return { kept, screened, stopReason };
}

export function screenedToCsv(rows: (ScreenRecord & { Drug1?: string; Drug2?: string; z_HSA?: string })[]): string {
  const cols = ["order", "pair_id", "Drug1", "Drug2", "z_HSA", "decision", "evidence_class", "score", "rounds_used", "reason"] as const;
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(","))].join("\n") + "\n";
}
