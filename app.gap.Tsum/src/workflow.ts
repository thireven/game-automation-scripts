// GAP Companion workflows, Tsum's half: the node catalog, the option lists, the
// node implementations and the run mode that drives them.
//
// The generic part -- checking, the cursor, per-loop values, `loop` / `stop`,
// state and events -- is the runner library, src/gapWorkflow.ts. This file
// registers into it at load and runs it from one scheduled job. The contract is
// the app repo's docs/WORKFLOWS.md; how each node is played is WORKFLOWS.md
// beside this package.
//
// How a workflow run is put together:
//   startWorkflow(settings, ref)  arms `gWorkflowArmed` and calls start()
//   buildRun                      takes the ref (clearing it in the same call, so
//                                 a refused start leaves nothing armed), forces
//                                 Auto launch on and Stop after games off, and
//                                 registers `workflowTaskTable()` instead of the
//                                 chore table -- the workflow's order replaces
//                                 the coded one; the Now / Stop-after-this-round
//                                 one-shots still run
//   workflowBegin                 the library's check and snapshot; a refusal
//                                 (e.g. `tsum-list-missing`) ends the run
//   workflowPass                  the job: one `gapWorkflowStep()` per pass
//
// The ref is never put in `Settings`, so `saveLastRunSettings` cannot replay it.

/** The ref `startWorkflow` armed for the `buildRun` it causes. Cleared there. */
let gWorkflowArmed: string | null = null;

/** True while the run in progress is a workflow run. */
let gWorkflowRun = false;

/** Set by `start()` when the run ended by a throw, so the workflow reports `error`. */
let gRunErrored = false;

/** Play rounds: which visit of the node is being counted, and the count it began at. */
let gWorkflowRoundsFrom: { key: string; rounds: number } = { key: '', rounds: 0 };

/**
 * Like `start(settings)`, in workflow mode. Returns when the run ends. A global
 * for GAP Companion's adapter, which has already run `gapWorkflowCheck`.
 */
// noinspection JSUnusedGlobalSymbols
function startWorkflow(settings: Settings, refJson: string): void {
  gWorkflowArmed = String(refJson);
  try {
    start(settings);
  } finally {
    // Normally `buildRun` took it already; a refused (busy) start did not.
    gWorkflowArmed = null;
  }
}

/** `buildRun`'s read of the armed ref: returns it and clears it. */
function workflowTakeArmed(): string | null {
  const ref = gWorkflowArmed;
  gWorkflowArmed = null;
  return ref;
}

/**
 * Starts the workflow on a run `buildRun` just built. False when it was
 * refused: the library has already ended it (`workflow.end`), and the run is
 * asked to stop before any node runs.
 */
function workflowBegin(refJson: string): boolean {
  gWorkflowRoundsFrom = { key: '', rounds: 0 };
  const refused = gapWorkflowBegin(refJson);
  if (refused === null) {
    return true;
  }
  requestStop();
  return false;
}

/**
 * The Workflow job's body: one library step per pass. `true` asks the
 * scheduler for the next pass at once; a `wait` rests the job's interval.
 */
function workflowPass(): boolean {
  const answer = gapWorkflowStep();
  if (answer === 'finished') {
    requestStop();
    return false;
  }
  return answer === 'continue';
}

/** `endRun`'s part: a workflow still running was stopped from outside, or crashed. */
function workflowRunEnded(): void {
  if (gWorkflowRun) {
    gapWorkflowAbort(gRunErrored ? 'error' : 'stopped');
  }
  gWorkflowRun = false;
}

/**
 * The Quick Bar's progress line, or null outside a workflow run. `step` is the
 * short form the strip's readout fits (`L2 3/5`), `line` the whole sentence.
 */
