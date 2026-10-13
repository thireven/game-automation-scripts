// GAP Companion workflow runner -- generic, for any GAP script.
//
// **Vendor this file verbatim.** Copy it into another script's `src/`, list it
// before `index.ts` in that script's tsconfig, and add its globals to the
// minifier's `wanted` list. It references nothing outside itself and no game.
// The only host natives it uses, `gapRestartDevice` and `gapPerf`, are looked
// up on `globalThis` when present. The contract it implements is the app repo's
// `docs/WORKFLOWS.md` (§ 3 running, § 6 globals, § 7 state, § 8 events).
//
// What it does:
//   * keeps the catalog: the script's nodes (`gapWorkflowDefineNode`), its option
//     lists (`gapWorkflowDefineList`), plus the standard `loop` and `stop`, and
//     `restartDevice` / `restartIfSlow` when the engine can restart the device
//   * keeps the last sync (`gapWorkflowReceive`): the assigned workflow and the
//     account's presets, in memory only -- the engine re-delivers after a load
//   * checks a workflow against the catalog (`gapWorkflowCheck`)
//   * runs one: a cursor `{loop, index}`, per-loop values that cycle, the
//     standard nodes itself, and one node call per `gapWorkflowStep()`
//   * resumes one at a saved cursor (the ref's `at`) after a device restart
//   * reports state (`gapWorkflowState`) and emits events through the script's hook
//
// What the script does: define its nodes and lists, set the hooks, and from its
// own run call `gapWorkflowBegin` once, then `gapWorkflowStep` once per pass
// until it answers `finished` (`gapWorkflowAbort` if the run ends early).
//
// Top-level `function` declarations only, so the adapter's
// `typeof globalThis[name] === 'function'` check sees them. Complex values cross
// the bridge as JSON strings.

/** Catalog/runner version. The phone edits only catalogs it knows. */
const GAP_WORKFLOW_API = 1;
/** Tries a failing node gets before it is skipped. */
const GAP_WORKFLOW_MAX_TRIES = 3;
/** Most values one `perLoop` param may hold. */
const GAP_WORKFLOW_MAX_PER_LOOP = 20;
/** Longest string value or list value. */
const GAP_WORKFLOW_MAX_STRING = 200;
/** A node type or param key: `NAME` in the contract. */
const GAP_WORKFLOW_NAME = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
/** Standard node types a script may not define. */
const GAP_WORKFLOW_RESERVED = ['loop', 'stop', 'restartDevice', 'restartIfSlow'];
/** `restartIfSlow`'s window for `over: recent`: the last 30 minutes. */
const GAP_WORKFLOW_RECENT_MS = 30 * 60 * 1000;
/** Restart refusals that are the device's limits at work, not a failing step. */
const GAP_WORKFLOW_RESTART_LIMITS = ['restart-cooldown', 'restart-too-soon', 'restart-limit'];

type GapWorkflowScalar = string | number | boolean;
/** A node param value: a scalar, or one value per loop pass (they cycle). */
type GapWorkflowValue = GapWorkflowScalar | { perLoop: GapWorkflowScalar[] };

interface GapWorkflowListItem {
  value: string;
  label: string;
  favorite?: boolean; // the phone lists it first, starred
}

/** What the phone shows for a list that is `null` on this device. */
interface GapWorkflowListInfo {
  label: string;
  missing: string;
}

/** One param of a node: an adapter field, plus `lists`, `perLoop`, `perDevice`, `optional`. */
interface GapWorkflowParam {
  key: string;
  label: string;
  type: 'enum' | 'int' | 'bool' | 'string';
  options?: GapWorkflowListItem[];
  lists?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  help?: string;
  default?: GapWorkflowScalar;
  perLoop?: boolean;
  /** The phone may set one value per device; the server sends each device its own. */
  perDevice?: boolean;
  optional?: boolean;
}

/**
 * What a node call answers. `again` = call me on the next step; `wait` = the
 * same, but nothing is ready, so the script should rest first.
 */
type GapWorkflowResult = 'done' | 'again' | 'wait' | { fail: string } | { terminate: string };

/** What a node's `run` is handed. `params` are resolved for this loop pass. */
interface GapWorkflowCtx {
  params: { [key: string]: GapWorkflowScalar };
  loop: number;
  index: number;
  nodeId: string;
  type: string;
  /** 1 on the first try; a retry after `fail` counts up. */
  tries: number;
  /** The progress text `gapWorkflowState().detail` shows; null clears it. */
  setDetail(text: string | null): void;
}

interface GapWorkflowNodeDef {
  type: string;
  label: string;
  group?: string;
  help?: string;
  params: GapWorkflowParam[];
  run(ctx: GapWorkflowCtx): GapWorkflowResult;
}

interface GapWorkflowNode {
  id: string;
  type: string;
  params: { [key: string]: GapWorkflowValue };
}

