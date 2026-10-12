// The run lifecycle.
//
// `start()` does not return: `gTaskController.start()` runs the task loop and
// only comes back once something has cleared its flag. Every `stop()` therefore
// runs on a *second* thread while `start()` is still on the stack -- the host
// dispatches each eval on its own pool thread, and the engine hands the
// interpreter lock over at every `sleep()` -- and the two have to agree on who
// owns `ts`, the task set and the router.
//
// They did not, and opening the settings page mid-run is what it cost: that
// page's `OnSettingClick` used to evaluate `stop();` -- it no longer does, the
// host pauses instead and Play with the panel open is what sends the `start()`
// that replaces the run -- which cleared `ts` and detached `gPages` while the
// loop was still inside a task. The task's next detect threw
// "PageRouter is not attached", and when the loop finally handed back, `start()`
// finished on `log(ts.logs.TaskControllerStop)` (now `logInfo(Log.Task.LoopStopped)`) with
// `TypeError: cannot read property 'logs' of undefined`. Pressing Play then
// built a second world on top of the first, which is why the script had to be
// reloaded before a changed setting would take.
//
// The rule now: **a run dismantles its own world.** `stop()` only asks it to
// end, and waits until it says it has.

/**
 * This script's fixed id, whatever folder it is installed in. GAP reads it
 * after loading to pick this script's GAP Companion adapter.
 */
const GAP_SCRIPT_ID = 'app.gap.Tsum';

/** True from the moment `start()` owns a world until `endRun()` has cleared it. */
let gRunActive = false;

/**
 * Is this run the walkthrough recorder?
 *
 * A mode rather than a task, and the only one where nothing may touch the screen
 * -- so it is also the one run that has to refuse work the settings page asks for
 * on demand. `buildRun` is where that is decided; this is how `unlockLevelsNow`
 * finds out.
 */
let gWalkthroughRun = false;

/**
 * Set by `stop()`, cleared by the next `start()`.
 *
 * A stop that lands while a run is still being assembled has nothing to stop:
 * the controller it flagged is not the one being built. This is how that
 * request survives to the one check that can still honour it.
 */
let gStopRequested = false;

/**
 * How long `stop()` waits for the task loop to hand back.
 *
 * Tasks are cooperative and only notice `ts.isRunning` at their own loop
 * boundaries, so a stop costs whatever the running task has left to do -- under
 * a second for an idle loop, a couple of seconds mid-round. Well above both,
 * because the cost of giving up too early is two task loops tapping the same
 * screen with two different configurations.
 */
const StopWaitMs = 20 * 1000;

function start(settings: Settings) {
  // A hand-written start() command can arrive with no `locale` at all; an
  // absent or unknown tag falls back to English inside `logStringsFor`, so
  // nothing here has to know which languages exist.
  const logs = logStringsFor(settings.locale);
  logSetMessages(logs);

  // A run still on the stack owns everything `buildRun` is about to replace.
  // Wind it down first, and refuse rather than double up if it will not go.
  if (gRunActive) {
    stop();
    if (gRunActive) {
      logWarn(Log.Run.StartBusy);
      return;
    }
  }
  gStopRequested = false;
  // Opened before anything can log, so every line from here to endRun() carries
  // the same runId -- including the ones buildRun writes on its way up.
  logBeginRun();
  // Before buildRun, so a recorder is already following when the first round
  // starts. `ts` does not exist yet, hence the free function rather than
  // `ts.emit` -- see emitScriptEvent in tsum.ts.
  emitScriptEvent(Emit.Run.Started, {
    version: ScriptVersion,
    skill: statsSkillName(settings.skillType),
    locale: settings.locale,
  });

  gRunErrored = false;
  try {
    buildRun(settings, logs);
    const controller = gTaskController;
    if (controller === undefined) {
      return;
    }
    saveLastRunSettings(settings);
    // A yield, not a rest: the host hands the interpreter lock over at every
    // `sleep()`, and this is the chance a `stop()` that arrived during the build
    // has to set its flag before the loop below starts tapping. It was 500ms,
    // which bought nothing the handover itself does not.
    sleep(50);
    if (!gStopRequested) {
      controller.start();
    }
  } catch (e) {
    // Flagged for endRun, so a workflow reports `failed` rather than a stop.
    gRunErrored = true;
    throw e;
  } finally {
    // Reached on the way out of the loop, and on any throw during the build --
    // either way this is the thread that owns the run, and the loop it was
    // running has ended.
    endRun();
  }
  logInfo(Log.Task.LoopStopped);
}

/**
 * Keys `start()` takes that are one-shot triggers rather than settings: a Now
 * button's run (and Box Buying's purchase). Replaying them would redo that action.
 */
const LastSettingsOneShot: SettingKey[] = [
  SettingKey.UnlockLevelsFirst,
  SettingKey.BuyBoxesFirst,
  SettingKey.TsumListOnly,
];

/**
 * `<script folder>/last-settings-<device id>.json`, or '' on a host without
 * either native. Per device, because emulator instances can share the folder.
 */
function lastSettingsPath(): string {
  if (typeof getScriptPath !== 'function' || typeof getDeviceId !== 'function') {
    return '';
  }
  return getScriptPath() + '/last-settings-' + getDeviceId() + '.json';
}

/**
 * Writes the settings this run started with, minus `LastSettingsOneShot`, so a
 * later start can replay them (`lastRunSettings`). Never throws: a failed write
 * is a warning, not a reason to stop the run.
 */
function saveLastRunSettings(settings: Settings): void {
  try {
    const path = lastSettingsPath();
    if (path === '') {
      return;
    }
    const copy: { [key: string]: unknown } = {};
    const source = settings as unknown as { [key: string]: unknown };
    for (const key in source) {
      if (LastSettingsOneShot.indexOf(key as SettingKey) === -1) {
        copy[key] = source[key];
      }
    }
    writeFile(path, JSON.stringify(copy));
  } catch (e) {
    logWarn(Log.Run.LastSettingsNotSaved, 'Could not save the last run settings',
      { errorText: '' + e });
  }
}

/**
 * The settings the last run on this device started with (see
 * `saveLastRunSettings`), or null when there is no readable file.
 */
function lastRunSettings(): Partial<Settings> | null {
  try {
    const path = lastSettingsPath();
    const text = path === '' ? '' : readFile(path);
    if (text === '') {
      return null;
    }
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Partial<Settings> : null;
  } catch (e) {
    return null;
  }
}

/**
 * What a start with no settings page runs with: `SettingDefaults` with the last
 * run's settings on top, so a device that never ran the script still starts,
 * and an old file missing newer keys gets their defaults. GAP Companion's
 * remote start runs it (`gapRemoteStartPrepare`, src/companion.ts).
 */
function remoteStartSettings(): Settings {
  return Object.assign({}, SettingDefaults, lastRunSettings() || {});
}