function workflowProgress(): { step: string; line: string } | null {
  if (!gWorkflowRun) {
    return null;
  }
  const state = JSON.parse(gapWorkflowState()) as GapWorkflowState | null;
  if (state === null) {
    return null;
  }
  const at = Math.min(state.index + 1, state.total);
  let line = 'Loop ' + state.loop + ', step ' + at + '/' + state.total;
  if (state.node !== null) {
    line += ': ' + workflowNodeLabel(state.node);
  }
  if (state.detail !== null) {
    line += ' (' + state.detail + ')';
  }
  if (state.status !== 'running') {
    line += ' -- ' + state.status + (state.reason ? ' (' + state.reason + ')' : '');
  }
  return { step: 'L' + state.loop + ' ' + at + '/' + state.total, line: line };
}

// --- The node wrapper -----------------------------------------------------------

/**
 * A chore as a node. In this order, one step per call, so Stop after this
 * round and the Now one-shots keep working:
 *   1. the run is stopping: `wait`
 *   2. a round is on: finish it (`taskPlayGameQuick`) and come back -- the
 *      chore and any queued Now sweep only stand aside for it, and nothing
 *      else plays it here. Before step 3 so a sweep cannot deadlock on it.
 *   3. a Now sweep wants the screen: `wait`
 *   4. the chore itself
 *   5. it handed back for a Now sweep: `again`; otherwise `done`
 */
function workflowChore(body: (run: Tsum, ctx: GapWorkflowCtx) => GapWorkflowResult | void):
    (ctx: GapWorkflowCtx) => GapWorkflowResult {
  return function(ctx: GapWorkflowCtx): GapWorkflowResult {
    const run = ts;
    if (run === undefined) {
      return { fail: 'no-run' };
    }
    if (!run.isRunning) {
      return 'wait';
    }
    if (quickBarInRound(run) || roundInProgress()) {
      ctx.setDetail('finishing the round');
      run.taskPlayGameQuick();
      return 'again';
    }
    if (!run.mayContinue()) {
      return 'wait';
    }
    const result = body(run, ctx);
    if (result !== undefined) {
      return result;
    }
    return run.yieldAsked ? 'again' : 'done';
  };
}

/** The node's bool param, or `fallback` when the node left it to the run. */
function workflowBool(ctx: GapWorkflowCtx, key: string, fallback: boolean): boolean {
  const value = ctx.params[key];
  return typeof value === 'boolean' ? value : fallback;
}

// --- The nodes ------------------------------------------------------------------

/**
 * Preset keys the Skill node does not apply: they belong to the run, not the
 * round, and in a workflow the workflow owns them (Stop after games), or they
 * would add a chore's job beside it.
 */
const WorkflowPresetSkip: string[] = [
  SettingKey.StopAfterGames, SettingKey.StopAfterAction,
  SettingKey.SendHeartsAuto, SettingKey.ReceiveHeartsOneByOne,
];

/**
 * The only preset keys the Skill node applies: how a round is played. Mirrors
 * gapSettingsSchema's `presetFields` (settings.ts's SHARE_SLOTS minus clickAssist,
 * which is a chore). A hand-made preset cannot push run-level keys this way.
 */
const WorkflowPresetKeys: string[] = [
  SettingKey.UseFan, SettingKey.MaxChainsPerScan, SettingKey.MaxChain,
  SettingKey.PrioritizeMyTsum, SettingKey.BonusScore, SettingKey.BonusCoin,
  SettingKey.BonusExp, SettingKey.BonusTime, SettingKey.BonusBubble,
  SettingKey.Bonus5to4, SettingKey.BonusCombo, SettingKey.SkillWaitingTime,
  SettingKey.SkillLevel, SettingKey.SkillType, SettingKey.NoSkillLastFeverSec,
  SettingKey.SkillAutoTap, SettingKey.LinkReachPercent, SettingKey.LorcanaCard,
  SettingKey.BubbleStrategy, SettingKey.HoldBubblesLastFeverSec,
  SettingKey.SkillSettleMs, SettingKey.SkillReactivationTenths,
];