interface GapWorkflow {
  id: string;
  rev: number;
  name: string;
  nodes: GapWorkflowNode[];
}

/** A cursor: pass `loop` (from 1), node `index` (from 0). */
interface GapWorkflowAt {
  loop: number;
  index: number;
}

interface GapWorkflowPreset {
  id: string;
  name: string;
  values: { [key: string]: GapWorkflowScalar };
}

interface GapWorkflowHooks {
  /** Sends one script event (`workflow.*`, docs/WORKFLOWS.md § 8). */
  emit(event: string, data: { [key: string]: unknown }): void;
  /** Device-specific blockers: a code refuses the start, null passes. */
  check?(workflow: GapWorkflow, presets: GapWorkflowPreset[]): string | null;
}

/** docs/WORKFLOWS.md § 7. */
interface GapWorkflowState {
  id: string;
  rev: number;
  name: string;
  loop: number;
  index: number;
  nodeId: string | null;
  node: string | null;
  total: number;
  detail: string | null;
  status: 'running' | 'ended' | 'failed' | 'terminated';
  reason?: string;
}

/** The running (or last) workflow: a snapshot plus its cursor. */
interface GapWorkflowRun {
  workflow: GapWorkflow;
  presets: GapWorkflowPreset[];
  state: GapWorkflowState;
  /** Tries of the node under the cursor; 0 until its first call. */
  tries: number;
  /** When the run (or the resumed run) began, epoch ms: `restartIfSlow` `over: run`. */
  startedAt: number;
  /** When the current loop pass began, epoch ms: `restartIfSlow` `over: loop`. */
  loopStartedAt: number;
  /** When the previous pass began: `over: loop` before this pass ran any work. */
  prevLoopStartedAt: number;
}

/** Script node types in catalog order; the standard ones follow them. */
let gapWorkflowNodeOrder: string[] = [];
let gapWorkflowNodes: { [type: string]: GapWorkflowNodeDef } = {};
let gapWorkflowListOrder: string[] = [];
let gapWorkflowLists: { [name: string]: () => GapWorkflowListItem[] | null } = {};
let gapWorkflowListInfos: { [name: string]: GapWorkflowListInfo } = {};
let gapWorkflowHooks: GapWorkflowHooks | null = null;
/** The last sync accepted, or null before the first. */
let gapWorkflowSynced: { hash: string; presets: GapWorkflowPreset[]; workflow: GapWorkflow | null } | null = null;
let gapWorkflowRun: GapWorkflowRun | null = null;

// --- Registration (called by the script at load) ----------------------------

/** Registers a node type. The standard types (`GAP_WORKFLOW_RESERVED`) are the library's own. */
function gapWorkflowDefineNode(def: GapWorkflowNodeDef): void {
  if (!GAP_WORKFLOW_NAME.test(def.type) || GAP_WORKFLOW_RESERVED.indexOf(def.type) >= 0) {
    throw new Error('gapWorkflowDefineNode: bad type ' + def.type);
  }
  if (gapWorkflowNodes[def.type] === undefined) {
    gapWorkflowNodeOrder.push(def.type);
  }
  gapWorkflowNodes[def.type] = def;
}

/**
 * Registers an option list. `provider` is asked on every catalog and check, and
 * returns null when this device cannot provide the list now; `info` is what the
 * phone then tells the user. `presets` is reserved: the phone fills it.
 */
function gapWorkflowDefineList(name: string, provider: () => GapWorkflowListItem[] | null,
                               info?: GapWorkflowListInfo): void {
  if (!GAP_WORKFLOW_NAME.test(name) || name === 'presets') {
    throw new Error('gapWorkflowDefineList: bad list ' + name);
  }
  if (gapWorkflowLists[name] === undefined) {
    gapWorkflowListOrder.push(name);
  }
  gapWorkflowLists[name] = provider;
  if (info !== undefined) {
    gapWorkflowListInfos[name] = info;
  }
}

function gapWorkflowSetHooks(hooks: GapWorkflowHooks): void {
  gapWorkflowHooks = hooks;
}

/**
 * The hooks, or ones that do nothing when the script set none. `emit` swallows
 * a throw: host trouble sending an event must not stall or end the runner.
 */
function gapWorkflowHooksOf(): GapWorkflowHooks {
  const hooks = gapWorkflowHooks;
  if (hooks === null) {
    return { emit: function() {} };
  }
  return {
    emit: function(event: string, data: { [key: string]: unknown }): void {
      try {
        hooks.emit(event, data);
      } catch (e) {
        // Dropped; the state read (`gapWorkflowState`) still has it.
      }
    },
    check: hooks.check !== undefined ? hooks.check.bind(hooks) : undefined,
  };
}

// --- The standard nodes -------------------------------------------------------

/**
 * The standard nodes, in catalog order. Their behaviour is in `gapWorkflowStep`
 * (the restart pair in `gapWorkflowRestartStep`); `run` is never called.
 */
