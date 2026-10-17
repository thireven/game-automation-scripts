// --- GAP Companion's standard globals -----------------------------------------
//
// The companion's one generic adapter reads these by name: what the phone shows
// for a run, the actions it can send, and how a remote start runs. Settings
// come from `gapSettingsSchema` (src/index.ts), screens from `gapScreens`
// (src/companionScreens.ts). Contract: "What a script implements" in the
// companion repo's cloud/adapters/README.md. JSON crosses as strings both ways.
//
// Rule from the contract: nothing here may tap, sleep or wait (except
// `gapRemoteStartRun`). The engine calls these outside the pause gate.

/** Readouts the phone shows for a run; keys match `gapRemoteState().readouts`. */
const CompanionReadouts = [
  { key: 'rounds', label: 'Rounds', unit: 'count' },
  { key: 'runSec', label: 'Run time', unit: 'sec' },
  { key: 'playedSec', label: 'Time in rounds', unit: 'sec' },
  { key: 'avgRoundSec', label: 'Avg round', unit: 'sec' },
  { key: 'baseCoinAvg', label: 'Avg coins (base)', unit: 'coins' },
  { key: 'finalCoinAvg', label: 'Avg coins (final)', unit: 'coins' },
  { key: 'medals', label: 'Medals', unit: 'medals' },
  { key: 'restRemainingSec', label: 'Rest left', unit: 'sec' },
];

/** Totals the server keeps from `round.end` until reset on the phone (fields: EVENTS.md). */
const CompanionStats = [
  { key: 'rounds', label: 'Rounds', unit: 'count', event: 'round.end', op: 'count' },
  { key: 'coins', label: 'Coins earned', unit: 'coins', event: 'round.end', field: 'finalCoins', op: 'sum' },
  { key: 'avgCoins', label: 'Avg coins', unit: 'coins', event: 'round.end', field: 'finalCoins', op: 'avg' },
  { key: 'bestCoins', label: 'Best round', unit: 'coins', event: 'round.end', field: 'finalCoins', op: 'max' },
  { key: 'medals', label: 'Medals', unit: 'medals', event: 'round.end', field: 'medals', op: 'sum' },
  { key: 'played', label: 'Time in rounds', unit: 'sec', event: 'round.end', field: 'seconds', op: 'sum' },
  { key: 'avgRound', label: 'Avg round', unit: 'sec', event: 'round.end', field: 'seconds', op: 'avg' },
];

/** Actions the phone can send. `role` names are standard, so the phone needs no Tsum code. */
const CompanionRemoteActions = [
  { name: 'wrapUp', label: 'Stop after this round', role: 'stopAfter' },
  { name: 'cancelWrapUp', label: 'Keep playing', role: 'cancelStopAfter' },
  { name: 'lastSettings', label: 'Last run settings' },
];

// --- Notifications (cloud/adapters/README.md § Notifications) -----------------

/** A push to the phone. `category` picks the phone's switch; the same `tag` replaces an earlier one. */
interface GapNote {
  title: string;
  body?: string;
  category?: 'run' | 'task' | 'alert' | 'info';
  tag?: string;
  /** Up to 5 short lines, shown expanded. */
  lines?: string[];
  progress?: { value: number; max: number } | { indeterminate: true };
  /** Buttons that run a `CompanionRemoteActions` action. Never one that spends coins: no confirm there. */
  actions?: { label: string; action: string; args?: { [key: string]: string | number | boolean } }[];
  silent?: boolean;
}

/** Sends `note` to the phones linked to this device. Nothing happens without GAP Companion. */
function gapNotify(note: GapNote): void {
  emitScriptEvent(Emit.Companion.Notify, note);
}

/** 1234567 -> "1,234,567" (toLocaleString is not reliable on every host). */
function companionCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * "Stop after this round" landed (`wrapUpIfAsked`, src/play.ts): the standard
 * `stopAfter` note, tagged `run` so it replaces a workflow's end on the phone.
 */
function notifyWrapUp(run: Tsum, atRoundEnd: boolean): void {
  const lines: string[] = [];
  if (run.myTsumName) {
    lines.push(run.myTsumName);
  }
  const r = run.lastRound;
  if (atRoundEnd && r !== null) {
    if (r.score !== null) {
      lines.push('Score ' + companionCount(r.score));
    }
    if (r.finalCoins !== null) {
      lines.push('Coins ' + companionCount(r.finalCoins));
    }
  }
  const rounds = run.runClock.rounds;
  lines.push(rounds + (rounds === 1 ? ' round' : ' rounds') + ' this run');
  gapNotify({
    title: atRoundEnd ? 'Stopped after the round' : 'Stopped before the next round',
    category: 'run',
    tag: 'run',
    lines: lines,
  });
}

/** Chore endings that mean it did all it could; any other reason is said. */
const ChoreDoneReasons = ['end of list', 'no more capped', 'purchase limit', 'sold out'];

/**
 * A chore started with Now finished (the Now queues in src/index.ts). `outcome`
 * is the sweep's `Log.*.End` fields (`Tsum.lastChore`); null when the run
 * stopped under it, which needs no notification.
 */
function notifyChoreDone(chore: 'unlock' | 'boxes' | 'tsumList', outcome: LogFields | null): void {
  if (outcome === null) {
    return;
  }
  const count = (key: string) => (typeof outcome[key] === 'number' ? outcome[key] : 0);
  let title: string;
  let body: string;
  if (chore === 'unlock') {
    title = 'Level caps raised';
    body = count('raised') + (count('raised') === 1 ? ' Tsum raised.' : ' Tsums raised.');
  } else if (chore === 'boxes') {
    title = 'Boxes bought';
    body = count('bought') + (count('bought') === 1 ? ' box bought.' : ' boxes bought.');
  } else {
    title = 'Tsum list exported';
    body = count('tsums') + ' Tsums saved.';
  }
  const reason = typeof outcome.reason === 'string' ? outcome.reason : '';
  if (reason !== '' && ChoreDoneReasons.indexOf(reason) < 0) {
    body += ' Stopped: ' + reason + '.';
  }
  gapNotify({ title: title, body: body, category: 'task', tag: 'chore.' + chore });
}