/** Tsum's nodes, in catalog order (docs/WORKFLOWS.md § 5). */
const WorkflowTsumNodes: GapWorkflowNodeDef[] = [
  {
    type: 'restartApp', label: 'Restart app', params: [],
    // Not `taskTsumAppRestart`: that one needs Auto launch and ignores a live
    // round. Force-stop, launch the build this device plays, wait for it, then
    // walk the startup screens to the friend list so the next node starts there.
    run: workflowChore(function(run) {
      const build = run.gameBuild();
      run.invalidateAppOn();
      stopApp(GamePackages[build]);
      run.awaitAppOff();
      run.invalidateAppOn();
      run.isStartupPhase = true;
      run.beginBoot();
      startTsumTsumApp(build);
      if (!run.awaitAppUp()) {
        return { fail: 'app-not-up' };
      }
      // False only when the run is stopping; the chore wrapper handles that.
      gPages.navigate(PageName.FriendPage);
      return 'done';
    }),
  },
  {
    type: 'tsum.receiveHearts', label: 'Receive hearts', group: 'Hearts',
    params: [
      { key: 'mode', label: 'Mode', type: 'enum',
        options: [{ value: 'claimAll', label: 'Claim all' }, { value: 'oneByOne', label: 'One by one' }] },
      { key: 'skipRuby', label: 'Skip ruby', type: 'bool', optional: true },
      { key: 'skipMedals', label: 'Skip medals', type: 'bool', optional: true },
    ],
    // The chore once, with the node's params over the run's for that call only.
    run: workflowChore(function(run, ctx) {
      const keepRuby = run.keepRuby;
      const skipMedals = run.skipMedals;
      run.keepRuby = workflowBool(ctx, 'skipRuby', keepRuby);
      run.skipMedals = workflowBool(ctx, 'skipMedals', skipMedals);
      try {
        if (ctx.params.mode === 'oneByOne') {
          run.taskReceiveOneItem();
        } else {
          run.taskReceiveAllItems();
        }
      } finally {
        run.keepRuby = keepRuby;
        run.skipMedals = skipMedals;
      }
    }),
  },
  {
    type: 'tsum.sendHearts', label: 'Send hearts', group: 'Hearts',
    params: [
      { key: 'toZeroScore', label: 'Send to 0 score', type: 'bool', optional: true },
      { key: 'maxRuntime', label: 'Max run time', type: 'int', min: 0, max: 80, step: 5,
        unit: 'min', optional: true },
    ],
    run: workflowChore(function(run, ctx) {
      const toZero = run.sentToZero;
      const maxMs = run.sendHeartMaxDuring;
      run.sentToZero = workflowBool(ctx, 'toZeroScore', toZero);
      if (typeof ctx.params.maxRuntime === 'number') {
        run.sendHeartMaxDuring = ctx.params.maxRuntime * 60 * 1000;
      }
      try {
        run.taskSendHearts();
      } finally {
        run.sentToZero = toZero;
        run.sendHeartMaxDuring = maxMs;
      }
    }),
  },
  {
    type: 'tsum.skill', label: 'Skill', group: 'Tsum',
    help: 'A preset or a skill, from the next round',
    params: [{ key: 'use', label: 'Use', type: 'enum', lists: ['presets', 'skills'], perLoop: true }],
    // Not a chore: live settings, so a round in progress keeps its own and the
    // held keys land at the next whistle (`LiveSettings`, src/quickbar.ts).
    run: function(ctx) {
      const use = String(ctx.params.use);
      const values: { [key: string]: GapWorkflowScalar } = {};
      if (use.indexOf('preset:') === 0) {
        const preset = gapWorkflowPreset(use.substring(7));
        if (preset === null) {
          return { fail: 'no-preset' };
        }
        for (const key in preset.values) {
          if (WorkflowPresetKeys.indexOf(key) >= 0 && WorkflowPresetSkip.indexOf(key) < 0) {
            values[key] = preset.values[key];
          }
        }
        ctx.setDetail(preset.name);
      } else if (use.indexOf('skill:') === 0) {
        values[SettingKey.SkillType] = use.substring(6);
        ctx.setDetail(WorkflowSkillLabels[use.substring(6)] || use.substring(6));
      } else {
        return { fail: 'bad-value' };
      }
      const answer = applyLiveSettings(values as unknown as Partial<Settings>);
      return answer === 'no run' ? { fail: 'no-run' } : 'done';
    },
  },
  {
    type: 'tsum.playRounds', label: 'Play rounds', group: 'Play',
    help: 'Plays N rounds, then goes to the next step',
    params: [{ key: 'rounds', label: 'Rounds', type: 'int', min: 1, max: 999, step: 1,
      default: 10, perLoop: true }],
    // Rounds are counted off `runClock.rounds` (finished rounds the play task
    // timed), not off what `taskPlayGameQuick` returns.
    run: function(ctx) {
      const run = ts;
      if (run === undefined) {
        return { fail: 'no-run' };
      }
      const key = ctx.loop + ':' + ctx.index;
      if (gWorkflowRoundsFrom.key !== key) {
        gWorkflowRoundsFrom = { key: key, rounds: run.runClock.rounds };
      }
      const target = typeof ctx.params.rounds === 'number' ? ctx.params.rounds : 1;
      const played = run.runClock.rounds - gWorkflowRoundsFrom.rounds;
      ctx.setDetail(played + '/' + target + ' rounds');
      if (played >= target) {
        return 'done';
      }
      // A round already on the board is played even with a Now sweep queued.
      const inRound = quickBarInRound(run) || roundInProgress();
      // The between-rounds delay, or a Now sweep waiting for the screen.
      if (!inRound && (run.roundDelayRemainingMs() > 0 || !run.mayContinue())) {
        return 'wait';
      }
      // taskPlayGameQuick plays the whole round, so this is what shows meanwhile.
      ctx.setDetail('playing round ' + (played + 1) + ' of ' + target);
      run.taskPlayGameQuick();
      return 'again';
    },
  },
];

