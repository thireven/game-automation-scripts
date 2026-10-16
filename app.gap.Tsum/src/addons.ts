// --- Script add-ons: the hooks an add-on registers through --------------------
//
// An add-on is extra code GAP evaluates into this script's global scope after
// the bundle loads (GAP Companion delivers it to the accounts it is granted
// to). It calls `gapAddonRegister` once, and the base reads the registries
// below where it builds the phone's actions, state and screens
// (src/companion.ts, src/companionScreens.ts), at a run's start and end
// (`buildRun` / `endRun`, src/index.ts) and after each round's stats row
// (`finishRoundStats`, src/roundStats.ts). One add-on may be the director, which
// answers user direction requests (`requestUserDirection`, `gapDirect`,
// src/companion.ts). Workflow nodes need no hook: an add-on calls
// `gapWorkflowDefineNode` (src/gapWorkflow.ts) itself.
//
// Every other base global is reachable directly, since the bundle is one
// script. An add-on compiles against build/index.d.ts, which the build writes.
// It logs under its own `addon.<name>.*` events and queues its one-shot task
// at `JobPriority.AddonNow`; its constants, probes and texts stay in the add-on.
// Bump GAP_ADDON_API when a change here would break an existing add-on, and
// when a const enum value an add-on uses changes (tsc copies those values into
// the add-on: JobPriority.AddonNow, PageName, CollectionSort, Log.*).

/** The hook API version. An add-on built for another one is refused. */
const GAP_ADDON_API = 1;

/** A phone action, the shape of a `CompanionRemoteActions` entry. */
interface GapAddonAction {
  name: string;
  label: string;
  role?: string;
  args?: { [key: string]: unknown };
}

/** What a user direction request asks; the server has defaults for both. */
interface GapAddonDirectOptions {
  /** ≤ 80 characters. */
  title?: string;
  /** ≤ 300 characters, e.g. "Paused on an unfamiliar screen." */
  body?: string;
}

/** How a request ended: Continue pressed, the wait ran out, or the run stopped. */
type GapAddonDirectOutcome = 'continue' | 'timeout' | 'stopped';

/**
 * Handles user direction requests (the companion's IUD-PLAN.md): the phone
 * shows the screen, the user sends taps and drags, then Continue.
 */
interface GapAddonDirector {
  /**
   * Opens a request and waits for it to end, on the run thread. Performs the
   * actions `receive` queued. Must return when `run.isRunning` goes false.
   */
  request(run: Tsum, opts: GapAddonDirectOptions): GapAddonDirectOutcome;
  /**
   * `gapDirect`'s op ('play' | 'continue') and parsed args (null when unparsable),
   * on the companion's thread outside the pause gate: check and store only,
   * never tap or sleep. Answers `{ok: true, ...}` or `{ok: false, why}`.
   */
  receive(op: string, args: unknown): { ok: boolean; why?: string; [key: string]: unknown };
}

/** What an add-on's `install` is handed. */
interface GapAddonHost {
  api: number;
  /** Adds phone actions; `run` answers them as `gapRemoteAction` does (a JSON string). */
  addActions(actions: GapAddonAction[], run: (name: string, argsJson: string) => string): void;
  /** Merged into `gapRemoteState().info`, asked on every state read. */
  addStateInfo(fn: () => Record<string, unknown>): void;
  /** Task names as a person reads them, merged into `CompanionTasks`. */
  addTaskLabels(labels: Record<string, string>): void;
  /** Extra facts and screen items (e.g. `{button: name}`) on the Stats tab's My Tsum card. */
  addMyTsumCard(part: { facts?: unknown[]; buttons?: unknown[] }): void;
  /** A card (`{card, icon, items}`) on the Stats tab, after the My Tsum card. */
  addStatsCard(card: unknown): void;
  /** Called at each run's start; at once if a run is already going. */
  onRunStart(fn: (run: Tsum, controller: TsumTaskController) => void): void;
  /** Called as each run ends, before `ts` is cleared. */
  onRunEnd(fn: () => void): void;
  /**
   * Called once a round's stats row is written, with the finished score page
   * still on screen (not called when it never showed). `round` is what was read.
   */
  onRoundStats(fn: (run: Tsum, round: RoundOutcome) => void): void;
  /** Makes this add-on the director. One per script: a second one is refused. */
  setDirector(director: GapAddonDirector): void;
}

