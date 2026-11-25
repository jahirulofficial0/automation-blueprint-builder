export interface WorkflowNode {
  name: string;
  type: string;
  typeVersion?: number;
  position: [number, number];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}
export interface Workflow {
  name: string;
  nodes: WorkflowNode[];
  connections: Record<string, Record<string, Array<Array<{ node: string; type: string; index: number }>>>>;
  settings?: Record<string, unknown>;
  active?: boolean;
}
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const TYPE_RE = /^(@[a-z0-9-]+\/)?[a-zA-Z0-9-]+\.[a-zA-Z0-9]+$/;
const SECRET_HINT = /(api[_-]?key|password|secret|token|bearer)/i;

export function validateWorkflow(wf: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const w = wf as Partial<Workflow>;

  if (!w || typeof w !== "object") return { valid: false, errors: ["Workflow must be a JSON object."], warnings };
  if (typeof w.name !== "string" || !w.name.trim()) errors.push("`name` is required.");
  if (!Array.isArray(w.nodes) || w.nodes.length === 0) errors.push("`nodes` must be a non-empty array.");
  if (!w.connections || typeof w.connections !== "object") errors.push("`connections` must be an object.");
  if (errors.length) return { valid: false, errors, warnings };

  const names = new Set<string>();
  let hasTrigger = false;
  w.nodes!.forEach((n, i) => {
    const at = `nodes[${i}]`;
    if (!n || typeof n.name !== "string" || !n.name) errors.push(`${at}: missing name.`);
    else if (names.has(n.name)) errors.push(`${at}: duplicate node name "${n.name}".`);
    else names.add(n.name);
    if (typeof n.type !== "string" || !TYPE_RE.test(n.type)) errors.push(`${at} (${n?.name}): invalid type "${n?.type}".`);
    if (!Array.isArray(n.position) || n.position.length !== 2 || !n.position.every((v) => typeof v === "number"))
      errors.push(`${at} (${n?.name}): position must be [x, y] numbers.`);
    if (n.parameters !== undefined && (typeof n.parameters !== "object" || Array.isArray(n.parameters)))
      errors.push(`${at} (${n?.name}): parameters must be an object.`);
    if (/trigger|webhook/i.test(n.type ?? "")) hasTrigger = true;
    if (n.parameters && SECRET_HINT.test(JSON.stringify(n.parameters)))
      warnings.push(`${at} (${n.name}): parameters may contain a secret — use n8n credentials instead.`);
  });

  for (const [src, outputs] of Object.entries(w.connections!)) {
    if (!names.has(src)) errors.push(`connections: source "${src}" is not a node.`);
    for (const branches of Object.values(outputs ?? {})) {
      if (!Array.isArray(branches)) {
        errors.push(`connections["${src}"]: outputs must be arrays.`);
        continue;
      }
      for (const branch of branches) {
        for (const t of branch ?? []) {
          if (!names.has(t?.node)) errors.push(`connections: "${src}" → unknown node "${t?.node}".`);
        }
      }
    }
  }

  const connected = new Set<string>(Object.keys(w.connections!));
  for (const outputs of Object.values(w.connections!))
    for (const branches of Object.values(outputs ?? {})) for (const b of branches ?? []) for (const t of b ?? []) connected.add(t.node);
  for (const n of names) if (w.nodes!.length > 1 && !connected.has(n)) warnings.push(`Node "${n}" is not connected.`);

  if (!hasTrigger) warnings.push("No trigger/webhook node found — workflow can only run manually.");
  if (w.active) warnings.push("`active: true` is ignored — workflows are created inactive.");

  return { valid: errors.length === 0, errors, warnings };
}