const GapWorkflowStandard: GapWorkflowNodeDef[] = [
  {
    type: 'restartDevice', label: 'Restart device',
    help: 'Restarts the device. The workflow carries on at the next step.',
    params: [{ key: 'minUptime', label: 'Minimum uptime', type: 'int', min: 0, max: 1440, step: 15,
      unit: 'min', optional: true,
      help: 'Skip the restart when the device has been up for less. Empty = the device setting.' }],
    run: function() { return 'done'; },
  },
  {
    type: 'restartIfSlow', label: 'Restart if slow',
    help: 'Restarts the device when the script ran slower than after the last restart. '
      + 'The workflow carries on at the next step.',
    params: [
      { key: 'over', label: 'Measured over', type: 'enum', default: 'loop', optional: true,
        options: [{ value: 'loop', label: 'This loop' }, { value: 'run', label: 'This run' },
          { value: 'recent', label: 'Last 30 minutes' }] },
      { key: 'fpsDrop', label: 'Frame rate drop', type: 'int', min: 5, max: 95, step: 5, unit: '%',
        optional: true, help: 'Empty = the device setting.' },
      { key: 'captureRise', label: 'Capture slower by', type: 'int', min: 10, max: 1000, step: 10,
        unit: '%', optional: true, help: 'Empty = the device setting.' },
    ],
    run: function() { return 'done'; },
  },
  {
    type: 'loop', label: 'Loop', help: '0 = forever',
    params: [{ key: 'times', label: 'Times', type: 'int', min: 0, max: 999, step: 1,
      default: 0, optional: true }],
    run: function() { return 'done'; },
  },
  { type: 'stop', label: 'Stop', params: [], run: function() { return 'done'; } },
];

/** A host native that takes and answers JSON, or null when this engine lacks it. */
function gapWorkflowNative(name: 'gapRestartDevice' | 'gapPerf'): ((json: string) => string) | null {
  const fn = (globalThis as unknown as { [key: string]: unknown })[name];
  return typeof fn === 'function' ? fn as (json: string) => string : null;
}

/** The standard types this device offers: the restart pair only when the engine has `gapRestartDevice`. */
function gapWorkflowStandardTypes(): string[] {
  return gapWorkflowNative('gapRestartDevice') !== null
    ? ['restartDevice', 'restartIfSlow', 'loop', 'stop'] : ['loop', 'stop'];
}

/** A script node, or a standard one; undefined for a type nobody defined (or a restart node without the native). */
function gapWorkflowDef(type: string): GapWorkflowNodeDef | undefined {
  if (gapWorkflowNodes[type] !== undefined) {
    return gapWorkflowNodes[type];
  }
  if (gapWorkflowStandardTypes().indexOf(type) < 0) {
    return undefined;
  }
  for (let i = 0; i < GapWorkflowStandard.length; i++) {
    if (GapWorkflowStandard[i].type === type) {
      return GapWorkflowStandard[i];
    }
  }
  return undefined;
}

// --- Globals the adapter calls --------------------------------------------------

/** Every list by name; a provider that throws counts as null. */
function gapWorkflowListValues(): { [name: string]: GapWorkflowListItem[] | null } {
  const out: { [name: string]: GapWorkflowListItem[] | null } = {};
  for (let i = 0; i < gapWorkflowListOrder.length; i++) {
    const name = gapWorkflowListOrder[i];
    let items: GapWorkflowListItem[] | null = null;
    try {
      items = gapWorkflowLists[name]();
    } catch (e) {
      items = null;
    }
    out[name] = Array.isArray(items) ? items : null;
  }
  return out;
}

/** JSON `{api, nodes, lists, listInfo?}` -- the companion adapter adds `syncHash`, `presetFields`, `stats` and `screens`. */
function gapWorkflowCatalog(): string {
  const nodes: { [key: string]: unknown }[] = [];
  const types = gapWorkflowNodeOrder.concat(gapWorkflowStandardTypes());
  for (let i = 0; i < types.length; i++) {
    const def = gapWorkflowDef(types[i])!;
    const node: { [key: string]: unknown } = { type: def.type, label: def.label };
    if (def.group !== undefined) {
      node.group = def.group;
    }
    if (def.help !== undefined) {
      node.help = def.help;
    }
    node.params = def.params;
    nodes.push(node);
  }
  const catalog: { [key: string]: unknown } = {
    api: GAP_WORKFLOW_API, nodes: nodes, lists: gapWorkflowListValues(),
  };
  if (Object.keys(gapWorkflowListInfos).length > 0) {
    catalog.listInfo = gapWorkflowListInfos;
  }
  return JSON.stringify(catalog);
}

function gapWorkflowIsScalar(v: unknown): v is GapWorkflowScalar {
  return typeof v === 'string' || typeof v === 'boolean'
    || (typeof v === 'number' && isFinite(v));
}