/** Registered add-on ids, in order. */
const gAddonIds: string[] = [];
/** Each add-on's actions and the function that runs them. */
const gAddonActions: { actions: GapAddonAction[]; run: (name: string, argsJson: string) => string }[] = [];
/** Hooks keep their add-on's id, so a failure log names the add-on. */
const gAddonStateInfo: { id: string; fn: () => Record<string, unknown> }[] = [];
const gAddonTaskLabels: { [task: string]: string } = {};
const gAddonMyTsumCard: { facts: unknown[]; buttons: unknown[] } = { facts: [], buttons: [] };
const gAddonStatsCards: unknown[] = [];
const gAddonRunStart: { id: string; fn: (run: Tsum, controller: TsumTaskController) => void }[] = [];
const gAddonRunEnd: { id: string; fn: () => void }[] = [];
const gAddonRoundStats: { id: string; fn: (run: Tsum, round: RoundOutcome) => void }[] = [];
/** The one director, with its add-on's id; null without one. */
let gAddonDirector: { id: string; director: GapAddonDirector } | null = null;
/** True between `gapAddonsRunStart` and `gapAddonsRunEnd`, so a late add-on can catch up. */
let gAddonRunStarted = false;

/**
 * Registers add-on `id`. `install` runs at once with the host. Refused (logged,
 * false) when `api` is not GAP_ADDON_API, the id is taken, or `install` throws.
 * The host only collects while `install` runs; nothing goes live unless it
 * returns. A failed install also loses the workflow nodes and lists it added.
 */
function gapAddonRegister(id: string, api: number, install: (host: GapAddonHost) => void): boolean {
  if (api !== GAP_ADDON_API) {
    logWarn(Log.Addon.Refused, 'Add-on built for another script version', { addon: id, api: api, want: GAP_ADDON_API });
    return false;
  }
  if (gAddonIds.indexOf(id) >= 0) {
    logWarn(Log.Addon.Refused, 'Add-on already loaded', { addon: id });
    return false;
  }
  // Staged here, copied into the registries only once `install` returns.
  const actions: { actions: GapAddonAction[]; run: (name: string, argsJson: string) => string }[] = [];
  const stateInfo: (() => Record<string, unknown>)[] = [];
  const taskLabels: { [task: string]: string } = {};
  const facts: unknown[] = [];
  const buttons: unknown[] = [];
  const runStart: ((run: Tsum, controller: TsumTaskController) => void)[] = [];
  const runEnd: (() => void)[] = [];
  const statsCards: unknown[] = [];
  const roundStats: ((run: Tsum, round: RoundOutcome) => void)[] = [];
  const directors: GapAddonDirector[] = [];
  const host: GapAddonHost = {
    api: GAP_ADDON_API,
    addActions: function(list, run) { actions.push({ actions: list, run: run }); },
    addStateInfo: function(fn) { stateInfo.push(fn); },
    addTaskLabels: function(labels) { Object.assign(taskLabels, labels); },
    addMyTsumCard: function(part) {
      facts.push(...(part.facts || []));
      buttons.push(...(part.buttons || []));
    },
    addStatsCard: function(card) { statsCards.push(card); },
    onRunStart: function(fn) { runStart.push(fn); },
    onRunEnd: function(fn) { runEnd.push(fn); },
    onRoundStats: function(fn) { roundStats.push(fn); },
    setDirector: function(d) {
      if (directors.length > 0) {
        throw new Error('setDirector called twice');
      }
      directors.push(d);
    },
  };
  // Workflow nodes and lists go straight into the runner: snapshot to undo them.
  const nodeOrder = gapWorkflowNodeOrder.slice();
  const nodes = Object.assign({}, gapWorkflowNodes);
  const listOrder = gapWorkflowListOrder.slice();
  const lists = Object.assign({}, gapWorkflowLists);
  const listInfos = Object.assign({}, gapWorkflowListInfos);
  const undoNodes = function() {
    gapWorkflowNodeOrder = nodeOrder;
    gapWorkflowNodes = nodes;
    gapWorkflowListOrder = listOrder;
    gapWorkflowLists = lists;
    gapWorkflowListInfos = listInfos;
  };
  try {
    install(host);
  } catch (e) {
    undoNodes();
    logError(Log.Addon.Failed, 'Add-on failed to install', { addon: id, errorText: String(e) });
    return false;
  }
  if (directors.length > 0 && gAddonDirector !== null) {
    undoNodes();
    logWarn(Log.Addon.Refused, 'Another add-on already directs', { addon: id, director: gAddonDirector.id });
    return false;
  }
  gAddonIds.push(id);
  if (directors.length > 0) {
    gAddonDirector = { id: id, director: directors[0] };
  }
  gAddonActions.push(...actions);
  stateInfo.forEach(function(fn) { gAddonStateInfo.push({ id: id, fn: fn }); });
  Object.assign(gAddonTaskLabels, taskLabels);
  gAddonMyTsumCard.facts.push(...facts);
  gAddonMyTsumCard.buttons.push(...buttons);
  gAddonStatsCards.push(...statsCards);
  runEnd.forEach(function(fn) { gAddonRunEnd.push({ id: id, fn: fn }); });
  roundStats.forEach(function(fn) { gAddonRoundStats.push({ id: id, fn: fn }); });
  runStart.forEach(function(fn) {
    gAddonRunStart.push({ id: id, fn: fn });
    // Add-ons can arrive after Start; catch up with the run in progress.
    if (gAddonRunStarted && ts !== undefined && gTaskController !== undefined) {
      gapAddonCall(id, 'onRunStart', function() { fn(ts!, gTaskController!); });
    }
  });
  logDebug(Log.Addon.Registered, { addon: id });
  return true;
}

