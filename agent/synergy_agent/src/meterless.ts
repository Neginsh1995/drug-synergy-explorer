/**
 * Meterless Runtime 0.90.0 client. Sole LLM provider for this app.
 * Contract: docs-agent-ready/add-meterless-provider.md and docs-nightshift/hotspot.md
 * No OpenAI/Anthropic/Google fallback exists in this module.
 */

import { APP_ID, MAX_INFRA_RETRIES } from "./constants.ts";

export type NightshiftStatus = "online" | "unauthorized" | "offline";

export interface MeterlessClient {
  baseUrl: string;
  status: NightshiftStatus;
  models: string[];
  /** integration: `label` names the call in the run log (role, round, drug pair). */
  complete(prompt: string, systemPrompt?: string, label?: string): Promise<string>;
}

const TIMEOUT_MS = Number(process.env.METERLESS_TIMEOUT_MS) || 180_000; // integration: adjustable wait per call
const MAX_TOKENS = Number(process.env.METERLESS_MAX_TOKENS) || 8000; // integration: reply length limit sent to Nightshift
const DETECT_PORTS = [8088, 8090, 8787, 11434];
const DETECT_HOSTS = ["127.0.0.1", "localhost", "[::1]"];
const BLOCKED_HOSTS = ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "openrouter.ai"];

export function normalizeBaseUrl(raw: string): string {
  let s = raw.trim();
  if (!s) throw new Error("meterless: empty base URL");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
  const host = new URL(s).hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(host)) {
    throw new Error(`meterless: refusing non-Nightshift host ${host}; no alternate-provider fallback`);
  }
  s = s.replace(/\/+$/, "");
  s = s.replace(/\/v1\/chat\/completions$/i, "");
  s = s.replace(/\/v1\/models$/i, "");
  s = s.replace(/\/healthz$/i, "");
  s = s.replace(/\/v1$/i, "");
  return `${s}/v1`;
}

function rejectPlaceholderToken(token: string): string {
  const t = token.trim();
  if (!t || t === "rt-local") {
    throw new Error("meterless: placeholder token rt-local is rejected; paste the token from <stateDir>/proxy-token");
  }
  return t;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function probe(baseUrl: string, token?: string): Promise<{ status: NightshiftStatus; models: string[] }> {
  const headers: Record<string, string> = { "meterless-app": APP_ID };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/models`, { headers }, 4000);
    if (res.status === 401 || res.status === 403) return { status: "unauthorized", models: [] };
    if (res.status !== 200) return { status: "offline", models: [] };
    const body = (await res.json()) as { data?: { id?: string }[] };
    const models = (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    const hasMeterless = models.some((id) => id.startsWith("meterless/"));
    return { status: hasMeterless ? "online" : "offline", models };
  } catch {
    return { status: "offline", models: [] };
  }
}

export async function autoDetect(token?: string): Promise<{ baseUrl: string; status: NightshiftStatus; models: string[] } | null> {
  for (const host of DETECT_HOSTS) {
    for (const port of DETECT_PORTS) {
      const hostPart = host === "[::1]" ? "[::1]" : host;
      const baseUrl = normalizeBaseUrl(`http://${hostPart}:${port}`);
      const hit = await probe(baseUrl, token);
      if (hit.status === "online" || hit.status === "unauthorized") {
        return { baseUrl, ...hit };
      }
    }
  }
  return null;
}

export async function createMeterlessClient(opts: { baseUrl?: string; token?: string } = {}): Promise<MeterlessClient> {
  const envUrl = process.env.METERLESS_BASE_URL;
  const envToken = process.env.METERLESS_RUNTIME_TOKEN;
  const token = opts.token ?? envToken;
  const usableToken = token ? rejectPlaceholderToken(token) : undefined;

  let baseUrl: string | undefined;
  let status: NightshiftStatus = "offline";
  let models: string[] = [];

  if (opts.baseUrl || envUrl) {
    baseUrl = normalizeBaseUrl(opts.baseUrl ?? envUrl!);
    const hit = await probe(baseUrl, usableToken);
    status = hit.status;
    models = hit.models;
  } else {
    const detected = await autoDetect(usableToken);
    if (detected) {
      baseUrl = detected.baseUrl;
      status = detected.status;
      models = detected.models;
    } else {
      baseUrl = normalizeBaseUrl("http://127.0.0.1:8088");
      status = "offline";
    }
  }

  if (status === "unauthorized") {
    throw new Error(
      `meterless unauthorized at ${baseUrl}: paste the runtime token (Authorization Bearer). GET /v1/models returned 401/403, not offline.`,
    );
  }
  if (status !== "online") {
    throw new Error(
      `meterless offline at ${baseUrl}. Start Nightshift (hotspot) so GET /v1/models returns meterless/* ids. This app does not call any other LLM provider.`,
    );
  }

  const authToken = usableToken;
  // integration: METERLESS_MODEL picks the model Nightshift routes to (e.g. claude-sonnet-4-5-20250929);
  // unset keeps the original choice, meterless/auto.
  const modelId =
    process.env.METERLESS_MODEL?.trim() ||
    (models.find((id) => id === "meterless/auto") ??
      models.find((id) => id.startsWith("meterless/")) ??
      "meterless/auto");

  return {
    baseUrl: baseUrl!,
    status,
    models,
    async complete(prompt: string, systemPrompt?: string, label?: string): Promise<string> {
      const started = Date.now();
      const messages: { role: string; content: string }[] = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: prompt });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "meterless-app": APP_ID,
        "meterless-scope": "user",
      };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      let lastErr: Error | undefined;
      for (let attempt = 0; attempt <= MAX_INFRA_RETRIES; attempt++) {
        try {
          const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            // integration: ask for room to answer; without it Nightshift caps replies at 2,048 tokens,
            // which cuts the Proposer's JSON off mid-way (METERLESS_MAX_TOKENS, default 8000)
            body: JSON.stringify({ model: modelId, messages, temperature: 0.2, max_tokens: MAX_TOKENS }),
          });
          if (res.status === 429 || res.status >= 500) {
            lastErr = new Error(`meterless chat ${res.status}`);
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`meterless chat ${res.status}: ${errText.slice(0, 400)}`);
          }
          const body = (await res.json()) as {
            model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number };
            choices?: { message?: { content?: string } }[];
          };
          const text = body.choices?.[0]?.message?.content;
          // integration: one log line per LLM call, with the model Nightshift says answered
          const u = body.usage ?? {};
          console.log(`    -> Nightshift · ${label ?? "call"} · ${body.model ?? modelId} · ` +
            `${u.prompt_tokens ?? "?"} in / ${u.completion_tokens ?? "?"} out tokens · ${((Date.now() - started) / 1000).toFixed(1)} s`);
          if (typeof text !== "string") throw new Error("meterless: expected string content from chat completion");
          return text;
        } catch (err) {
          lastErr = err as Error;
          if (/meterless chat (4\d\d)/.test(lastErr.message) && !/429/.test(lastErr.message)) throw lastErr;
          if (attempt >= MAX_INFRA_RETRIES) break;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      throw lastErr ?? new Error("meterless: exhausted infrastructure retries; no alternate provider");
    },
  };
}