function gapWorkflowIsObject(v: unknown): v is { [key: string]: unknown } {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** A workflow's outer shape (ids, nodes, params as values); null when it is not one. */
function gapWorkflowParse(raw: unknown): GapWorkflow | null {
  if (!gapWorkflowIsObject(raw) || typeof raw.id !== 'string' || typeof raw.rev !== 'number'
      || !Array.isArray(raw.nodes)) {
    return null;
  }
  const nodes: GapWorkflowNode[] = [];
  for (let i = 0; i < raw.nodes.length; i++) {
    const node = raw.nodes[i];
    if (!gapWorkflowIsObject(node) || typeof node.id !== 'string' || typeof node.type !== 'string') {
      return null;
    }
    const params = gapWorkflowIsObject(node.params) ? node.params : {};
    nodes.push({ id: node.id, type: node.type, params: params as { [key: string]: GapWorkflowValue } });
  }
  return { id: raw.id, rev: raw.rev, name: typeof raw.name === 'string' ? raw.name : '', nodes: nodes };
}

/** Presets with an id and scalar values; anything else is dropped. */
function gapWorkflowParsePresets(raw: unknown[]): GapWorkflowPreset[] {
  const out: GapWorkflowPreset[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (!gapWorkflowIsObject(p) || typeof p.id !== 'string' || !gapWorkflowIsObject(p.values)) {
      continue;
    }
    const values: { [key: string]: GapWorkflowScalar } = {};
    for (const key in p.values) {
      const v = p.values[key];
      if (gapWorkflowIsScalar(v)) {
        values[key] = v;
      }
    }
    out.push({ id: p.id, name: typeof p.name === 'string' ? p.name : p.id, values: values });
  }
  return out;
}

/**
 * Takes a sync payload `{hash, presets, workflow}` and keeps it in memory. A run
 * already going keeps its snapshot; this is for the next start.
 */
function gapWorkflowReceive(json: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch (e) {
    return JSON.stringify({ ok: false, error: 'bad-sync' });
  }
  if (!gapWorkflowIsObject(payload) || typeof payload.hash !== 'string'
      || !Array.isArray(payload.presets)) {
    return JSON.stringify({ ok: false, error: 'bad-sync' });
  }
  let workflow: GapWorkflow | null = null;
  if (payload.workflow !== null && payload.workflow !== undefined) {
    workflow = gapWorkflowParse(payload.workflow);
    if (workflow === null) {
      return JSON.stringify({ ok: false, error: 'bad-sync' });
    }
  }
  gapWorkflowSynced = {
    hash: payload.hash, presets: gapWorkflowParsePresets(payload.presets), workflow: workflow,
  };
  return JSON.stringify({ ok: true });
}

/** JSON WorkflowState of the current or last workflow, or `"null"`. */
function gapWorkflowState(): string {
  return gapWorkflowRun === null ? 'null' : JSON.stringify(gapWorkflowRun.state);
}

/** A preset of the running snapshot (else of the last sync) by id, or null. */
function gapWorkflowPreset(id: string): GapWorkflowPreset | null {
  const list = gapWorkflowRun !== null ? gapWorkflowRun.presets
    : gapWorkflowSynced !== null ? gapWorkflowSynced.presets : [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return list[i];
    }
  }
  return null;
}

// --- Checking -----------------------------------------------------------------

/** Every value a param holds: the scalar, or each per-loop entry. */
function gapWorkflowValuesOf(value: GapWorkflowValue): GapWorkflowScalar[] {
  return gapWorkflowIsObject(value) ? (value as { perLoop: GapWorkflowScalar[] }).perLoop : [value];
}

/** Step 3: required params present, `perLoop` only where allowed, 1..20 scalars. */
function gapWorkflowShapeOk(node: GapWorkflowNode, def: GapWorkflowNodeDef): boolean {
  for (let i = 0; i < def.params.length; i++) {
    const param = def.params[i];
    const value = node.params[param.key];
    if (value === undefined || value === null) {
      if (param.optional !== true) {
        return false;
      }
      continue;
    }
    if (gapWorkflowIsObject(value)) {
      const list = (value as { perLoop?: unknown }).perLoop;
      if (param.perLoop !== true || !Array.isArray(list) || list.length < 1
          || list.length > GAP_WORKFLOW_MAX_PER_LOOP) {
        return false;
      }
      for (let j = 0; j < list.length; j++) {
        if (!gapWorkflowIsScalar(list[j])) {
          return false;
        }
      }
    } else if (!gapWorkflowIsScalar(value)) {
      return false;
    }
  }
  return true;
}

/**
 * Step 5: one value against its param. Answers null (fine), `bad`, or
 * `no-preset`. A value only a `null` list could hold is let through: that is
 * the script check's business (step 4).
 */
