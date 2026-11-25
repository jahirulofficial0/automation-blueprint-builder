import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWorkflow } from "../dist/validate.js";

const good = {
  name: "Lead capture",
  nodes: [
    { name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], parameters: { path: "lead" } },
    { name: "Sheet", type: "n8n-nodes-base.googleSheets", typeVersion: 4, position: [300, 0], parameters: {} },
  ],
  connections: { Webhook: { main: [[{ node: "Sheet", type: "main", index: 0 }]] } },
};

test("valid workflow passes", () => assert.equal(validateWorkflow(good).valid, true));

test("unknown connection target fails", () => {
  const bad = structuredClone(good);
  bad.connections.Webhook.main[0][0].node = "Ghost";
  assert.equal(validateWorkflow(bad).valid, false);
});

test("duplicate names fail", () => {
  const bad = structuredClone(good);
  bad.nodes[1].name = "Webhook";
  assert.equal(validateWorkflow(bad).valid, false);
});

test("sensitive value in parameters warns", () => {
  const w = structuredClone(good);
  w.nodes[1].parameters = { token: "x" };
  assert.ok(validateWorkflow(w).warnings.some((m) => m.includes("secret")));
});

test("no trigger warns", () => {
  const w = structuredClone(good);
  w.nodes[0].type = "n8n-nodes-base.set";
  assert.ok(validateWorkflow(w).warnings.some((m) => m.includes("trigger")));
});