/** A node type's label, for banners and the progress line: any script node (an add-on's too) or standard one. */
function workflowNodeLabel(type: string): string {
  const def = gapWorkflowDef(type);
  return def !== undefined ? def.label : type;
}

// --- Lists and the check --------------------------------------------------------

/** `tsums`: this device's Tsum List, by its build's full names, favorites flagged; null without the file. */
function workflowTsumsList(): GapWorkflowListItem[] | null {
  const file = tsumListLoadFile();
  if (file === null) {
    return null;
  }
  const items: GapWorkflowListItem[] = [];
  const seen: { [tsum: string]: boolean } = {};
  for (let i = 0; i < file.tsums.length; i++) {
    const row = file.tsums[i];
    if (row.tsum === '' || seen[row.tsum]) {
      continue;
    }
    seen[row.tsum] = true;
    const item: GapWorkflowListItem = { value: row.tsum, label: row.name !== '' ? row.name : row.tsum };
    if (row.favorite) {
      item.favorite = true;
    }
    items.push(item);
  }
  return items;
}

/**
 * Readable skill names for the `skills` list (contract § 2). Mirrors the
 * settings page's skill labels; the bundle has no display names of its own (those
 * live in the pages' UiText). A skill missing here shows under its id.
 */
const WorkflowSkillLabels: { [id: string]: string } = {
  nokill: 'No skill', burst: 'Burst', burst_bubbles: 'Burst (bubbles)',
  donald: 'Donald', donaldx: 'Holiday Donald', lukej: 'Jedi Luke', moana: 'Moana',
  marie: 'Marie', missbunny: 'Miss Bunny', rabbit: 'Rabbit',
  mickeyh2015: 'Horn Hat Mickey', snowwhite: 'Snow White', cinderella: 'Cinderella',
  woody2: 'Sheriff Woody', cabbage_mickey: 'Cabbage Mickey', buzzl: 'Cpt. Lightyear',
  buzzl_120: 'Cpt. Lightyear (120fps)', mcqueenplus: 'Lightning McQueen+',
  beastda: 'Formal Beast', minnie12thplus: 'Tiara Minnie+',
  elsa_coronation: 'Coronation Elsa', rapunzelplus: 'Rapunzel+', gaston: 'Gaston',
  auroraink: 'Lorcana Aurora', nbc_set: 'Nightmare Before Christmas (Set)',
  pair_tsum: 'Pair Tsum',
};