function gapWorkflowValueError(param: GapWorkflowParam, value: GapWorkflowScalar,
                               lists: { [name: string]: GapWorkflowListItem[] | null },
                               presets: GapWorkflowPreset[]): string | null {
  if (typeof value === 'string' && value.length > GAP_WORKFLOW_MAX_STRING) {
    return 'bad';
  }
  switch (param.type) {
    case 'bool':
      return typeof value === 'boolean' ? null : 'bad';
    case 'string':
      return typeof value === 'string' ? null : 'bad';
    case 'int': {
      if (typeof value !== 'number' || Math.floor(value) !== value) {
        return 'bad';
      }
      const min = param.min !== undefined ? param.min : -Infinity;
      const max = param.max !== undefined ? param.max : Infinity;
      const step = param.step !== undefined && param.step > 0 ? param.step : 1;
      const base = param.min !== undefined ? param.min : 0;
      return value < min || value > max || (value - base) % step !== 0 ? 'bad' : null;
    }
    case 'enum': {
      if (typeof value !== 'string') {
        return 'bad';
      }
      if (param.options !== undefined) {
        for (let i = 0; i < param.options.length; i++) {
          if (param.options[i].value === value) {
            return null;
          }
        }
        return 'bad';
      }
      const names = param.lists || [];
      let unknownList = false;
      for (let i = 0; i < names.length; i++) {
        if (names[i] === 'presets') {
          if (value.indexOf('preset:') === 0) {
            const id = value.substring(7);
            for (let j = 0; j < presets.length; j++) {
              if (presets[j].id === id) {
                return null;
              }
            }
            return 'no-preset';
          }
          continue;
        }
        const items = lists[names[i]];
        if (items === null || items === undefined) {
          unknownList = true;
          continue;
        }
        for (let j = 0; j < items.length; j++) {
          if (items[j].value === value) {
            return null;
          }
        }
      }
      return unknownList ? null : 'bad';
    }
  }
  return 'bad';
}

/** `gapWorkflowCheck` against a workflow already found; the error code or null. */
function gapWorkflowCheckWorkflow(workflow: GapWorkflow, presets: GapWorkflowPreset[]): string | null {
  // 2. Types this script cannot run.
  const missing: string[] = [];
  for (let i = 0; i < workflow.nodes.length; i++) {
    const type = workflow.nodes[i].type;
    if (gapWorkflowDef(type) === undefined && missing.indexOf(type) < 0) {
      missing.push(type);
    }
  }
  if (missing.length > 0) {
    return 'workflow-unsupported:' + missing.sort().join(',');
  }
  // 3. Shape.
  for (let i = 0; i < workflow.nodes.length; i++) {
    const node = workflow.nodes[i];
    if (!gapWorkflowShapeOk(node, gapWorkflowDef(node.type)!)) {
      return 'bad-workflow:' + node.id;
    }
  }
  // 4. The script's own blockers.
  const hooks = gapWorkflowHooksOf();
  if (hooks.check !== undefined) {
    const code = hooks.check(workflow, presets);
    if (code !== null && code !== undefined && code !== '') {
      return code;
    }
  }
  // 5. Values.
  const lists = gapWorkflowListValues();
  for (let i = 0; i < workflow.nodes.length; i++) {
    const node = workflow.nodes[i];
    const def = gapWorkflowDef(node.type)!;
    for (let p = 0; p < def.params.length; p++) {
      const value = node.params[def.params[p].key];
      if (value === undefined || value === null) {
        continue;
      }
      const values = gapWorkflowValuesOf(value);
      for (let v = 0; v < values.length; v++) {
        const error = gapWorkflowValueError(def.params[p], values[v], lists, presets);
        if (error === 'no-preset') {
          return 'no-preset';
        }
        if (error !== null) {
          return 'bad-workflow:' + node.id;
        }
      }
    }
  }
  return null;
}

/** A cursor `{loop >= 1, index >= 0}` (whole numbers), or null when `raw` is not one. */
function gapWorkflowAtOf(raw: unknown): GapWorkflowAt | null {
  if (!gapWorkflowIsObject(raw)) {
    return null;
  }
  const loop = raw.loop;
  const index = raw.index;
  if (typeof loop !== 'number' || typeof index !== 'number' || Math.floor(loop) !== loop
      || Math.floor(index) !== index || loop < 1 || index < 0) {
    return null;
  }
  return { loop: loop, index: index };
}

/**
 * The error code for starting `refJson` (`{id, rev, at?}`), or null when it may
 * start. `at` (where a resume starts) must be a valid cursor when present.
 */
function gapWorkflowCheckRef(refJson: string): string | null {
  let ref: unknown;
  try {
    ref = JSON.parse(refJson);
  } catch (e) {
    return 'bad-args';
  }
  if (!gapWorkflowIsObject(ref) || typeof ref.id !== 'string' || typeof ref.rev !== 'number'
      || (ref.at !== undefined && ref.at !== null && gapWorkflowAtOf(ref.at) === null)) {
    return 'bad-args';
  }
  // 1. Is it the one this device holds?
  const workflow = gapWorkflowSynced !== null ? gapWorkflowSynced.workflow : null;
  if (workflow === null) {
    return 'no-workflow';
  }
  if (workflow.id !== ref.id || workflow.rev !== ref.rev) {
    return 'workflow-stale';
  }
  return gapWorkflowCheckWorkflow(workflow, gapWorkflowSynced!.presets);
}