/** Runs one add-on hook; a throw is logged, never passed on to the base. */
function gapAddonCall(id: string, hook: string, body: () => void): void {
  try {
    body();
  } catch (e) {
    logError(Log.Addon.Failed, 'Add-on hook failed', { addon: id, hook: hook, errorText: String(e) });
  }
}

/** The add-ons' phone actions, after the base's. */
function gapAddonActionList(): GapAddonAction[] {
  const out: GapAddonAction[] = [];
  for (let i = 0; i < gAddonActions.length; i++) {
    out.push(...gAddonActions[i].actions);
  }
  return out;
}

/** Runs add-on action `name`; null when no add-on has it. */
function gapAddonAction(name: string, argsJson: string): string | null {
  for (let i = 0; i < gAddonActions.length; i++) {
    const set = gAddonActions[i];
    if (set.actions.some((a) => a.name === name)) {
      try {
        return set.run(name, argsJson);
      } catch (e) {
        logError(Log.Addon.Failed, 'Add-on action failed', { action: name, errorText: String(e) });
        return JSON.stringify({ ok: false, why: 'action-failed' });
      }
    }
  }
  return null;
}

/** The add-ons' `info` fields for `gapRemoteState`. */
function gapAddonStateInfo(): Record<string, unknown> {
  const info: Record<string, unknown> = {};
  for (let i = 0; i < gAddonStateInfo.length; i++) {
    const entry = gAddonStateInfo[i];
    gapAddonCall(entry.id, 'stateInfo', function() { Object.assign(info, entry.fn()); });
  }
  return info;
}

/** Called by `buildRun` once the run's jobs are registered. */
function gapAddonsRunStart(run: Tsum, controller: TsumTaskController): void {
  gAddonRunStarted = true;
  for (let i = 0; i < gAddonRunStart.length; i++) {
    const entry = gAddonRunStart[i];
    gapAddonCall(entry.id, 'onRunStart', function() { entry.fn(run, controller); });
  }
}

/** Called by `endRun`. */
function gapAddonsRunEnd(): void {
  gAddonRunStarted = false;
  for (let i = 0; i < gAddonRunEnd.length; i++) {
    gapAddonCall(gAddonRunEnd[i].id, 'onRunEnd', gAddonRunEnd[i].fn);
  }
}

/** Called by `finishRoundStats` after the row is written, on the score page. */
function gapAddonsRoundStats(run: Tsum, round: RoundOutcome): void {
  for (let i = 0; i < gAddonRoundStats.length; i++) {
    const entry = gAddonRoundStats[i];
    gapAddonCall(entry.id, 'onRoundStats', function() { entry.fn(run, round); });
  }
}