/** `skills`: every skill this build can play, plus No skill. */
function workflowSkillsList(): GapWorkflowListItem[] {
  const label = function(id: string): string {
    return WorkflowSkillLabels[id] || id;
  };
  const items: GapWorkflowListItem[] = [
    { value: 'skill:' + SkillType.NoSkill, label: label(SkillType.NoSkill) },
  ];
  for (const id in SkillHandlers) {
    if (SkillHandlers[id] !== undefined) {
      items.push({ value: 'skill:' + id, label: label(id) });
    }
  }
  return items;
}

/**
 * The check hook: a node with a param on the `tsums` list needs this device's
 * Tsum List, and every tsum it names (each per-loop value too) has to be in it.
 */
function workflowTsumCheck(workflow: GapWorkflow): string | null {
  let file: TsumListFile | null | undefined;
  for (let i = 0; i < workflow.nodes.length; i++) {
    const node = workflow.nodes[i];
    const def = gapWorkflowDef(node.type);
    const params = def === undefined ? [] : def.params;
    for (let p = 0; p < params.length; p++) {
      if (params[p].lists === undefined || params[p].lists!.indexOf('tsums') < 0) {
        continue;
      }
      if (file === undefined) {
        file = tsumListLoadFile();
      }
      if (file === null) {
        return 'tsum-list-missing';
      }
      const value = node.params[params[p].key];
      if (value === undefined || value === null) {
        continue;
      }
      const wanted = gapWorkflowValuesOf(value);
      for (let w = 0; w < wanted.length; w++) {
        let found = false;
        for (let r = 0; r < file.tsums.length && !found; r++) {
          found = file.tsums[r].tsum !== '' && file.tsums[r].tsum === wanted[w];
        }
        if (!found) {
          return 'tsum-not-in-list:' + wanted[w];
        }
      }
    }
  }
  return null;
}

/** The log line and banner for each workflow event. */
function workflowSay(event: string, data: { [key: string]: unknown }): void {
  const run = ts;
  const banner = function(text: string, ms: number) {
    if (run !== undefined) {
      run.banner(text, ms);
    }
  };
  const label = typeof data.node === 'string' ? workflowNodeLabel(data.node) : '';
  switch (event) {
    case Emit.Workflow.Start: {
      const resumed = data.resumed as GapWorkflowAt | undefined;
      if (resumed !== undefined) {
        logInfo(Log.Workflow.Start, 'Workflow resumed after the restart', data);
        banner('Workflow resumed: ' + data.name + ', step ' + (resumed.index + 1), 5000);
      } else {
        logInfo(Log.Workflow.Start, 'Workflow started', data);
        banner('Workflow: ' + data.name, 4000);
      }
      break;
    }
    case Emit.Workflow.Node: {
      const state = JSON.parse(gapWorkflowState()) as GapWorkflowState | null;
      const total = state === null ? 0 : state.total;
      logInfo(Log.Workflow.Node, 'Workflow step', Object.assign({ label: label }, data));
      banner('Step ' + ((data.index as number) + 1) + '/' + total + ': ' + label, 4000);
      break;
    }
    case Emit.Workflow.Loop:
      logInfo(Log.Workflow.Loop, 'Workflow loop', data);
      banner('Workflow loop ' + data.loop, 3000);
      break;
    case Emit.Workflow.NodeFailed:
      logWarn(Log.Workflow.NodeFailed, 'Workflow step failed; skipped', data);
      banner('Skipped ' + label + ': ' + data.error, 5000);
      break;
    case Emit.Workflow.Restart:
      if (data.outcome === 'restarting') {
        logInfo(Log.Workflow.Restart, 'Restarting the device; the workflow carries on afterwards', data);
        banner('Restarting the device', 5000);
      } else if (data.outcome === 'not-slow') {
        // `why` says when nothing could be measured, so "fine" is not claimed.
        logInfo(Log.Workflow.Restart, 'Not slow; no restart', data);
        banner(data.why === 'not-enough-data' ? 'Not enough speed data yet; no restart'
          : data.why === 'no-baseline' ? 'No speed baseline yet; no restart'
          : 'Speed is fine; no restart', 3000);
      } else {
        logWarn(Log.Workflow.Restart, 'Restart skipped', data);
        banner('Restart skipped: ' + data.error, 5000);
      }
      break;
    case Emit.Workflow.End:
      if (data.status === 'ended' && data.reason === 'restart') {
        logInfo(Log.Workflow.End, 'Workflow paused for the device restart', data);
      } else if (data.status === 'ended') {
        logInfo(Log.Workflow.End, 'Workflow ended', data);
        banner(data.reason === 'stopped' ? 'Workflow stopped' : 'Workflow finished', 5000);
      } else {
        logWarn(Log.Workflow.End, 'Workflow ended early', data);
        banner(data.reason === 'tsum-list-missing' ? 'Run Export Tsum List first'
          : data.reason === 'tsum-list-stale' ? 'Run Export Tsum List again'
          : 'Workflow stopped: ' + data.reason, 6000);
      }
      break;
  }
}