/** JSON `{ok: true}` or `{ok: false, error}`. Never touches the game. */
function gapWorkflowCheck(refJson: string): string {
  const error = gapWorkflowCheckRef(refJson);
  return JSON.stringify(error === null ? { ok: true } : { ok: false, error: error });
}

// --- Running ------------------------------------------------------------------

/** The node under the cursor, or undefined past the end. */
function gapWorkflowCurrent(run: GapWorkflowRun): GapWorkflowNode | undefined {
  return run.workflow.nodes[run.state.index];
}

/** Points `state.nodeId`/`node` at the cursor and clears the per-node fields. */
function gapWorkflowMoveTo(run: GapWorkflowRun, loop: number, index: number): void {
  run.state.loop = loop;
  run.state.index = index;
  const node = gapWorkflowCurrent(run);
  run.state.nodeId = node === undefined ? null : node.id;
  run.state.node = node === undefined ? null : node.type;
  run.state.detail = null;
  run.tries = 0;
}

/** Ends the workflow; the one place `workflow.end` is emitted. */
function gapWorkflowFinish(run: GapWorkflowRun, status: GapWorkflowState['status'], reason: string): void {
  run.state.status = status;
  run.state.reason = reason;
  gapWorkflowHooksOf().emit('workflow.end', {
    id: run.state.id, rev: run.state.rev, status: status, reason: reason,
    loop: run.state.loop, index: run.state.index,
  });
}