// --- Settings changed from GAP Companion -------------------------------------
//
// The phone can change any setting the settings page has. One that a run can
// take (`LiveSettings`, src/quickbar.ts) goes onto the world like a Quick Bar
// change. Every change is also kept for the next start in two files:
//   last-settings-<device id>.json    patched, so a remote start replays it
//   remote-settings-<device id>.json  pending, until the settings page takes
//                                     it (`remoteSettingsTake`) into its store,
//                                     so a Play from the page does not undo it

/** How a setting's value is checked; enum values go through `quickBarEnumValid`. */
const enum RemoteKind {
  Bool = 'bool',
  Int = 'int',
  Enum = 'enum',
}

/**
 * Every setting the phone may change. Left out: `locale` (the page's language)
 * and the one-shot keys (`LastSettingsOneShot`).
 */
const RemoteSettingKinds: { [key: string]: RemoteKind } = {
  [SettingKey.DebugLogs]: RemoteKind.Bool,
  [SettingKey.DebugGame]: RemoteKind.Bool,
  [SettingKey.CollectUnknownScreens]: RemoteKind.Bool,
  [SettingKey.Walkthrough]: RemoteKind.Bool,
  [SettingKey.SpecialScreenRatio]: RemoteKind.Bool,
  [SettingKey.DeviceFps]: RemoteKind.Int,
  [SettingKey.PageHistoryDepth]: RemoteKind.Int,
  [SettingKey.AutoLaunchApp]: RemoteKind.Bool,
  [SettingKey.AutoPlayGame]: RemoteKind.Bool,
  [SettingKey.TrackRoundStats]: RemoteKind.Bool,
  [SettingKey.ShareRoundStats]: RemoteKind.Bool,
  [SettingKey.ClickAssist]: RemoteKind.Bool,
  [SettingKey.RoundDelayMinutes]: RemoteKind.Int,
  [SettingKey.MaxRoundMinutes]: RemoteKind.Int,
  [SettingKey.MaxRoundAction]: RemoteKind.Enum,
  [SettingKey.StopAfterGames]: RemoteKind.Int,
  [SettingKey.StopAfterAction]: RemoteKind.Enum,
  [SettingKey.BubbleStrategy]: RemoteKind.Enum,
  [SettingKey.HoldBubblesLastFeverSec]: RemoteKind.Int,
  [SettingKey.UseFan]: RemoteKind.Bool,
  [SettingKey.MaxChainsPerScan]: RemoteKind.Int,
  [SettingKey.MaxChain]: RemoteKind.Int,
  [SettingKey.LinkReachPercent]: RemoteKind.Int,
  [SettingKey.PrioritizeMyTsum]: RemoteKind.Bool,
  [SettingKey.BonusScore]: RemoteKind.Bool,
  [SettingKey.BonusCoin]: RemoteKind.Bool,
  [SettingKey.BonusExp]: RemoteKind.Bool,
  [SettingKey.BonusTime]: RemoteKind.Bool,
  [SettingKey.BonusBubble]: RemoteKind.Bool,
  [SettingKey.Bonus5to4]: RemoteKind.Bool,
  [SettingKey.BonusCombo]: RemoteKind.Bool,
  [SettingKey.SkillWaitingTime]: RemoteKind.Int,
  [SettingKey.SkillSettleMs]: RemoteKind.Int,
  [SettingKey.SkillReactivationTenths]: RemoteKind.Int,
  [SettingKey.SkillLevel]: RemoteKind.Int,
  [SettingKey.SkillType]: RemoteKind.Enum,
  [SettingKey.SkillAutoTap]: RemoteKind.Bool,
  [SettingKey.LorcanaCard]: RemoteKind.Bool,
  [SettingKey.NoSkillLastFeverSec]: RemoteKind.Int,
  [SettingKey.UnlockLevelHoursWait]: RemoteKind.Int,
  [SettingKey.AutoUnlockMyTsumLevel]: RemoteKind.Bool,
  [SettingKey.BuyBoxHoursWait]: RemoteKind.Int,
  [SettingKey.BuyBoxType]: RemoteKind.Enum,
  [SettingKey.BuyBoxSize]: RemoteKind.Enum,
  [SettingKey.BuyBoxMaxPurchases]: RemoteKind.Int,
  [SettingKey.ReceiveAllHearts]: RemoteKind.Bool,
  [SettingKey.ReceiveAllHeartsMinWait]: RemoteKind.Int,
  [SettingKey.ReceiveHeartsOneByOne]: RemoteKind.Bool,
  [SettingKey.ReceiveHeartsSkipRuby]: RemoteKind.Bool,
  [SettingKey.ReceiveHeartsSkipMedals]: RemoteKind.Bool,
  [SettingKey.ClaimAllWithoutCoins]: RemoteKind.Bool,
  [SettingKey.MailOpenMax]: RemoteKind.Int,
  [SettingKey.MailMinWait]: RemoteKind.Int,
  [SettingKey.SendHeartsAuto]: RemoteKind.Bool,
  [SettingKey.SendHeartsToZeroScore]: RemoteKind.Bool,
  [SettingKey.SendHeartsMaxRuntime]: RemoteKind.Int,
  [SettingKey.SendHeartsMinWait]: RemoteKind.Int,
  [SettingKey.TsumAppRestartFrequency]: RemoteKind.Int,
} satisfies Record<Exclude<SettingKey, SettingKey.Locale | SettingKey.UnlockLevelsFirst
  | SettingKey.BuyBoxesFirst | SettingKey.TsumListOnly>, RemoteKind>;

/** `<script folder>/remote-settings-<device id>.json`, or '' without the natives. */
function remoteSettingsPath(): string {
  const last = lastSettingsPath();
  return last === '' ? '' : last.replace(/last-settings-([^/]*)$/, 'remote-settings-$1');
}