/** `remoteSettingsApply`'s refusal reasons as the contract's short codes. */
const CompanionSetWhy: { [why: string]: string } = {
  'no run': 'no-run',
  'invalid value': 'bad-value',
  'unknown setting': 'unknown-key',
  workflow: 'workflow-run',
};

/** quickBarState uses -1 for "no round yet"; the phone gets null instead. */
function companionNum(v: unknown): number | null {
  return typeof v === 'number' && v >= 0 ? v : null;
}

/** What the phone shows for this script: readouts, stats rules and actions. */
// noinspection JSUnusedGlobalSymbols
function gapCompanion(): string {
  return JSON.stringify({ readouts: CompanionReadouts, stats: CompanionStats, actions: CompanionRemoteActions });
}

/** The run as the phone sees it: `{active, values, readouts, flags, info}`. */
// noinspection JSUnusedGlobalSymbols
function gapRemoteState(): string {
  const s = JSON.parse(quickBarState());
  const active = s.active === true;
  return JSON.stringify({
    active: active,
    values: remoteSettingsValues(),
    readouts: {
      rounds: companionNum(s.rounds),
      runSec: companionNum(s.runSec),
      playedSec: companionNum(s.playedSec),
      avgRoundSec: companionNum(s.avgRoundSec),
      baseCoinAvg: companionNum(s.baseCoinAvg),
      finalCoinAvg: companionNum(s.finalCoinAvg),
      // 0 rather than a dash while a run has earned none.
      medals: active ? (companionNum(s.medals) ?? 0) : null,
      restRemainingSec: typeof s.roundDelayRemainingMs === 'number'
        ? Math.ceil(s.roundDelayRemainingMs / 1000) : null,
    },
    flags: {
      inRound: s.inRound === true,
      wrapUpArmed: s.stopAfterThisRound === true,
      stopPending: s.stopAfterThisRound === true,
    },
    // Full names; myTsum is null until the pre-round screen identified it.
    info: {
      myTsum: typeof s.myTsum === 'string' && s.myTsum !== '' ? s.myTsum : null,
    },
  });
}

/**
 * Changes one setting (the adapter already checked key and value). Answers
 * `{ok: true, value, applies}` or `{ok: false, why}` with a contract code.
 */
// noinspection JSUnusedGlobalSymbols
function gapRemoteSet(key: string, value: string | number | boolean): string {
  let res: { ok?: boolean; why?: string; value?: unknown; applies?: string } | null;
  try {
    res = JSON.parse(remoteSettingsApply(key, value));
  } catch (e) {
    res = null;
  }
  if (res === null || res.ok !== true) {
    const why = res !== null && res.why !== undefined && CompanionSetWhy.hasOwnProperty(res.why)
      ? CompanionSetWhy[res.why] : 'apply-failed';
    return JSON.stringify({ ok: false, why: why });
  }
  return JSON.stringify({ ok: true, value: res.value, applies: res.applies });
}

/** Runs one `gapCompanion` action with its args, already checked by the adapter. */
// noinspection JSUnusedGlobalSymbols
function gapRemoteAction(name: string, argsJson: string): string {
  if (name === 'wrapUp' || name === 'cancelWrapUp') {
    const armed = name === 'wrapUp';
    const status = armed ? stopAfterThisRound() : cancelStopAfterThisRound();
    return JSON.stringify(status === 'no run' ? { ok: false, why: 'no-run' }
      : { ok: true, status: status, armed: armed });
  }
  if (name === 'lastSettings') {
    return JSON.stringify({ ok: true, settings: lastRunSettings() });
  }
  return JSON.stringify({ ok: false, why: 'unknown-action' });
}

/**
 * What a remote start runs with: the defaults with the last run's settings on
 * top, so a device that never ran the script starts too. `optsJson` is `{}` or
 * `{workflow: {id, rev}}`, already checked by the adapter.
 */
// noinspection JSUnusedGlobalSymbols
function gapRemoteStartPrepare(optsJson: string): string {
  let opts: { workflow?: unknown } = {};
  try {
    opts = JSON.parse(optsJson) || {};
  } catch (e) {
    // No opts: a plain start.
  }
  const settings = remoteStartSettings();
  if (settings === null || typeof settings !== 'object') {
    return JSON.stringify({ ok: false, why: 'state-unreadable' });
  }
  // A chore Now pressed while stopped (`gapSettingsAction`): a run for that chore alone.
  const chore = opts.workflow ? null : choreNowTakeArmed();
  if (chore !== null) {
    (settings as unknown as { [key: string]: unknown })[chore] = true;
  }
  return JSON.stringify({ settings: settings, workflow: opts.workflow || null, choreOnly: chore !== null });
}

/** Starts the run `gapRemoteStartPrepare` answered. Returns when the run ends. */
// noinspection JSUnusedGlobalSymbols
function gapRemoteStartRun(preparedJson: string): void {
  const p = JSON.parse(preparedJson) as { settings: Settings; workflow: unknown; choreOnly?: boolean };
  if (p.workflow) {
    startWorkflow(p.settings, JSON.stringify(p.workflow));
  } else {
    gChoreOnlyRun = p.choreOnly === true;
    try {
      start(p.settings);
    } finally {
      // `buildRun` takes it; cleared here too for a start that never got that far.
      gChoreOnlyRun = false;
    }
  }
}
