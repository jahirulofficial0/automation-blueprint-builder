#!/usr/bin/env node
/**
 * automation-blueprint-builder MCP server (n8n).
 * Tools: validate_workflow (offline), list_workflows, create_workflow (always inactive).
 * Env: N8N_BASE_URL, N8N_API_KEY. Secrets are never logged or returned.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { validateWorkflow, type Workflow } from "./validate.js";

const log = (...a: unknown[]) => console.error("[n8n-mcp]", ...a);
const TIMEOUT_MS = 15_000;

function config() {
  const base = process.env.N8N_BASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.N8N_API_KEY?.trim();
  if (!base || !key) throw new Error("Set N8N_BASE_URL and N8N_API_KEY environment variables.");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error("N8N_BASE_URL is not a valid URL.");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error("N8N_BASE_URL must use https (http allowed only for localhost).");
  return { base, key };
}

async function n8n(path: string, init: RequestInit = {}) {
  const { base, key } = config();
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: { "X-N8N-API-KEY": key, "Content-Type": "application/json", Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    // Body may echo request data but never contains our API key (sent only as header).
    throw new Error(`n8n API ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (e: unknown) => ({ isError: true, ...text(e instanceof Error ? e.message : String(e)) });

function parseWorkflow(input: string): Workflow {
  try {
    return JSON.parse(input);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
}

const server = new McpServer({ name: "automation-blueprint-builder", version: "1.0.0", websiteUrl: "https://cloudskillhub.com" });

server.tool(
  "validate_workflow",
  "Validate n8n workflow JSON offline: required fields, unique node names, connection targets, trigger presence. No network call.",
  { workflow_json: z.string().min(2).max(1_000_000).describe("n8n workflow JSON as a string") },
  async ({ workflow_json }) => {
    try {
      const r = validateWorkflow(parseWorkflow(workflow_json));
      const lines = [r.valid ? "VALID" : "INVALID", ...r.errors.map((e) => `ERROR: ${e}`), ...r.warnings.map((w) => `WARN: ${w}`)];
      return text(lines.join("\n"));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool("list_workflows", "List workflows in the connected n8n instance (id, name, active).", { limit: z.number().int().min(1).max(250).default(50) }, async ({ limit }) => {
  try {
    const data = await n8n(`/workflows?limit=${limit}`);
    const rows = (data.data ?? []).map((w: { id: string; name: string; active: boolean }) => `- ${w.id} | ${w.name} | ${w.active ? "active" : "inactive"}`);
    return text(rows.length ? rows.join("\n") : "No workflows found.");
  } catch (e) {
    return fail(e);
  }
});

server.tool(
  "create_workflow",
  "Create a workflow in n8n. It is validated first and always created INACTIVE — the user activates it manually after testing. Only call after the user confirms.",
  { workflow_json: z.string().min(2).max(1_000_000) },
  async ({ workflow_json }) => {
    try {
      const wf = parseWorkflow(workflow_json);
      const r = validateWorkflow(wf);
      if (!r.valid) return fail(new Error(`Validation failed:\n${r.errors.join("\n")}`));
      const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings ?? { executionOrder: "v1" } };
      const created = await n8n("/workflows", { method: "POST", body: JSON.stringify(body) });
      log(`created workflow ${created.id}`);
      return text(`Created (inactive): id=${created.id}, name=${created.name}\nOpen it in n8n, connect credentials, test, then activate.`);
    } catch (e) {
      return fail(e);
    }
  },
);

server
  .connect(new StdioServerTransport())
  .then(() => log("ready"))
  .catch((e) => {
    log("fatal:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