for (let i = 0; i < WorkflowTsumNodes.length; i++) {
  gapWorkflowDefineNode(WorkflowTsumNodes[i]);
}
gapWorkflowDefineList('tsums', workflowTsumsList,
  { label: 'Tsum List', missing: 'Run Export Tsum List on the device' });
gapWorkflowDefineList('skills', workflowSkillsList);
gapWorkflowSetHooks({
  emit: function(event: string, data: { [key: string]: unknown }) {
    emitScriptEvent(event, data);
    workflowSay(event, data);
  },
  check: workflowTsumCheck,
});

// --- Presets mirror (for GAP Companion's Import from device) --------------------

/** `<script folder>/presets-<device id>.json`, or '' without the natives. */
function presetsMirrorPath(): string {
  if (typeof getScriptPath !== 'function' || typeof getDeviceId !== 'function') {
    return '';
  }
  return getScriptPath() + '/presets-' + getDeviceId() + '.json';
}

/** `[{name, values}]` with scalar values only; null when `raw` is not a list. */
function presetsMirrorParse(raw: unknown): { name: string; values: { [key: string]: GapWorkflowScalar } }[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const out: { name: string; values: { [key: string]: GapWorkflowScalar } }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (p === null || typeof p !== 'object' || typeof p.name !== 'string'
        || p.values === null || typeof p.values !== 'object') {
      continue;
    }
    const values: { [key: string]: GapWorkflowScalar } = {};
    for (const key in p.values) {
      if (gapWorkflowIsScalar(p.values[key])) {
        values[key] = p.values[key];
      }
    }
    out.push({ name: p.name, values: values });
  }
  return out;
}

/**
 * The settings and Quick Bar pages call this on every presets save with the
 * store's `[{name, values}]`, so the engine can export them. Never throws.
 */
// noinspection JSUnusedGlobalSymbols
function presetsMirror(json: string): void {
  try {
    const path = presetsMirrorPath();
    const list = presetsMirrorParse(JSON.parse(json));
    if (path !== '' && list !== null) {
      writeFile(path, JSON.stringify(list));
    }
  } catch (e) {
    logWarn(Log.Workflow.PresetsNotSaved, 'Could not save the presets for GAP Companion',
      { errorText: '' + e });
  }
}

/** The mirrored presets as JSON `[{name, values}]`; `"[]"` when missing or unreadable. */
// noinspection JSUnusedGlobalSymbols
function gapPresetsLocal(): string {
  try {
    const path = presetsMirrorPath();
    const text = path === '' ? '' : readFile(path);
    const list = text === '' ? null : presetsMirrorParse(JSON.parse(text));
    return JSON.stringify(list === null ? [] : list);
  } catch (e) {
    return '[]';
  }
}
