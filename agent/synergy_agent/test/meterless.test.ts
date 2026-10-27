import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "../src/meterless.ts";
import { PILOT_LIMIT } from "../src/constants.ts";

const SRC_GLOBS = [
  "src/meterless.ts",
  "src/debate.ts",
  "src/workflow.ts",
  "src/pilot.ts",
  "src/pubmed.ts",
  "src/scoring.ts",
];

describe("Nightshift provider routing", () => {
  it("normalizes Meterless URLs to /v1 without doubling", () => {
    expect(normalizeBaseUrl("127.0.0.1:8088")).toBe("http://127.0.0.1:8088/v1");
    expect(normalizeBaseUrl("http://127.0.0.1:8088/v1/chat/completions")).toBe("http://127.0.0.1:8088/v1");
    expect(normalizeBaseUrl("http://127.0.0.1:8088/v1")).toBe("http://127.0.0.1:8088/v1");
  });

  it("refuses alternate LLM provider hosts (no silent fallback)", () => {
    expect(() => normalizeBaseUrl("https://api.openai.com/v1")).toThrow(/no alternate-provider fallback/);
    expect(() => normalizeBaseUrl("https://api.anthropic.com")).toThrow(/no alternate-provider fallback/);
    expect(() => normalizeBaseUrl("https://generativelanguage.googleapis.com")).toThrow(/no alternate-provider fallback/);
  });

  it("contains no alternate-provider client in workflow sources", () => {
    for (const rel of SRC_GLOBS) {
      const text = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
      expect(text).not.toMatch(/https:\/\/api\.openai\.com/);
      expect(text).not.toMatch(/https:\/\/api\.anthropic\.com/);
      expect(text).not.toMatch(/https:\/\/generativelanguage\.googleapis\.com/);
      expect(text).not.toMatch(/new OpenAI\(/);
    }
    const meterless = readFileSync(new URL("../src/meterless.ts", import.meta.url), "utf8");
    expect(meterless).toMatch(/meterless-app/);
    expect(meterless).toMatch(/meterless-scope/);
    expect(meterless).toMatch(/\/chat\/completions/);
    expect(meterless).toMatch(/BLOCKED_HOSTS/);
  });

  it("keeps the authorized pilot at exactly five units", () => {
    expect(PILOT_LIMIT).toBe(5);
  });
});