/** A JSON object file as an object; {} when missing or unreadable. */
function readJsonObject(path: string): { [key: string]: unknown } {
  try {
    const text = path === '' ? '' : readFile(path);
    const parsed = text === '' ? null : JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

/** Writes one remote change into both files (see above). Never throws. */
function rememberRemoteSetting(key: string, value: string | number | boolean): void {
  try {
    const pendingPath = remoteSettingsPath();
    if (pendingPath === '') {
      return;
    }
    const pending = readJsonObject(pendingPath);
    pending[key] = value;
    writeFile(pendingPath, JSON.stringify(pending));
    // Written in full (defaults filled in), so a device that never ran the
    // script still starts with this change.
    const last = remoteStartSettings() as unknown as { [key: string]: unknown };
    last[key] = value;
    writeFile(lastSettingsPath(), JSON.stringify(last));
  } catch (e) {
    logWarn(Log.Run.RemoteSettingNotSaved, 'Could not save a setting changed from GAP Companion',
      { setting: key, errorText: '' + e });
  }
}

/**
 * Every remote setting's current value: the running world's when there is a
 * run, else the next start's (`remoteStartSettings`), with pending remote
 * changes on top. `gapRemoteState` (src/companion.ts) sends it.
 */
function remoteSettingsValues(): { [key: string]: unknown } {
  const running = quickBarRunning();
  const values: { [key: string]: unknown } = {};
  const layers: { [key: string]: unknown }[] = [
    (running ? ts!.settings : remoteStartSettings()) as unknown as { [key: string]: unknown },
    readJsonObject(remoteSettingsPath()),
  ];
  // Last, because a live key's value on the world (Quick Bar included) is newest.
  if (running) {
    layers.push(JSON.parse(quickBarState()));
  }
  for (const layer of layers) {
    for (const key in layer) {
      if (RemoteSettingKinds.hasOwnProperty(key)) {
        values[key] = layer[key];
      }
    }
  }
  return values;
}

/**
 * Changes one setting for GAP Companion. Answers JSON `{ok, value, applies}`
 * (`now`, `nextRound` or `nextStart`) or `{ok: false, why}`; `gapRemoteSet`
 * (src/companion.ts) turns `why` into the contract's codes.
 */
function remoteSettingsApply(key: string, value: string | number | boolean): string {
  const kind = RemoteSettingKinds.hasOwnProperty(key) ? RemoteSettingKinds[key] : undefined;
  if (kind === undefined) {
    return JSON.stringify({ ok: false, why: 'unknown setting' });
  }
  const typed = kind === RemoteKind.Bool ? typeof value === 'boolean'
    : kind === RemoteKind.Int ? typeof value === 'number' && Math.floor(value) === value
      : typeof value === 'string';
  if (!typed || !quickBarEnumValid(key as SettingKey, value)) {
    return JSON.stringify({ ok: false, why: 'invalid value' });
  }
  // A running workflow owns it (forced to 0); `gapRemoteSet` answers `workflow-run`.
  if (quickBarWorkflowOwns(key)) {
    return JSON.stringify({ ok: false, why: 'workflow' });
  }
  let taken = value;
  let applies = 'nextStart';
  const when = LiveSettings[key];
  if (quickBarRunning() && when !== undefined && when !== LiveWhen.Restart) {
    const res = JSON.parse(quickBarApply(key as SettingKey, value));
    if (res.ok !== true) {
      return JSON.stringify(res);
    }
    taken = res.value;
    applies = quickBarHoldsBack(key as SettingKey) ? 'nextRound' : 'now';
  }
  rememberRemoteSetting(key, taken);
  return JSON.stringify({ ok: true, value: taken, applies: applies });
}

/**
 * The pending remote changes, as a JSON object, and clears them. Called by the
 * settings page, which takes them into its store.
 */
// noinspection JSUnusedGlobalSymbols
function remoteSettingsTake(): string {
  const path = remoteSettingsPath();
  const pending = readJsonObject(path);
  if (path !== '' && Object.keys(pending).length > 0) {
    try {
      writeFile(path, '{}');
    } catch (e) {
      // Taken again next time, which is harmless.
    }
  }
  return JSON.stringify(pending);
}

// --- GAP Companion's Settings tab, driven by this script ----------------------
//
// `companionSettings.json` is the settings page's own schema, written by
// tools/companion/settings.js at build time. The phone draws its Settings tab
// from it, so a settings change here needs no phone or adapter release.
// Contract (UI 2): "Settings from the script" in the companion repo's
// cloud/adapters/README.md.

/** One `layout` item: a setting, a button, or a note. */
interface CompanionItem { control?: string; button?: string; note?: string }
interface CompanionGroup { items: CompanionItem[] }
interface CompanionPage { groups: CompanionGroup[] }

/** The page's Now buttons the phone may press. Each answers a short status. */
const CompanionActions: { [name: string]: () => string } = {
  unlockLevelsNow: () => unlockLevelsNow(),
  buyBoxesNow: () => buyBoxesNow(),
  exportTsumListNow: () => exportTsumListNow(),
  roundDelaySkip: () => roundDelaySkip(),
};

/** When a change to `key` reaches a run, in the contract's words. */
function companionApplies(key: string): string {
  const when = LiveSettings[key];
  return when === LiveWhen.Now ? 'now' : when === LiveWhen.NextRound ? 'nextRound' : 'nextStart';
}

let gCompanionSchema: string | undefined;

/**
 * The phone's settings schema as JSON, or 'null' when the file is missing.
 * Keeps only settings in `RemoteSettingKinds` and buttons in `CompanionActions`.
 * A standard global the companion adapter library looks for.
 */
// noinspection JSUnusedGlobalSymbols
function gapSettingsSchema(): string {
  if (gCompanionSchema !== undefined) {
    return gCompanionSchema;
  }
  const file = typeof getScriptPath === 'function' ? getScriptPath() + '/companionSettings.json' : '';
  const raw = readJsonObject(file);
  if (!Array.isArray(raw.controls)) {
    return 'null';
  }
  const controls = (raw.controls as { key: string; applies?: string }[])
    .filter((c) => RemoteSettingKinds.hasOwnProperty(c.key));
  for (const c of controls) {
    c.applies = companionApplies(c.key);
  }
  const keys = controls.map((c) => c.key);
  const buttons = (Array.isArray(raw.buttons) ? raw.buttons as { name: string }[] : [])
    .filter((b) => CompanionActions.hasOwnProperty(b.name));
  const names = buttons.map((b) => b.name);
  // Drop what was filtered out, then any group or page left empty.
  const layout = (Array.isArray(raw.layout) ? raw.layout as CompanionPage[] : []).filter((page) => {
    page.groups = page.groups.filter((group) => {
      group.items = group.items.filter((item) => {
        if (item.control !== undefined && keys.indexOf(item.control) < 0) delete item.control;
        if (item.button !== undefined && names.indexOf(item.button) < 0) delete item.button;
        return item.control !== undefined || item.button !== undefined || item.note !== undefined;
      });
      return group.items.length > 0;
    });
    return page.groups.length > 0;
  });
  const presetFields = (Array.isArray(raw.presetFields) ? raw.presetFields as string[] : [])
    .filter((k) => keys.indexOf(k) >= 0);
  gCompanionSchema = JSON.stringify({ ui: raw.ui, controls: controls, layout: layout, buttons: buttons,
    presetFields: presetFields, translations: raw.translations || {} });
  return gCompanionSchema;
}

/**
 * Presses one of the schema's buttons for the phone. Answers JSON
 * `{ok: true, status}` or `{ok: false, why}` (`no run`, `unknown action`).
 */
// noinspection JSUnusedGlobalSymbols
function gapSettingsAction(name: string): string {
  if (!CompanionActions.hasOwnProperty(name)) {
    return JSON.stringify({ ok: false, why: 'unknown action' });
  }
  const status = CompanionActions[name]();
  if (status === 'no run' && ChoreNowFlags.hasOwnProperty(name)) {
    if (remoteStartSettings().walkthrough === true) {
      return JSON.stringify({ ok: false, why: 'walkthrough' });
    }
    // Nothing runs: arm it and have the phone send `start` (gapRemoteStartPrepare takes it).
    gChoreNowArmed = { name: name, at: Date.now() };
    return JSON.stringify({ ok: true, status: 'starting', start: true });
  }
  return JSON.stringify(status === 'no run' ? { ok: false, why: 'no run' } : { ok: true, status: status });
}

/** The phone's chore Now buttons, and the one-shot flag a run started for each sets. */
const ChoreNowFlags: { [name: string]: SettingKey } = {
  unlockLevelsNow: SettingKey.UnlockLevelsFirst,
  buyBoxesNow: SettingKey.BuyBoxesFirst,
  exportTsumListNow: SettingKey.TsumListOnly,
};

/** How long an armed chore waits for the phone's `start`. */
const ChoreNowArmedMs = 60 * 1000;

/** A chore Now pressed while stopped, until `choreNowTakeArmed` takes it. */
let gChoreNowArmed: { name: string; at: number } | null = null;

/** Set by `gapRemoteStartRun` for a run started only for a chore; `buildRun` takes it. */
let gChoreOnlyRun = false;

/** The armed chore's one-shot flag, or null; clears it either way. */
function choreNowTakeArmed(): SettingKey | null {
  const armed = gChoreNowArmed;
  gChoreNowArmed = null;
  if (armed === null || Date.now() - armed.at > ChoreNowArmedMs) {
    return null;
  }
  return ChoreNowFlags[armed.name];
}

/**
 * Builds the world one run plays in: the `Tsum`, the tuning `start()` maps onto
 * it, the router binding and the task set. Everything here is undone by
 * `endRun()`.
 */
function buildRun(settings: Settings, logs: LogCatalogue): void {
  // A GAP Companion workflow run (`startWorkflow`, src/workflow.ts). Taken and
  // cleared here, first, so nothing armed outlives this call.
  const workflowRef = workflowTakeArmed();
  gWorkflowRun = workflowRef !== null;
  // A phone Now on a stopped script: stop once the chore is done.
  const choreOnly = gChoreOnlyRun && !gWorkflowRun;
  gChoreOnlyRun = false;
  ts = new Tsum(settings.specialScreenRatio, logs);
  // From here on there is a world to dismantle, whether or not the rest of this
  // function gets to finish -- `start()` tears it down in its `finally`.
  gRunActive = true;
  ts.settings = settings
  logInfo(Log.Run.Start, { language: settings.locale || Locale.English });
  ts.debug = settings.debugGame;
  ts.collectUnknownScreens = settings.collectUnknownScreens;
  ts.bonus5to4 = settings.bonus5to4;
  if (ts.bonus5to4) {
    ts.uniqueTsumCount = 4;
  }
  ts.prioritizeMyTsum = settings.prioritizeMyTsum;
  // A workflow runs unattended, and its Restart app node launches the game.
  ts.autoLaunch = settings.autoLaunchApp || gWorkflowRun;
  ts.scoreItem = settings.bonusScore;
  ts.coinItem = settings.bonusCoin;
  ts.expItem = settings.bonusExp;
  ts.timeItem = settings.bonusTime;
  ts.bubbleItem = settings.bonusBubble;
  ts.comboItem = settings.bonusCombo;
  ts.sentToZero = settings.sendHeartsToZeroScore;
  ts.receiveCheckLimit = settings.mailOpenMax;
  ts.bubbleStrategy = settings.bubbleStrategy;
  // Defaulted for a hand-written start() command and for a stored form from
  // before the row existed: 0 is "never hold", which is how it always played.
  ts.holdBubblesLastFeverSec = typeof settings.holdBubblesLastFeverSec === 'number'
    ? settings.holdBubblesLastFeverSec : 0;
  ts.skillInterval = settings.skillWaitingTime * 1000;
  // Same default, same reason: a stored form from before the row existed.
  ts.skillSettleMs = typeof settings.skillSettleMs === 'number' && settings.skillSettleMs > 0
    ? settings.skillSettleMs : 0;
  ts.skillReactivationMs = typeof settings.skillReactivationTenths === 'number'
    && settings.skillReactivationTenths > 0 ? settings.skillReactivationTenths * 100 : 0;
  ts.skillLevel = settings.skillLevel;
  ts.skillType = settings.skillType;
  ts.trackRoundStats = settings.trackRoundStats;
  // `=== true` for a stored form from before the row existed. Off forgets
  // what was sent, as switching it off mid-run does.
  ts.sendRoundStats = settings.shareRoundStats === true;
  if (!ts.sendRoundStats) {
    roundShareClear(ts.devicePath);
  }
  ts.skillAutoTap = settings.skillAutoTap;
  ts.lorcanaCard = settings.lorcanaCard === true;
  ts.unlockLevelHoursWait = settings.unlockLevelHoursWait;
  // `=== true` for a stored form from before the row existed.
  ts.autoUnlockMyTsumLevel = settings.autoUnlockMyTsumLevel === true;
  // Defaulted for a hand-written start() command: a missing box would make the
  // sweep buy nothing at all rather than the wrong thing, but naming one is
  // still the friendlier failure.
  ts.buyBoxType = settings.buyBoxType || BoxType.Premium;
  // Missing means singles: the one size that can never spend ten boxes' worth.
  ts.buyBoxSize = settings.buyBoxSize || BoxPurchaseSize.One;
  // Checked rather than taken, because this one is what stops a chore that
  // spends the player's coins: a hand-written start() command has no range.
  ts.buyBoxMaxPurchases = typeof settings.buyBoxMaxPurchases === 'number'
    ? settings.buyBoxMaxPurchases : 0;
  // A negative or fractional one can arrive from a hand-written start() command.
  ts.roundDelayMs = typeof settings.roundDelayMinutes === 'number'
    && settings.roundDelayMinutes > 0
    ? Math.round(settings.roundDelayMinutes) * 60 * 1000 : 0;
  // Same guard, and for the same reason: 0 is "no cap", so anything that is not
  // a positive number has to land on 0 rather than on a cap of NaN, which every
  // comparison in the play loop would answer false to.
  ts.maxRoundMs = typeof settings.maxRoundMinutes === 'number'
    && settings.maxRoundMinutes > 0
    ? Math.round(settings.maxRoundMinutes) * 60 * 1000 : 0;
  // Defaulted rather than taken, for a hand-written start() command: an
  // unrecognised action would match no branch and silently play the round out,
  // which is the one behaviour the cap exists to replace.
  ts.maxRoundAction = settings.maxRoundAction === MaxRoundAction.Stop
    ? MaxRoundAction.Stop : MaxRoundAction.Coast;
  // Off in a workflow: its Play rounds node counts rounds instead, and the
  // Auto Play off action removes a PlayRound job this mode never registers.
  ts.stopAfterGames = !gWorkflowRun && typeof settings.stopAfterGames === 'number'
    && settings.stopAfterGames > 0 ? Math.round(settings.stopAfterGames) : 0;
  ts.stopAfterAction = stopAfterActionOf(settings.stopAfterAction);
  ts.autoPlayGame = settings.autoPlayGame;
  ts.sendHearts = settings.sendHeartsAuto;
  ts.receiveOneByOne = settings.receiveHeartsOneByOne;
  ts.keepRuby = settings.receiveHeartsSkipRuby;
  ts.skipMedals = settings.receiveHeartsSkipMedals;
  ts.sendHeartMaxDuring = settings.sendHeartsMaxRuntime * 60 * 1000;
  ts.useFan = settings.useFan;
  if (typeof settings.maxChainsPerScan === 'number' && settings.maxChainsPerScan >= 1) {
    ts.maxChainsPerScan = settings.maxChainsPerScan;
  }
  ts.readRecord();
  if (ts.record[RecordKey.HeartsCount] === undefined) {
    ts.record[RecordKey.HeartsCount] = {
      receivedCount: 0,
      sentCount: 0
    };
  }

  Config.debugLogs = settings.debugLogs;
  Config.maxChain = settings.maxChain;
  // Bounded here as well as in the UI, because a share code clamps to *its*
  // version's range and a hand-edited start() command has no range at all --
  // and a reach of 0 links nothing while a huge one links the whole board into
  // one chain the game will not draw. Out of range, data.ts's value stands.
  if (typeof settings.linkReachPercent === 'number'
      && settings.linkReachPercent >= 100 && settings.linkReachPercent <= 400) {
    Config.linkReach = settings.linkReachPercent / 100;
  }
  logInfo(Log.Board.LinkReach, {
    reachPx: +(Config.tsumWidth * Config.linkReach).toFixed(0),
    reachTsumWidths: Config.linkReach,
  });

  // The page router. Attach before any task can ask what is on screen, which is
  // to say before gTaskController.start() below.
  //
  // `historyDepth` is how many screens back the trail goes; the frames are only
  // written when debug is on, because that is a PNG per page change. `fps` is
  // what scales the transient windows in PageProfiles -- the game counts those
  // in frames, so a device running at 120 shows them for half as long.
  gPages.attach(ts);
  // The other load-time singleton that outlives a run, and the only one holding
  // state from the last one: whatever the screen was doing when the previous
  // run ended has nothing to do with what this one is about to see.
  gFever.reset();
  // The other load-time state a round owns rather than a run. Reset here as
  // well as at the whistle, so a run built while the last one's transformation
  // was still set starts from untransformed whatever happens before the first
  // round begins.
  lorcanaReset();
  // Same reasoning: the forecast suppresses a repeat of what it last said, and
  // what it said during the previous run is not something this one has said.
  gForecastLast = '';
  if (typeof settings.pageHistoryDepth === 'number' && settings.pageHistoryDepth >= 0) {
    gPages.historyDepth = settings.pageHistoryDepth;
  }
  if (typeof settings.deviceFps === 'number' && settings.deviceFps > 0) {
    gPages.fps = settings.deviceFps;
  }
  // The trail's frames are on for every run, because an issue report copies
  // them and the person who needs one has already hit the bug -- see
  // `PageRouter.keepShots`. What "Debug game" still buys is *depth*: the whole
  // trail rather than the handful a report takes.
  gPages.keepShots = gPages.historyDepth > 0;
  gPages.shotDepth = ts.debug ? gPages.historyDepth : Config.reportTrailFrames;

  ts.noSkillLastFeverSec = settings.noSkillLastFeverSec;
  ts.claimAllWithoutCoins = settings.claimAllWithoutCoins;
  ts.tsumAppRestartFrequency = settings[SettingKey.TsumAppRestartFrequency];

  // The one assert worth keeping: every file in `tsconfig.json` is concatenated
  // into one script, so a bundle that did not build fully fails here with a
  // sentence rather than a bare TypeError several frames deep.
  if (typeof TsumTaskController !== 'function') {
    logError(Log.Run.BundleIncomplete,
      'TsumTaskController is missing -- the bundle did not concatenate correctly');
    return;
  }

  gTaskController = new TsumTaskController();

  // The task set is `runTaskTable` (src/runPlan.ts), which the settings page's
  // Run order card reads too -- so what it describes is what gets registered.

  // Set when a Now button started this run -- see `unlockLevelsNow`, `buyBoxesNow`.
  const unlockFirst = settings.unlockLevelsFirst === true;
  const buyBoxesFirst = settings.buyBoxesFirst === true;
  const tsumListOnly = settings.tsumListOnly === true;

  // The walkthrough recorder is a mode, not a task alongside the others: it is
  // watching a person play, so nothing else may touch the screen. The table
  // returns it alone, which is what enforces that -- the recorder itself only
  // ever calls `gPages.sweep`, which scores the table without broadcasting, so
  // not even a dismiss handler fires. See src/walkthrough.ts.
  gWalkthroughRun = !gWorkflowRun && settings.walkthrough === true;
  if (gWalkthroughRun) {
    if (unlockFirst) {
      logWarn(Log.Unlock.NowRefused, { reason: 'walkthrough' });
    }
    if (buyBoxesFirst) {
      logWarn(Log.Box.NowRefused, { reason: 'walkthrough' });
    }
    if (tsumListOnly) {
      logWarn(Log.TsumList.NowRefused, { reason: 'walkthrough' });
    }
  }
  // A workflow replaces the chore table: its nodes call the chores in its own
  // order. Refused (e.g. a node needs the Tsum List): nothing is registered
  // and the run ends before any node runs.
  if (gWorkflowRun && !workflowBegin(workflowRef!)) {
    return;
  }
  const jobs = gWorkflowRun ? workflowTaskTable() : runTaskTable(settings);
  for (let i = 0; i < jobs.length; i++) {
    gTaskController.register(jobs[i], taskBody(ts, jobs[i].name));
  }
  if (!gWalkthroughRun) {
    if (unlockFirst) {
      queueUnlockSweep(ts, gTaskController, choreOnly);
    }
    if (buyBoxesFirst) {
      queueBuyBoxSweep(ts, gTaskController, choreOnly);
    }
    if (tsumListOnly) {
      queueTsumListExport(ts, gTaskController, true);
    }
  }
  // Add-ons (src/addons.ts) queue their own one-shots; each checks the run's mode.
  gapAddonsRunStart(ts, gTaskController);
}

/**
 * The method a job name binds to, on this run's `Tsum`.
 *
 * A switch rather than a lookup by string, so a name the table can produce and
 * this cannot bind is a build error.
 */
function taskBody(run: Tsum, name: TaskName): TaskBody {
  switch (name) {
    case TaskName.Walkthrough: return run.taskWalkthrough.bind(run);
    case TaskName.ReceiveOneItem: return run.taskReceiveOneItem.bind(run);
    case TaskName.ReceiveAllItems: return run.taskReceiveAllItems.bind(run);
    case TaskName.SendHearts: return run.taskSendHearts.bind(run);
    case TaskName.AppRestart: return run.taskTsumAppRestart.bind(run);
    case TaskName.ClickAssist: return run.taskClickAssist.bind(run);
    // These two return "ran, or stood aside" for the Now queue. The controller
    // reads `true` as "due again next pass", so the result stops here -- passing
    // it through looped the sweep back to back instead of every N hours.
    case TaskName.UnlockLevel: return () => { run.taskAutoUnlockLevel(); };
    case TaskName.BuyBoxes: return () => { run.taskBuyBoxes(); };
    case TaskName.PlayRound: return run.taskPlayGameQuick.bind(run);
    case TaskName.Workflow: return workflowPass;
  }
}

/**
 * Dismantles the world `buildRun` made, in the order the parts can safely go.
 *
 * Only ever called by the thread running `start()`, and only once its loop has
 * handed back -- which is what makes clearing `ts` and detaching the router safe
 * here and unsafe from `stop()`.
 */
function endRun(): void {
  if (!gRunActive) {
    return;
  }
  gRunActive = false;
  gWalkthroughRun = false;
  gUnlockNowQueued = false;
  gBuyBoxNowQueued = false;
  gTsumListNowQueued = false;
  gapAddonsRunEnd();
  // Before `ts` goes, so the workflow's closing banner still has somewhere to go.
  workflowRunEnded();
  // Read before `ts` is cleared below; the event itself goes out with the rest
  // of the closing lines.
  const rounds = ts === undefined ? 0 : ts.runCoins.rounds;
  if (ts !== undefined) {
    ts.isRunning = false;
  }
  if (gTaskController !== undefined) {
    gTaskController.stop();
    gTaskController = undefined;
  }
  // Last, with `ts`: the router throws rather than no-op when it is asked about
  // a screen with nothing attached, and until the loops above have wound down
  // one of them can still be mid-detection.
  gPages.detach();
  ts = undefined;
  emitScriptEvent(Emit.Run.Stopped, { rounds: rounds });
  // Last, so the lines above are still attributed to the run that wrote them.
  logEndRun();
}

/**
 * Raises every flag that ends a run, and returns at once.
 *
 * The half of `stop()` a task body may call. `stop()` itself waits for
 * `gRunActive` to clear, and that is the run's own thread handing back -- so a
 * task calling it would be waiting for itself and spend `StopWaitMs` doing it.
 * Flags are all a task needs: it returns, the controller's loop sees
 * `isRunning` false and ends, and `start()`'s `finally` calls `endRun()`.
 */
function requestStop(): void {
  // First, so that a run still being assembled sees it before it starts a loop.
  gStopRequested = true;

  if (ts !== undefined) {
    logInfo(Log.Run.Stop);
    // The flag every long task body polls: a game already in progress hands the
    // loop back at its next check rather than mid-chain. It is also what the
    // touch wrappers read (src/tsum.ts), so whatever the task does before that
    // check stays off the screen -- the host drops its input as well when the
    // stop is its own, since a paused run is parked inside the tap it was
    // about to make and only the host can catch that one.
    ts.isRunning = false;
  }
  if (gTaskController !== undefined) {
    gTaskController.removeAllTasks();
    gTaskController.stop();
  }
}

/**
 * Asks the running script to end, and waits for it.
 *
 * Called from the settings page (Stop), from the host's own stop, and from
 * `start()` -- often two of those at once, which is why nothing here tears
 * anything down: it flags, and it waits.
 */
function stop() {
  const run = ts;
  requestStop();
  if (!gRunActive) {
    return;
  }

  const deadline = Date.now() + StopWaitMs;
  while (gRunActive && Date.now() < deadline) {
    sleep(100);
  }
  if (gRunActive && run !== undefined) {
    // Left alone deliberately: the run is wedged somewhere that is not checking
    // its flag, and clearing `ts` out from under it is exactly the bug this
    // handshake exists to prevent. `start()` refuses to build a second world
    // over it, so pressing Play again is safe and is what to do.
    logWarn(Log.Run.StopSlow, { waitedMs: StopWaitMs });
  }
}

/**
 * Ends the between-rounds wait now, so the next round starts at the play task's
 * next turn rather than when the delay would have run out.
 *
 * A global for the same reason `start` and `stop` are: the settings page reaches
 * it by evaluating its name through `JavaScriptInterface.runScript`. Only the
 * *running* wait is cleared -- the setting itself is untouched, so the round
 * after this one waits again.
 *
 * Returns what it decided, which the host writes to the log.
 */
// noinspection JSUnusedGlobalSymbols
function roundDelaySkip(): string {
  if (!gRunActive || ts === undefined) {
    return 'no run';
  }
  const left = ts.roundDelayRemainingMs();
  if (left <= 0) {
    return 'nothing waiting';
  }
  ts.nextRoundAt = 0;
  logInfo(Log.Play.RoundDelaySkipped, { skippedMs: left });
  return 'skipped ' + Math.round(left / 1000) + 's';
}

/** Name of the one-shot job `stopAfterThisRound` queues for between rounds. */
const WrapUpNowTask = 'wrapUpNow';

/**
 * "Stop after this round": ends the run once the round in progress is over, or
 * at the loop's next turn when no round is being played (between rounds, Auto
 * Play off, a chore running). A global the Quick Bar reaches by name.
 *
 * A run-time flag on `ts`, not a setting: never saved, never in a preset, and
 * gone with the run. Returns a short status for the host's log.
 */
// noinspection JSUnusedGlobalSymbols
function stopAfterThisRound(): string {
  if (!gRunActive || ts === undefined || gTaskController === undefined) {
    return 'no run';
  }
  if (ts.wrapUpAsked) {
    return 'already armed';
  }
  const run = ts;
  run.wrapUpAsked = true;
  const inRound = quickBarInRound(run);
  logInfo(Log.Play.WrapUpArmed, { inRound: inRound });
  run.banner(inRound ? 'Stopping after this round' : 'Stopping before the next round', 4000);
  // Covers the runs no round tail will reach: Auto Play off, a rest, chores.
  // Waits while a round is on; that round's tail fires first.
  gTaskController.newTask(WrapUpNowTask, function() {
    if (!quickBarInRound(run)) {
      run.wrapUpIfAsked('betweenRounds');
    }
  }, 1000, 0, false, JobPriority.WrapUpNow);
  return inRound ? 'armed: after this round' : 'armed: before the next round';
}

/** Disarms `stopAfterThisRound`. A global the Quick Bar reaches by name. */
// noinspection JSUnusedGlobalSymbols
function cancelStopAfterThisRound(): string {
  if (!gRunActive || ts === undefined) {
    return 'no run';
  }
  if (gTaskController !== undefined) {
    gTaskController.removeTask(WrapUpNowTask);
  }
  if (!ts.wrapUpAsked) {
    return 'not armed';
  }
  ts.wrapUpAsked = false;
  logInfo(Log.Play.WrapUpCancelled);
  ts.banner('Stop after this round cancelled', 3000);
  return 'cancelled';
}

/**
 * Puts the settings page's saved values onto the run in progress, for the rows
 * a run can take mid-run.
 *
 * A global for the same reason `start`, `stop` and `roundDelaySkip` are: the
 * settings page reaches it by evaluating its name through
 * `JavaScriptInterface.runScript`. It is sent the *whole* form on every save
 * and keeps no list of what is live -- `quickBarApplyOne` (src/quickbar.ts) is
 * that list, and it is the same one the Quick Bar's own changes go through, so
 * a value edited on either side means the same thing. Everything else is
 * ignored in silence: most of a run's configuration is read once by `buildRun`
 * and only a fresh `start()` can change it.
 *
 * Only what differs from `ts.settings` -- what the world is set to *now*, which
 * is why the Quick Bar writes there too -- is applied. Re-applying an unchanged
 * row is not free: picking a skill lifts the previous skill's hold on "Link
 * MyTsum first", and setting the between-rounds delay re-bases a rest already
 * running on it.
 *
 * Some of what it takes lands at the next round rather than now -- the tsum on
 * the board cannot be swapped under a round already dealt. See
 * `LiveSettings` (src/quickbar.ts); the answer says which.
 *
 * Returns what it decided, which the host writes to the log.
 */
// noinspection JSUnusedGlobalSymbols
function applyLiveSettings(values?: Partial<Settings>): string {
  if (!gRunActive || ts === undefined) {
    return 'no run';
  }
  if (values === undefined) {
    return 'no settings';
  }
  // `Settings` has no index signature and each field is narrower than what
  // arrives here -- which `quickBarApplyOne` clamps and coerces to it.
  const wanted = values as unknown as { [key: string]: string | number | boolean };
  const current = ts.settings as unknown as { [key: string]: string | number | boolean };
  const keys = Object.keys(wanted);
  const applied: string[] = [];
  const held: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (wanted[key] === current[key] || quickBarWorkflowOwns(key)) {
      continue;
    }
    if (quickBarApplyOne(ts, key as SettingKey, wanted[key]) === undefined) {
      continue;
    }
    applied.push(key);
    // Taken, but by the next round rather than by this one -- see
    // `LiveSettings` (src/quickbar.ts). Worth separating because this is
    // the call a whole preset arrives on, and one that changes only these looks
    // from the outside like a preset that did nothing.
    if (quickBarHoldsBack(key as SettingKey)) {
      held.push(key);
    }
  }
  if (applied.length === 0) {
    return 'nothing to apply';
  }
  logInfo(Log.Settings.LiveApplied, 'The settings page changed the running world',
    { settings: applied, heldForNextRound: held });
  quickBarSayHeldBack(ts, held.length);
  return 'applied ' + applied.join(' ')
    + (held.length === 0 ? '' : ' (' + held.join(' ') + ' at the next round)');
}

/** Name of the one-shot task `unlockLevelsNow` queues. */
const UnlockNowTask = 'autoUnlockLevelNow';

/**
 * How soon the one-shot comes round again after standing aside.
 *
 * It stands aside for a round in progress -- the board, or the game's own pause
 * menu, where its detect has already had `dismiss.resumeGame` press Continue.
 * The round is the play task's to finish, and the sweep goes once that hands
 * back. The play task's own cadence, so the two take turns until then.
 */
const UnlockNowRetryMs = 3 * 1000;

/** Set while a sweep asked for from the settings page is waiting for its turn. */
let gUnlockNowQueued = false;

/**
 * Registers the sweep on `controller`, to run at the loop's first free turn.
 * `unlockLevelsNow` calls this on a live run, `buildRun` on one started for it.
 *
 * The sweep goes before everything but a round in progress. Its priority
 * (`JobPriority.UnlockNow`, ahead of every scheduled job) is what puts it
 * first among the tasks that are *due*; `ts.yieldAsked` is what gets the
 * running one to hand back -- the heart and mailbox chores poll it at every
 * step, and the play task will not start a round while it is up.
 *
 * Not `runTimes: 1`: a task that runs once is gone whether or not it did
 * anything, and the sweep stands aside for a round. It stays registered until
 * `taskAutoUnlockLevel` says it ran, and removes itself then.
 *
 * `stopAfter`: a run started only for the sweep, which ends once it is done.
 */
function queueUnlockSweep(run: Tsum, controller: TsumTaskController, stopAfter: boolean): void {
  gUnlockNowQueued = true;
  run.yieldAsked = true;
  let waited = false;
  controller.newTask(UnlockNowTask, function() {
    run.yieldAsked = false;
    if (!run.taskAutoUnlockLevel()) {
      // A round is on. It is the play task's to finish, and everything else
      // still waits behind the sweep.
      run.yieldAsked = true;
      if (!waited) {
        waited = true;
        logInfo(Log.Unlock.NowWaiting);
      }
      return;
    }
    gUnlockNowQueued = false;
    controller.removeTask(UnlockNowTask);
    notifyChoreDone('unlock', run.lastChore);
    if (stopAfter) {
      requestStop();
    }
  }, UnlockNowRetryMs, 0, false, JobPriority.UnlockNow);
  logInfo(Log.Unlock.NowQueued);
  run.banner('Raising level caps next', 4000);
}

/**
 * Runs the level-cap sweep once, whatever the schedule says.
 *
 * A global for the same reason `start`, `stop` and `roundDelaySkip` are: the
 * settings page reaches it by evaluating its name through
 * `JavaScriptInterface.runScript`.
 *
 * On a live run it queues rather than sweeps. The bridge evaluates this on the
 * host's thread, and the sweep taps the screen for minutes -- so running it
 * here would put two things on the same screen, which is the bug `stop()`'s
 * handshake exists to prevent. A task instead: the loop takes it at its next
 * turn, which is as soon as whatever is running now hands back.
 *
 * With nothing running, and `settings` given, it starts a run: the page's own
 * `start()` command with `unlockLevelsFirst` set, so `buildRun` queues the
 * sweep ahead of the loop's first turn. Like `start()`, that does not return
 * until the run ends -- this thread becomes the run's, as it does for Play.
 *
 * Returns what it decided, which the host writes to the log.
 */
// noinspection JSUnusedGlobalSymbols
function unlockLevelsNow(settings?: Settings): string {
  if (!gRunActive || ts === undefined || gTaskController === undefined) {
    if (settings === undefined) {
      return 'no run';
    }
    settings.unlockLevelsFirst = true;
    start(settings);
    return 'started';
  }
  if (gWalkthroughRun) {
    // The recorder is watching a person play; a sweep would be the script
    // tapping over them, and the walk would record its taps as theirs.
    logWarn(Log.Unlock.NowRefused, { reason: 'walkthrough' });
    return 'walkthrough recording';
  }
  if (gUnlockNowQueued) {
    return 'already queued';
  }
  queueUnlockSweep(ts, gTaskController, false);
  return 'queued';
}

/** Name of the one-shot task `buyBoxesNow` queues. */
const BuyBoxNowTask = 'buyBoxesNow';

/** Set while a Box Buying sweep asked for from the settings page is waiting for its turn. */
let gBuyBoxNowQueued = false;

/**
 * Registers a Box Buying sweep on `controller`, to run at the loop's first free
 * turn. The level-cap sweep's `queueUnlockSweep`, for the other chore that has a
 * Now button -- see that function for why the priority and `yieldAsked` are what
 * they are, and why it is not `runTimes: 1`.
 *
 * The two share `ts.yieldAsked`, which is a flag rather than a queue: with both
 * queued, whichever the controller takes first clears it and the other's still
 * stands, so they run one after the other rather than fighting for the screen.
 *
 * `stopAfter`: a run started only for the sweep, which ends once it is done.
 */
function queueBuyBoxSweep(run: Tsum, controller: TsumTaskController, stopAfter: boolean): void {
  gBuyBoxNowQueued = true;
  run.yieldAsked = true;
  let waited = false;
  controller.newTask(BuyBoxNowTask, function() {
    run.yieldAsked = false;
    if (!run.taskBuyBoxes()) {
      // A round is on. It is the play task's to finish, and everything else
      // still waits behind the sweep.
      run.yieldAsked = true;
      if (!waited) {
        waited = true;
        logInfo(Log.Box.NowWaiting);
      }
      return;
    }
    gBuyBoxNowQueued = false;
    controller.removeTask(BuyBoxNowTask);
    notifyChoreDone('boxes', run.lastChore);
    if (stopAfter) {
      requestStop();
    }
  }, UnlockNowRetryMs, 0, false, JobPriority.BuyBoxesNow);
  logInfo(Log.Box.NowQueued);
  run.banner('Buying boxes next', 4000);
}

/**
 * Buys boxes once, whatever the schedule says.
 *
 * A global for the same reason `start`, `stop`, `roundDelaySkip` and
 * `unlockLevelsNow` are: the settings page reaches it by evaluating its name
 * through `JavaScriptInterface.runScript`. It behaves as `unlockLevelsNow` does
 * -- queued on a live run rather than run on the host's thread, or a run started
 * for it when nothing is playing -- and that function carries the reasoning for
 * both.
 *
 * One difference: this sweep has settings of its own -- which box, how many at a
 * time, how many purchases -- so on a live run the form goes onto the run before
 * the sweep is queued. The panel's own save carries them too, but it is pushed
 * on the host's worker thread while this call comes down the bridge, so it need
 * not have landed yet; the sweep would then run on the value the run started
 * with.
 *
 * Returns what it decided, which the host writes to the log.
 */
// noinspection JSUnusedGlobalSymbols
function buyBoxesNow(settings?: Settings): string {
  if (!gRunActive || ts === undefined || gTaskController === undefined) {
    if (settings === undefined) {
      return 'no run';
    }
    settings.buyBoxesFirst = true;
    start(settings);
    return 'started';
  }
  if (gWalkthroughRun) {
    logWarn(Log.Box.NowRefused, { reason: 'walkthrough' });
    return 'walkthrough recording';
  }
  if (gBuyBoxNowQueued) {
    return 'already queued';
  }
  applyLiveSettings(settings);
  queueBuyBoxSweep(ts, gTaskController, false);
  return 'queued';
}

/** Name of the one-shot task `exportTsumListNow` queues. */
const TsumListNowTask = 'exportTsumListNow';

/** Set while a Tsum List export asked for from the settings page waits for its turn. */
let gTsumListNowQueued = false;

/**
 * Registers the Tsum List export on `controller`, the way `queueBuyBoxSweep`
 * does. `stopAfter` is set for a run started only for the export, which ends
 * once it is done.
 */
function queueTsumListExport(run: Tsum, controller: TsumTaskController, stopAfter: boolean): void {
  gTsumListNowQueued = true;
  run.yieldAsked = true;
  let waited = false;
  controller.newTask(TsumListNowTask, function() {
    run.yieldAsked = false;
    if (!run.taskExportTsumList()) {
      run.yieldAsked = true;
      if (!waited) {
        waited = true;
        logInfo(Log.TsumList.NowWaiting);
      }
      return;
    }
    gTsumListNowQueued = false;
    controller.removeTask(TsumListNowTask);
    notifyChoreDone('tsumList', run.lastChore);
    if (stopAfter) {
      requestStop();
    }
  }, UnlockNowRetryMs, 0, false, JobPriority.TsumListNow);
  logInfo(Log.TsumList.NowQueued);
  run.banner('Exporting the Tsum list next', 4000);
}

/**
 * Exports the Tsum list once. A global the settings page reaches by name, like
 * `buyBoxesNow`: queued on a live run, which carries on afterwards; with
 * nothing running it starts a run for the export alone, which stops when the
 * export is done.
 *
 * Returns what it decided, which the host writes to the log.
 */
// noinspection JSUnusedGlobalSymbols
function exportTsumListNow(settings?: Settings): string {
  if (!gRunActive || ts === undefined || gTaskController === undefined) {
    if (settings === undefined) {
      return 'no run';
    }
    settings.tsumListOnly = true;
    start(settings);
    return 'started';
  }
  if (gWalkthroughRun) {
    logWarn(Log.TsumList.NowRefused, { reason: 'walkthrough' });
    return 'walkthrough recording';
  }
  if (gTsumListNowQueued) {
    return 'already queued';
  }
  queueTsumListExport(ts, gTaskController, false);
  return 'queued';
}

// input: rgb in [0,255], out: h in [0,360) and s,v in [0,100]
function rgb2hsv(rgb: Color): { h: number; s: number; v: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const v = Math.max(r, g, b), c = v - Math.min(r, g, b);
  const h = c && ((v === r) ? (g - b) / c : ((v === g) ? 2 + (b - r) / c : 4 + (r - g) / c));
  return {h: 60 * (h < 0 ? h + 6 : h), s: Math.round(v && c / v * 100), v: Math.round(v * 100)};
}