/** The node's params for this loop pass: per-loop values cycle, omitted ones are absent. */
function gapWorkflowResolve(node: GapWorkflowNode, loop: number): { [key: string]: GapWorkflowScalar } {
  const out: { [key: string]: GapWorkflowScalar } = {};
  for (const key in node.params) {
    const value = node.params[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (gapWorkflowIsObject(value)) {
      const list = (value as { perLoop: GapWorkflowScalar[] }).perLoop;
      out[key] = list[(loop - 1) % list.length];
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Starts the workflow `refJson` names, at run start. Checks it, snapshots it
 * (with the presets) and emits `workflow.start`. Returns null, or the error
 * code after ending the workflow as `terminated` with it.
 *
 * A ref with `at` resumes there (after a device restart): `workflow.start`
 * carries `resumed: {loop, index}`. An `at` past the last node starts it
 * plainly (no `resumed`) and the first step ends it as `end`.
 */
function gapWorkflowBegin(refJson: string): string | null {
  const error = gapWorkflowCheckRef(refJson);
  const ref = gapWorkflowRefOf(refJson);
  const synced = gapWorkflowSynced !== null ? gapWorkflowSynced.workflow : null;
  // A copy, so a sync arriving mid-run does not change what is running. A
  // refused ref is reported under its own id and rev (the phone matches on
  // both), so a stale rev does not end as the synced one.
  const workflow: GapWorkflow = error === null && synced !== null && synced.id === ref.id
    ? JSON.parse(JSON.stringify(synced))
    : { id: ref.id, rev: ref.rev, name: synced !== null && synced.id === ref.id ? synced.name : '',
      nodes: [] };
  const presets: GapWorkflowPreset[] = gapWorkflowSynced !== null
    ? JSON.parse(JSON.stringify(gapWorkflowSynced.presets)) : [];
  const now = Date.now();
  const run: GapWorkflowRun = {
    workflow: workflow, presets: presets, tries: 0, startedAt: now, loopStartedAt: now,
    prevLoopStartedAt: now,
    state: {
      id: workflow.id, rev: workflow.rev, name: workflow.name, loop: 1, index: 0,
      nodeId: null, node: null, total: workflow.nodes.length, detail: null, status: 'running',
    },
  };
  const at = error === null ? ref.at : null;
  gapWorkflowMoveTo(run, at !== null ? at.loop : 1, at !== null ? at.index : 0);
  gapWorkflowRun = run;
  if (error !== null) {
    gapWorkflowFinish(run, 'terminated', error);
    return error;
  }
  // Only a step that exists is resumed; past the end there is nothing to resume.
  const resumed = at !== null && gapWorkflowCurrent(run) !== undefined;
  gapWorkflowHooksOf().emit('workflow.start', {
    id: workflow.id, rev: workflow.rev, name: workflow.name, total: workflow.nodes.length,
    resumed: resumed && at !== null ? { loop: at.loop, index: at.index } : undefined,
  });
  return null;
}

/** The ref's id, rev and `at`: '', 0 and null where unreadable. */
function gapWorkflowRefOf(refJson: string): { id: string; rev: number; at: GapWorkflowAt | null } {
  try {
    const ref = JSON.parse(refJson);
    return {
      id: gapWorkflowIsObject(ref) && typeof ref.id === 'string' ? ref.id : '',
      rev: gapWorkflowIsObject(ref) && typeof ref.rev === 'number' ? ref.rev : 0,
      at: gapWorkflowIsObject(ref) ? gapWorkflowAtOf(ref.at) : null,
    };
  } catch (e) {
    return { id: '', rev: 0, at: null };
  }
}

/** Moves to the next node; past the end is an implicit stop. */
function gapWorkflowAdvance(run: GapWorkflowRun): void {
  gapWorkflowMoveTo(run, run.state.loop, run.state.index + 1);
}

/**
 * Runs at most one node call. `continue` = call again on the next pass; `wait`
 * = nothing ready, rest first; `finished` = the workflow is over (the script
 * ends its run).
 */
function gapWorkflowStep(): 'continue' | 'wait' | 'finished' {
  const run = gapWorkflowRun;
  if (run === null || run.state.status !== 'running') {
    return 'finished';
  }
  const node = gapWorkflowCurrent(run);
  if (node === undefined) {
    gapWorkflowFinish(run, 'ended', 'end');
    return 'finished';
  }
  const state = run.state;
  if (run.tries === 0) {
    // First call of this node in this pass: the one `workflow.node` for it.
    gapWorkflowHooksOf().emit('workflow.node', {
      id: state.id, loop: state.loop, index: state.index, nodeId: node.id, node: node.type,
    });
    run.tries = 1;
  }
  const params = gapWorkflowResolve(node, state.loop);
  if (node.type === 'stop') {
    gapWorkflowFinish(run, 'ended', 'stop');
    return 'finished';
  }
  if (node.type === 'loop') {
    const times = typeof params.times === 'number' ? params.times : 0;
    if (times === 0 || state.loop < times) {
      gapWorkflowMoveTo(run, state.loop + 1, 0);
      run.prevLoopStartedAt = run.loopStartedAt;
      run.loopStartedAt = Date.now();
      gapWorkflowHooksOf().emit('workflow.loop', { id: state.id, loop: state.loop });
    } else {
      gapWorkflowAdvance(run);
    }
    return 'continue';
  }
  if ((node.type === 'restartDevice' || node.type === 'restartIfSlow')
      && gapWorkflowDef(node.type) !== undefined) {
    return gapWorkflowRestartStep(run, node, params);
  }

  const def = gapWorkflowNodes[node.type];
  let result: GapWorkflowResult;
  try {
    result = def === undefined ? { fail: 'workflow-unsupported:' + node.type } : def.run({
      params: params, loop: state.loop, index: state.index, nodeId: node.id, type: node.type,
      tries: run.tries,
      setDetail: function(text: string | null) {
        if (gapWorkflowRun === run && gapWorkflowCurrent(run) === node) {
          state.detail = text;
        }
      },
    });
  } catch (e) {
    // By shape rather than `instanceof`: an error from another realm is one too.
    const message = e !== null && typeof e === 'object' ? (e as { message?: unknown }).message : undefined;
    result = { fail: typeof message === 'string' ? message : String(e) };
  }
  if (gapWorkflowRun !== run || state.status !== 'running') {
    // Aborted from inside the node (the run was stopped).
    return 'finished';
  }
  if (result === 'done') {
    gapWorkflowAdvance(run);
    return 'continue';
  }
  if (result === 'again') {
    return 'continue';
  }
  if (result === 'wait') {
    return 'wait';
  }
  if (gapWorkflowIsObject(result) && typeof (result as { terminate?: unknown }).terminate === 'string') {
    gapWorkflowFinish(run, 'terminated', (result as { terminate: string }).terminate);
    return 'finished';
  }
  const error = gapWorkflowIsObject(result) && typeof (result as { fail?: unknown }).fail === 'string'
    ? (result as { fail: string }).fail : 'bad-result';
  if (run.tries >= GAP_WORKFLOW_MAX_TRIES) {
    gapWorkflowHooksOf().emit('workflow.nodeFailed', {
      id: state.id, loop: state.loop, index: state.index, nodeId: node.id, node: node.type,
      error: error, tries: run.tries,
    });
    gapWorkflowAdvance(run);
    return 'continue';
  }
  run.tries++;
  // A retry rests first: whatever failed is unlikely to pass a moment later.
  return 'wait';
}

/** A native's JSON answer as an object; `{ok: false, error: fallback}` when it is missing, throws or answers garbage. */
function gapWorkflowCallNative(name: 'gapRestartDevice' | 'gapPerf', opts: { [key: string]: unknown },
                               fallback: string): { [key: string]: unknown } {
  const fn = gapWorkflowNative(name);
  if (fn === null) {
    return { ok: false, error: fallback };
  }
  try {
    const answer = JSON.parse(fn(JSON.stringify(opts)));
    return gapWorkflowIsObject(answer) ? answer : { ok: false, error: fallback };
  } catch (e) {
    return { ok: false, error: fallback };
  }
}

/** A finite number from a native's answer, or undefined (so the event leaves it out). */
function gapWorkflowNumberOf(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

/**
 * `restartDevice` and `restartIfSlow`, one call. `restartIfSlow` first asks
 * `gapPerf` whether the script ran slow over its window (`over`); not slow
 * moves on. A restart the engine accepts ends the workflow as `restart`, saving
 * the next step as the cursor it resumes at. A refusal moves on; one that is
 * not just the device's limits (cooldown, too soon, daily limit) also counts
 * as a failed step. Every outcome emits one `workflow.restart`. Any outcome
 * but a restart answers `wait`, so a loop of only these nodes rests between
 * passes instead of spinning.
 */
function gapWorkflowRestartStep(run: GapWorkflowRun, node: GapWorkflowNode,
                                params: { [key: string]: GapWorkflowScalar }): 'wait' | 'finished' {
  const state = run.state;
  let outcome: 'restarting' | 'skipped' | 'not-slow' = 'restarting';
  let error: string | undefined;
  let why: string | undefined;
  let fps: number | undefined;
  let captureMs: number | undefined;
  let slow = true;
  if (node.type === 'restartIfSlow') {
    const now = Date.now();
    const sinceMs = params.over === 'run' ? run.startedAt
      : params.over === 'recent' ? now - GAP_WORKFLOW_RECENT_MS
      : gapWorkflowPassWorked(run) ? run.loopStartedAt : run.prevLoopStartedAt;
    const opts: { [key: string]: unknown } = { sinceMs: sinceMs };
    if (typeof params.fpsDrop === 'number') {
      opts.fpsDropPct = params.fpsDrop;
    }
    if (typeof params.captureRise === 'number') {
      opts.captureRisePct = params.captureRise;
    }
    const perf = gapWorkflowCallNative('gapPerf', opts, 'perf-failed');
    why = typeof perf.why === 'string' ? perf.why : undefined;
    fps = gapWorkflowNumberOf(perf.fps);
    captureMs = gapWorkflowNumberOf(perf.captureMs);
    if (perf.ok !== true) {
      outcome = 'skipped';
      error = typeof perf.error === 'string' ? perf.error : 'perf-failed';
      slow = false;
    } else if (perf.slow !== true) {
      outcome = 'not-slow';
      slow = false;
    }
  }
  if (slow) {
    const opts: { [key: string]: unknown } = {
      reason: node.type === 'restartIfSlow' ? 'slow' : 'workflow',
      // The step after this one: the workflow carries on there after the restart.
      workflow: { id: state.id, rev: state.rev, at: { loop: state.loop, index: state.index + 1 } },
    };
    if (node.type === 'restartDevice' && typeof params.minUptime === 'number') {
      opts.minUptimeMin = params.minUptime;
    }
    const answer = gapWorkflowCallNative('gapRestartDevice', opts, 'restart-failed');
    if (answer.ok !== true) {
      outcome = 'skipped';
      error = typeof answer.error === 'string' ? answer.error : 'restart-failed';
    }
  }
  gapWorkflowHooksOf().emit('workflow.restart', {
    id: state.id, nodeId: node.id, index: state.index, loop: state.loop, outcome: outcome,
    error: error, why: why, fps: fps, captureMs: captureMs,
  });
  if (outcome === 'restarting') {
    // The engine stops the run and reboots; the script just ends its run.
    gapWorkflowFinish(run, 'ended', 'restart');
    return 'finished';
  }
  if (outcome === 'skipped' && error !== undefined && GAP_WORKFLOW_RESTART_LIMITS.indexOf(error) < 0) {
    // Not retried: a refusal would only repeat.
    gapWorkflowHooksOf().emit('workflow.nodeFailed', {
      id: state.id, loop: state.loop, index: state.index, nodeId: node.id, node: node.type,
      error: error, tries: run.tries,
    });
  }
  gapWorkflowAdvance(run);
  return 'wait';
}

/**
 * True when a script node came before the cursor in this pass. Before that
 * (e.g. `restartIfSlow` first in the loop) this pass measured nothing yet, so
 * `over: loop` looks at the previous pass instead.
 */
function gapWorkflowPassWorked(run: GapWorkflowRun): boolean {
  const nodes = run.workflow.nodes;
  for (let i = 0; i < run.state.index && i < nodes.length; i++) {
    if (GAP_WORKFLOW_RESERVED.indexOf(nodes[i].type) < 0) {
      return true;
    }
  }
  return false;
}

/** The run is ending early: `stopped` (status `ended`), or `error` (status `failed`). */
function gapWorkflowAbort(reason: string): void {
  const run = gapWorkflowRun;
  if (run === null || run.state.status !== 'running') {
    return;
  }
  gapWorkflowFinish(run, reason === 'error' ? 'failed' : 'ended', reason);
}
