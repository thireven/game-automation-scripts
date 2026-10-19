// The engine half of the Quick Bar.
//
// The Quick Bar is the strip the host draws on the screen's bottom edge, under
// the log: the handful of settings worth changing between rounds, without
// opening the settings panel and without ending the run. Its page is
// `src/quickbar.html` and lives in the host's WebView; everything here is what
// that page reaches through `JavaScriptInterface.runScript`.
//
// Three entry points, and they are the whole contract:
//
//   quickBarState()          what to draw -- the live values and the run's coin
//                            averages, as one JSON string
//   quickBarApply(key, ...)  one setting, onto the running world
//   onPause()                the host's pause hook (below)
//   onResume()               its resume hook, the counterpart
//
// The first two are read by the settings page as well, which is why the apply
// itself is `quickBarApplyOne`, a function of its own. What a live setting
// change *is* lives here; `applyLiveSettings` (src/index.ts) is the settings
// page's way in to that same switch, so the strip and the panel cannot
// disagree about which rows a run in progress will take.
//
// ## Why the settings are written onto `ts` and not through `start()`
//
// `start({...})` builds a whole new world: a new `Tsum`, a new task set, a new
// run record. That is the right thing when the settings page is closed and
// wrong here -- the point of the Quick Bar is to change something *mid-run*,
// keeping the round, the stats and the coin averages that go with it. So each
// key is written to the field `buildRun` would have written it to, and the page
// separately patches localStorage so the settings page agrees at the next start.
//
// A change is written to `ts.settings` as well, which is why that object means
// "what the world is set to" rather than "what start() was handed". The
// round-stats CSV is written from a copy of it taken when the round began, so
// without that write every row would go on quoting the settings page's values
// hours after the strip had moved on from them.
//
// ## Why most of them wait
//
// The strip is opened over a round that is *paused*, not one that has ended, so
// a setting the round was **set up** under cannot be changed halfway through
// it -- only decided again for the next one. Which tsum is on the board, which
// items were bought, how many colours it was dealt with: written straight onto
// the world they leave the play loop reading a board under rules it was never
// dealt under, which is a round that goes wrong rather than a round that
// changed.
//
// So waiting for the whistle is the **default**, and landing now is the
// exception a setting has to earn by being read fresh, during play, by the pass
// that wants it. `LiveSettings` further down is that decision per setting, with
// the read site named for each `Now`; `quickBarApplyPending` is the whistle;
// and `quickBarAsked` is why the pages still draw the new value at once.
//
// ## onPause
//
// The host evaluates `onPause()` **after** it sets the engine's pause flag, and
// lets that one evaluation through the gate that parks `tap()` for everyone else
// (see the host's `awaitResume`). Pressing the game's own Pause button here is
// what stops the round's clock while the user edits.
//
// After, not before, because the two orders are not equivalent: run before the
// flag, the press lands while the play loop is still going, and the loop's next
// detect sees `GamePause` and has `dismiss.resumeGame` press Continue straight
// back -- the round carries on with the script frozen beside it. Frozen first,
// nothing here is racing anything.
//
// ## onResume
//
// The counterpart, evaluated through the same gate **before** the flag lifts.
// A paused run is parked inside the touch it was about to make -- usually the
// next step of a chain planned before the pause. Leaving Continue to the play
// loop meant that touch, and the rest of the batch, landed on the pause menu
// first, where Try Again and To Home Screen are. So `onPause` remembers the
// pause, and `onResume` presses Continue and waits for the board while the run
// is still frozen. The batch then sees `pauses` moved and stops (board.ts).

/** Nothing is applied to a world that is not there; the page shows values only. */
function quickBarRunning(): boolean {
  return gRunActive && ts !== undefined;
}

/**
 * What the Quick Bar draws, as JSON.
 *
 * A string rather than an object because it crosses `runScriptCallback`, which
 * hands the page whatever the eval coerced to text. Keys are `SettingKey`
 * members so the page and this file cannot drift; `active` is what the page
 * gates its own controls on when there is no run at all.
 */
function quickBarState(): string {
  const state: { [key: string]: string | number | boolean } = { active: quickBarRunning() };
  if (ts !== undefined) {
    // Read through `quickBarAsked`, every one of them, because these are the
    // `NextRound` settings: the round in front of the loop is still playing
    // under the old value, and what a page draws is what the user chose. The
    // whistle is when the world catches up. See `LiveSettings`.
    //
    // No cell draws `lorcanaCard`, and it is still reported: **every key that
    // can be applied has to be readable here.** The settings page reads this
    // and pushes its form back, so a key it cannot see is a key it would push
    // to its own stale value at the next save. The same goes for every row
    // below, drawn or not.
    state[SettingKey.SkillType] = quickBarAsked(ts, SettingKey.SkillType, ts.skillType);
    state[SettingKey.LorcanaCard] = quickBarAsked(ts, SettingKey.LorcanaCard, ts.lorcanaCard);
    state[SettingKey.Bonus5to4] = quickBarAsked(ts, SettingKey.Bonus5to4, ts.bonus5to4);
    state[SettingKey.BonusScore] = quickBarAsked(ts, SettingKey.BonusScore, ts.scoreItem);
    state[SettingKey.BonusCoin] = quickBarAsked(ts, SettingKey.BonusCoin, ts.coinItem);
    state[SettingKey.BonusExp] = quickBarAsked(ts, SettingKey.BonusExp, ts.expItem);
    state[SettingKey.BonusTime] = quickBarAsked(ts, SettingKey.BonusTime, ts.timeItem);
    state[SettingKey.BonusBubble] = quickBarAsked(ts, SettingKey.BonusBubble, ts.bubbleItem);
    state[SettingKey.BonusCombo] = quickBarAsked(ts, SettingKey.BonusCombo, ts.comboItem);
    state[SettingKey.TrackRoundStats] =
      quickBarAsked(ts, SettingKey.TrackRoundStats, ts.trackRoundStats);

    // The `Now` settings: the world is the answer, because the world already
    // has them.
    state[SettingKey.SkillLevel] = ts.skillLevel;
    state[SettingKey.AutoSkillLevel] = ts.autoSkillLevel;
    state[SettingKey.MaxChainsPerScan] = ts.maxChainsPerScan;
    state[SettingKey.MaxChain] = Config.maxChain;
    state[SettingKey.SkillWaitingTime] = Math.round(ts.skillInterval / 1000);
    state[SettingKey.SkillSettleMs] = ts.skillSettleMs;
    state[SettingKey.SkillReactivationTenths] = Math.round(ts.skillReactivationMs / 100);
    state[SettingKey.SkillAutoTap] = ts.skillAutoTap;
    state[SettingKey.NoSkillLastFeverSec] = ts.noSkillLastFeverSec;
    state[SettingKey.PrioritizeMyTsum] = ts.prioritizeMyTsum;
    state[SettingKey.UseFan] = ts.useFan;
    state[SettingKey.BubbleStrategy] = ts.bubbleStrategy;
    state[SettingKey.HoldBubblesLastFeverSec] = ts.holdBubblesLastFeverSec;
    state[SettingKey.LinkReachPercent] = Math.round(Config.linkReach * 100);
    // The Box Buying rows are the settings panel's, and they are reported for
    // the reason above: the panel is the only thing that changes them, and it
    // reads this back.
    state[SettingKey.BuyBoxType] = ts.buyBoxType;
    state[SettingKey.BuyBoxSize] = ts.buyBoxSize;
    // The limit as the sweep would read it. 0 is "no usable setting", which
    // `buyBoxes` turns into BuyBoxDefaultMax; the form's row has no 0, so
    // reporting the raw value would move it to the row's minimum instead.
    state[SettingKey.BuyBoxMaxPurchases] = ts.buyBoxMaxPurchases > 0
      ? ts.buyBoxMaxPurchases : BuyBoxDefaultMax;
    state[SettingKey.AutoUnlockMyTsumLevel] = ts.autoUnlockMyTsumLevel;
    state[SettingKey.ShareRoundStats] = ts.sendRoundStats;
    state[SettingKey.SendHeartsAuto] = ts.sendHearts;
    state[SettingKey.ReceiveHeartsOneByOne] = ts.receiveOneByOne;
    state[SettingKey.AutoPlayGame] = ts.autoPlayGame;
    // Reported without being drawn, for the reason above: the strip's own Rest
    // stepper made way for the preset chip, and the settings panel's row is now
    // the only one that moves it -- which means the panel reads this back.
    state[SettingKey.RoundDelayMinutes] = Math.round(ts.roundDelayMs / 60000);
    // Reported without being drawn either, and for the same reason: the
    // settings panel is the only thing that moves them, and it reads this back.
    state[SettingKey.MaxRoundMinutes] = Math.round(ts.maxRoundMs / 60000);
    state[SettingKey.MaxRoundAction] = ts.maxRoundAction;
    // In a workflow the world holds 0 (`buildRun`); the page is shown its own
    // value, so it neither adopts the 0 nor pushes its value back.
    state[SettingKey.StopAfterGames] = gWorkflowRun
      ? ts.settings.stopAfterGames : ts.stopAfterGames;
    state[SettingKey.StopAfterAction] = ts.stopAfterAction;
    // A span rather than the instant it ends at, so a page counting it down
    // needs the two clocks to agree about nothing. 0 is "nothing is resting".
    // Nothing draws it since the countdown left the strip; it is kept because
    // the rest is the one thing a run does that a reader cannot see coming, and
    // `roundDelaySkip()` -- the panel's Now button -- is still there to end it.
    state.roundDelayRemainingMs = ts.roundDelayRemainingMs();
    // "Stop after this round" (`stopAfterThisRound`, src/index.ts). A run-time
    // flag, not a `SettingKey`, so neither page stores it.
    state.stopAfterThisRound = ts.wrapUpAsked;
    // A GAP Companion workflow's progress: `workflowStep` is what the strip's
    // readout fits, `workflow` the whole line. Both absent outside one.
    const progress = workflowProgress();
    if (progress !== null) {
      state.workflowStep = progress.step;
      state.workflow = progress.line;
    }

    // What the strip marks its cells from: whether a round is on, and which
    // settings that round will not take. Not `SettingKey`s themselves, so the
    // settings page's `takeSettingValues` walks past both -- it looks each key
    // up in the schema and skips what has no row, the way it already does for
    // the coin averages below.
    //
    // Reported rather than worked out on the page for the usual reason: the
    // answer is `LiveSettings`, the page is a separate compilation, and a second
    // copy of it there would be a list to keep in step.
    state.inRound = quickBarInRound(ts);
    state.nextRound = quickBarHeldKeys().join(' ');
    // The tsum being played, by its full name, as the pre-round screen
    // identified it ('' until then, or when the match was unsure). The
    // companion app shows it.
    state.myTsum = ts.myTsumName;

    const coins = ts.runCoins;
    state.rounds = coins.rounds;
    state.baseCoinRounds = coins.baseRounds;
    state.finalCoinRounds = coins.finalRounds;
    // -1 rather than 0 for "no round has reported one yet": zero coins is a
    // number the game can genuinely produce, and the page draws a dash for -1.
    state.baseCoinAvg = coins.baseRounds > 0
      ? Math.round(coins.baseTotal / coins.baseRounds) : -1;
    state.finalCoinAvg = coins.finalRounds > 0
      ? Math.round(coins.finalTotal / coins.finalRounds) : -1;
    // The run's medals; the companion app's Stats tab shows it.
    state.medals = coins.medalTotal;
    // Nothing on the strip draws these five: they are what the readout chip
    // copies to the clipboard when it is tapped (`qbCopyStats`). Base coins,
    // not final: the copy's coin line is the figure the board earned.
    state.baseCoinTotal = coins.baseTotal;
    state.baseCoinMin = coins.baseMin;
    state.baseCoinMax = coins.baseMax;
    state.medalMin = coins.medalMin;
    state.medalMax = coins.medalMax;
    // A dash until a round has actually earned medals, so a run without them
    // does not show a row of zeros.
    state.medalAvg = coins.medalTotal > 0
      ? Math.round(coins.medalTotal / coins.medalRounds) : -1;

    // The time readout, in seconds; the page formats them. -1 is "no round yet".
    const clock = ts.runClock;
    state.avgRoundSec = clock.rounds > 0 ? Math.round(clock.roundSec / clock.rounds) : -1;
    state.playedSec = clock.roundSec;
    state.runSec = Math.round((Date.now() - clock.startedAt) / 1000);
    // The copy's shortest and longest round, drawn nowhere.
    state.minRoundSec = clock.minSec;
    state.maxRoundSec = clock.maxSec;
  }
  return JSON.stringify(state);
}

/**
 * Applies one setting to the running world.
 *
 * Returns the value that was actually taken, as JSON, so the page can redraw
 * from what landed rather than from what it asked for -- a number out of range
 * is clamped here, not rejected.
 */
function quickBarApply(key: SettingKey, value: string | number | boolean): string {
  if (!quickBarRunning()) {
    return JSON.stringify({ ok: false, why: 'no run' });
  }
  // Refused rather than coerced: an enum value nothing knows would be written
  // onto the world as-is (or quietly become the default).
  if (!quickBarEnumValid(key, value)) {
    logWarn(Log.QuickBar.InvalidValue, 'The Quick Bar sent a value this setting does not have',
      { setting: key, value: value });
    return JSON.stringify({ ok: false, why: 'invalid value' });
  }
  if (quickBarWorkflowOwns(key)) {
    logWarn(Log.Workflow.SettingRefused, 'A running workflow owns this setting', { setting: key });
    return JSON.stringify({ ok: false, why: 'workflow' });
  }
  const applied = quickBarApplyOne(ts!, key, value);
  if (applied === undefined) {
    logWarn(Log.QuickBar.UnknownSetting, 'The Quick Bar named a setting it cannot change',
      { setting: key });
    return JSON.stringify({ ok: false, why: 'unknown setting' });
  }
  const held = quickBarHoldsBack(key);
  logInfo(Log.QuickBar.Applied, 'A setting was changed from the Quick Bar',
    { setting: key, value: applied, takesEffect: held ? 'nextRound' : 'now' });
  quickBarSayHeldBack(ts!, held ? 1 : 0);
  return JSON.stringify({ ok: true, value: applied });
}

/**
 * Whether a running workflow owns `key`, so neither page may change it: Stop
 * after games, which `buildRun` forces to 0 for one, and Auto Play, since a
 * workflow's nodes play the rounds.
 */
function quickBarWorkflowOwns(key: string): boolean {
  return gWorkflowRun && quickBarRunning()
    && (key === SettingKey.StopAfterGames || key === SettingKey.AutoPlayGame);
}

/**
 * The values each enum setting may take. `satisfies` makes a member added to
 * the enum a build error until it is listed here.
 */
const QuickBarEnumValues: { [key: string]: { [value: string]: true } } = {
  [SettingKey.BubbleStrategy]: {
    [BubbleStrategy.OneMidChain]: true,
    [BubbleStrategy.AllMidChain]: true,
    [BubbleStrategy.SaveOneMidChain]: true,
    [BubbleStrategy.SaveOne]: true,
    [BubbleStrategy.AllAsap]: true,
  } satisfies Record<BubbleStrategy, true>,
  [SettingKey.BuyBoxType]: {
    [BoxType.PremiumPlus]: true,
    [BoxType.Premium]: true,
    [BoxType.Select]: true,
    [BoxType.Capsule]: true,
    [BoxType.Happiness]: true,
  } satisfies Record<BoxType, true>,
  [SettingKey.BuyBoxSize]: {
    [BoxPurchaseSize.One]: true,
    [BoxPurchaseSize.Ten]: true,
    [BoxPurchaseSize.TenThenOne]: true,
  } satisfies Record<BoxPurchaseSize, true>,
  [SettingKey.MaxRoundAction]: {
    [MaxRoundAction.Coast]: true,
    [MaxRoundAction.Stop]: true,
  } satisfies Record<MaxRoundAction, true>,
  [SettingKey.StopAfterAction]: {
    [StopAfterAction.AutoPlayOff]: true,
    [StopAfterAction.Pause]: true,
    [StopAfterAction.Stop]: true,
  } satisfies Record<StopAfterAction, true>,
  [SettingKey.GameRegion]: {
    [GameRegion.Auto]: true,
    [GameRegion.Global]: true,
    [GameRegion.Japan]: true,
  } satisfies Record<GameRegion, true>,
};

/**
 * False when `key` is an enum setting and `value` is not one of its members;
 * true for every other key. A skill is valid when it has a handler, or is No
 * Skill (which has none).
 */
function quickBarEnumValid(key: SettingKey, value: string | number | boolean): boolean {
  if (key === SettingKey.SkillType) {
    return typeof value === 'string'
      && (value === SkillType.NoSkill || SkillHandlers[value] !== undefined);
  }
  const allowed = QuickBarEnumValues[key];
  return allowed === undefined
    || (typeof value === 'string' && allowed.hasOwnProperty(value));
}

/**
 * Writes one setting onto the running world, and onto `ts.settings` beside it.
 *
 * Returns what was actually taken -- clamped rather than refused -- or
 * `undefined` for a key with no live field.
 *
 * **This switch is the list of what can change mid-run**, and both ways in go
 * through it: the Quick Bar above, and the settings page through
 * `applyLiveSettings` (src/index.ts). Neither keeps a list of its own, so the
 * two cannot disagree about what a live change means -- and a key added here is
 * live from both at once. Whatever it takes, `quickBarState` has to report.
 *
 * `atRoundStart` is the whistle asking for the ones that were held back, and is
 * `quickBarApplyPending`'s alone -- everybody else lets `LiveSettings`
 * decide. The answer is the same either way, so a caller drawing from it does
 * not have to know which of the two happened.
 */
function quickBarApplyOne(tsum: Tsum, key: SettingKey,
                          value: string | number | boolean,
                          atRoundStart?: boolean): string | number | boolean | undefined {
  // Held back rather than written, unless this *is* the whistle -- see
  // `LiveSettings` for which three and why.
  if (atRoundStart !== true && quickBarHoldsBack(key)) {
    return quickBarSetAside(tsum, key, value);
  }
  let applied: string | number | boolean = value;
  switch (key) {
    case SettingKey.SkillType:
      tsum.skillType = value as SkillType;
      // A hold on "Link MyTsum first" belongs to the skill that asked for it;
      // the new skill's own hooks stop running the old one's mode, so nothing
      // else would ever lift it.
      tsum.setMyTsumPriority(true);
      break;
    case SettingKey.SkillLevel:
      applied = quickBarClamp(value, 1, 6);
      tsum.skillLevel = applied as number;
      break;
    // Read by `identifyMyTsum` at each pre-round screen, so it lands there.
    case SettingKey.AutoSkillLevel:
      applied = !!value;
      tsum.autoSkillLevel = applied;
      break;
    case SettingKey.MaxChainsPerScan:
      applied = quickBarClamp(value, 1, 12);
      tsum.maxChainsPerScan = applied as number;
      break;
    case SettingKey.MaxChain:
      applied = quickBarClamp(value, 3, 15);
      Config.maxChain = applied as number;
      break;
    // The six bonus items. Only `openRound`'s item screen reads them, which is
    // the next round by definition, so none of them needs holding back.
    case SettingKey.BonusScore:
      applied = !!value;
      tsum.scoreItem = applied;
      break;
    case SettingKey.BonusCoin:
      applied = !!value;
      tsum.coinItem = applied;
      break;
    case SettingKey.BonusExp:
      applied = !!value;
      tsum.expItem = applied;
      break;
    case SettingKey.BonusTime:
      applied = !!value;
      tsum.timeItem = applied;
      break;
    case SettingKey.BonusBubble:
      applied = !!value;
      tsum.bubbleItem = applied;
      break;
    case SettingKey.BonusCombo:
      applied = !!value;
      tsum.comboItem = applied;
      break;
    // No cell in quickbar.html draws this one: it is here because the skill
    // sheet switches it on with Lorcana Aurora (`SkillOption.enables`), and a
    // skill has to bring its transformation handling with it. Held back with
    // the skill it belongs to -- it decides how many colour clusters a scan
    // keeps, and the board in front of the loop was dealt under the old answer.
    case SettingKey.LorcanaCard:
      applied = !!value;
      tsum.lorcanaCard = applied;
      break;
    // How a round is played rather than how it was set up: each of these is
    // read fresh by the pass that wants it, so a change lands on the next scan.
    case SettingKey.PrioritizeMyTsum:
      applied = !!value;
      tsum.prioritizeMyTsum = applied;
      break;
    case SettingKey.UseFan:
      applied = !!value;
      tsum.useFan = applied;
      break;
    case SettingKey.SkillAutoTap:
      applied = !!value;
      tsum.skillAutoTap = applied;
      break;
    case SettingKey.BubbleStrategy:
      tsum.bubbleStrategy = value as BubbleStrategy;
      break;
    // Chores rather than play: each switch adds or removes its job.
    case SettingKey.SendHeartsAuto:
      applied = !!value;
      tsum.sendHearts = applied;
      quickBarSyncJob(tsum, TaskName.SendHearts, key, applied);
      break;
    case SettingKey.ReceiveHeartsOneByOne:
      applied = !!value;
      tsum.receiveOneByOne = applied;
      quickBarSyncJob(tsum, TaskName.ReceiveOneItem, key, applied);
      break;
    // Off drops only the round job, as Stop after games does; the sweeps keep
    // their schedules. On adds back whichever of the three a fresh start would.
    case SettingKey.AutoPlayGame:
      applied = !!value;
      tsum.autoPlayGame = applied;
      quickBarSyncJob(tsum, TaskName.PlayRound, key, applied);
      if (applied) {
        quickBarSyncJob(tsum, TaskName.UnlockLevel, key, true);
        quickBarSyncJob(tsum, TaskName.BuyBoxes, key, true);
      }
      break;
    case SettingKey.HoldBubblesLastFeverSec:
      applied = quickBarClamp(value, 0, 10);
      tsum.holdBubblesLastFeverSec = applied as number;
      break;
    case SettingKey.SkillWaitingTime:
      applied = quickBarClamp(value, 0, 15);
      tsum.skillInterval = (applied as number) * 1000;
      break;
    case SettingKey.SkillSettleMs:
      applied = quickBarClamp(value, 0, 3000);
      tsum.skillSettleMs = applied as number;
      break;
    case SettingKey.SkillReactivationTenths:
      applied = quickBarClamp(value, 0, 300);
      tsum.skillReactivationMs = (applied as number) * 100;
      break;
    case SettingKey.NoSkillLastFeverSec:
      applied = quickBarClamp(value, 0, 10);
      tsum.noSkillLastFeverSec = applied as number;
      break;
    // The same bounds `buildRun` uses, which are wider than the row's: a share
    // code clamps to its own version's range, and a hand-written start() has none.
    case SettingKey.LinkReachPercent:
      applied = quickBarClamp(value, 100, 400);
      Config.linkReach = (applied as number) / 100;
      break;
    // The CSV is written per round off this flag, so it can move mid-run.
    case SettingKey.TrackRoundStats:
      applied = !!value;
      tsum.trackRoundStats = applied;
      break;
    // Read after each row is written (roundShareAfterRow). Off clears the
    // cursor, so nothing is kept about what was shared.
    case SettingKey.ShareRoundStats:
      applied = !!value;
      if (!applied && tsum.sendRoundStats) {
        roundShareClear(tsum.devicePath);
      }
      tsum.sendRoundStats = applied;
      break;
    // The Box Buying sweep reads these off `ts` when it runs, so a change made
    // between sweeps lands on the next one -- including the one the panel's Now
    // button queues right behind the save that carried it. The schedule beside
    // them (`buyBoxHoursWait`) is not here: that is the task's interval, fixed
    // when the run registered it.
    case SettingKey.BuyBoxType:
      tsum.buyBoxType = value as BoxType;
      break;
    case SettingKey.BuyBoxSize:
      tsum.buyBoxSize = value as BoxPurchaseSize;
      break;
    case SettingKey.BuyBoxMaxPurchases:
      applied = quickBarClamp(value, 1, BuyBoxMaxPurchases);
      tsum.buyBoxMaxPurchases = applied as number;
      break;
    case SettingKey.AutoUnlockMyTsumLevel:
      applied = !!value;
      tsum.autoUnlockMyTsumLevel = applied;
      break;
    case SettingKey.RoundDelayMinutes:
      applied = quickBarClamp(value, 0, 120);
      quickBarSetRoundDelay(tsum, (applied as number) * 60 * 1000);
      break;
    case SettingKey.MaxRoundMinutes:
      applied = quickBarClamp(value, 0, 60);
      tsum.maxRoundMs = (applied as number) * 60 * 1000;
      break;
    // Anything unrecognised lands on Coast, the way `buildRun` defaults it: the
    // one behaviour the cap exists to replace is a round played out regardless.
    case SettingKey.MaxRoundAction:
      applied = value === MaxRoundAction.Stop
        ? MaxRoundAction.Stop : MaxRoundAction.Coast;
      tsum.maxRoundAction = applied as MaxRoundAction;
      break;
    // A new target restarts the count, so "5" means five more from here.
    case SettingKey.StopAfterGames:
      applied = quickBarClamp(value, 0, 999);
      if (applied !== tsum.stopAfterGames) {
        tsum.gamesTowardStop = 0;
      }
      tsum.stopAfterGames = applied as number;
      break;
    case SettingKey.StopAfterAction:
      applied = stopAfterActionOf(value);
      tsum.stopAfterAction = applied as StopAfterAction;
      break;
    // Held back, and this pairing is why: `uniqueTsumCount` is how many colours
    // every board scan keeps, and the board in front of the loop was dealt under
    // the old answer. The same pairing `buildRun` makes.
    case SettingKey.Bonus5to4:
      applied = !!value;
      tsum.bonus5to4 = applied;
      tsum.uniqueTsumCount = applied ? 4 : 5;
      break;
    // Not a live setting -- most of the form is not. The caller decides whether
    // that is worth a word: from the strip it is a wiring bug, and from the
    // settings page, which sends the whole form, it is the ordinary case.
    default:
      return undefined;
  }
  // Below the `default`, so only a key that was actually applied is recorded --
  // and every one of them is, without a second per-key list to keep in step.
  quickBarRecord(tsum.settings, key, applied);
  return applied;
}

/**
 * Records the change on the run's settings object, beside the live field.
 *
 * `beginRoundStats` copies that object for the CSV, so it has to hold what the
 * world is currently set to. The cast is unavoidable: `Settings` has no index
 * signature, and each key's field type is narrower than the value arriving here
 * -- which `quickBarApply` has already coerced and clamped to it.
 */
function quickBarRecord(settings: Settings, key: SettingKey,
                        value: string | number | boolean): void {
  (settings as unknown as { [k: string]: string | number | boolean })[key] = value;
}

// --- When a setting reaches the run ----------------------------------------
//
// Three bugs in this file's history were all the same bug: a setting whose
// answer to "when does this reach a run in progress?" was never written down.
// The Box Buying rows had no `case` and did nothing until a restart; twelve of
// the rows a preset carries had none either and were dropped in silence; and
// the skill, 5>4 and the Lorcana card had one when they should not have, which
// left the play loop reading a board under rules it was never dealt under.
//
// `LiveSettings` below is that answer, declared once per setting. It is not a
// convenience over the switch -- it is what `npm run live:check` compares the
// switch, `quickBarState` and `SHARE_SLOTS` against, so a setting added without
// one of the three is a failing check rather than a bug found on a device weeks
// later. What that check enforces, exactly:
//
//   * every row a preset carries (`SHARE_SLOTS`) is named here;
//   * `Now` and `NextRound` keys have a `case` in `quickBarApplyOne`, and
//     `Restart` keys have none;
//   * every one of them is reported by `quickBarState`, and reported as the
//     same value the apply said it took -- which is what stops a unit
//     conversion (`skillInterval`, `linkReach`) from oscillating the form;
//   * a `NextRound` key touches nothing but `pendingSettings` until the
//     whistle, and a `Now` key touches the world at once.
//
// What it cannot decide is *which* of the three a new setting is. That is a
// judgement, and the question to ask is: does a pass reading this run during a
// round, against a board that was dealt before the change? If it does, the
// setting is `NextRound`.

const enum LiveWhen {
  /**
   * Set aside, and applied at the whistle by `quickBarApplyPending`. **The
   * default**, and what anything not explicitly `Now` or `Restart` gets --
   * including a kind added to this enum and not taught to `quickBarHoldsBack`.
   */
  NextRound = 'nextRound',
  /**
   * Onto the running world as it arrives. The one to argue for: a setting
   * earns this only by being read *fresh, during play*, by the pass that wants
   * it -- so a board already dealt is not being reinterpreted, it is simply
   * played differently from the next scan on.
   */
  Now = 'now',
  /** Only a fresh `start()`: it decides what a run *is*, not how it plays. */
  Restart = 'restart',
}

/**
 * **When each setting reaches a run in progress.** One entry per row a preset
 * carries, plus the Box Buying rows the settings panel changes live. A key that
 * is not here is not a live setting at all: `quickBarApplyOne` answers
 * `undefined` and the caller skips it, which is most of the form.
 *
 * Read the `Now` block as the exceptions. Everything else waits for the
 * whistle, because the Quick Bar is opened over a round that is *paused*, not
 * one that has ended: a setting the round was set up under cannot be changed
 * halfway through it, only decided again for the next one.
 */
const LiveSettings: { [key: string]: LiveWhen } = {
  // --- Read fresh, during play, by the pass that wants them ----------------
  //
  // The whole `Now` list, and each one is a claim about a read site:
  //   maxChain, maxChainsPerScan   skillMaxChain / skillMaxChainsPerScan, per scan
  //   linkReachPercent             Config.linkReach, per chain search
  //   prioritizeMyTsum             skillMyTsumPriority, per scan
  //   useFan                       play.ts, twice in the play loop
  //   bubbleStrategy               the bubble sweep, per scan
  //   holdBubblesLastFeverSec      bubblesHeldForFever, per pop
  //   skillWaitingTime             ts.skillInterval, per activation
  //   skillSettleMs                useSkill, per activation
  //   skillReactivationTenths      skillStillRunning, per activation
  //   skillAutoTap                 maybeAutoTapSkill, inside a link batch
  //   noSkillLastFeverSec          the skill decision, per activation
  //   skillLevel                   per activation. The level of the tsum you
  //                                own is fixed for the round, so this is a
  //                                correction to the script's model of it --
  //                                which is worth taking at once, and reshapes
  //                                nothing the board reader depends on.
  [SettingKey.MaxChain]: LiveWhen.Now,
  [SettingKey.MaxChainsPerScan]: LiveWhen.Now,
  [SettingKey.LinkReachPercent]: LiveWhen.Now,
  [SettingKey.PrioritizeMyTsum]: LiveWhen.Now,
  [SettingKey.UseFan]: LiveWhen.Now,
  [SettingKey.BubbleStrategy]: LiveWhen.Now,
  [SettingKey.HoldBubblesLastFeverSec]: LiveWhen.Now,
  [SettingKey.SkillWaitingTime]: LiveWhen.Now,
  [SettingKey.SkillSettleMs]: LiveWhen.Now,
  [SettingKey.SkillReactivationTenths]: LiveWhen.Now,
  [SettingKey.SkillAutoTap]: LiveWhen.Now,
  [SettingKey.NoSkillLastFeverSec]: LiveWhen.Now,
  [SettingKey.SkillLevel]: LiveWhen.Now,
  // Read at the next pre-round screen, which is where the level is set.
  [SettingKey.AutoSkillLevel]: LiveWhen.Now,
  // The gap *between* rounds, so there is no round to be halfway through -- and
  // for that same reason not a row a preset carries. Now rather than at the
  // whistle because `quickBarSetRoundDelay` re-bases a rest that is already
  // running, which is the panel's stepper cutting a wait short. Held back it
  // could only ever affect the wait after next.
  [SettingKey.RoundDelayMinutes]: LiveWhen.Now,
  // The play loop re-reads both every turn round it (`taskPlayGameQuick`), and
  // the cap is measured against `roundStartedAt` rather than counted down -- so
  // raising it mid-round extends the round in front of the loop and lowering it
  // can end that round on the next turn, which is what someone watching a round
  // that will not finish is asking for. Not preset rows: they cap how long the
  // *run* spends on a round, not how one is played.
  [SettingKey.MaxRoundMinutes]: LiveWhen.Now,
  [SettingKey.MaxRoundAction]: LiveWhen.Now,
  // Read at each round's tail (`countGameTowardStop`), so a change counts from
  // the round in progress. Not preset rows: they shape the run, not a round.
  [SettingKey.StopAfterGames]: LiveWhen.Now,
  [SettingKey.StopAfterAction]: LiveWhen.Now,
  // Not preset rows either -- these belong to the account rather than to how a
  // round is played -- and live because the sweep re-reads them when it runs,
  // which is between rounds by definition.
  [SettingKey.BuyBoxType]: LiveWhen.Now,
  [SettingKey.BuyBoxSize]: LiveWhen.Now,
  [SettingKey.BuyBoxMaxPurchases]: LiveWhen.Now,
  // Read at the round's end -- by the level-up record handler and then the
  // play task's tail -- so a switch thrown mid-round counts for this round.
  [SettingKey.AutoUnlockMyTsumLevel]: LiveWhen.Now,
  // Read after each round's row is written, never during play.
  [SettingKey.ShareRoundStats]: LiveWhen.Now,
  // Each chooses a job in the run's task set, and `quickBarSyncJob` adds or
  // removes that job on the live scheduler. A job runs between rounds, so the
  // round in front of the loop is untouched. Not preset rows.
  [SettingKey.SendHeartsAuto]: LiveWhen.Now,
  [SettingKey.ReceiveHeartsOneByOne]: LiveWhen.Now,
  // The round job, synced the same way. Off lets the round in progress finish:
  // the job is only taken off the schedule, never interrupted.
  [SettingKey.AutoPlayGame]: LiveWhen.Now,

  // --- The round in front of the loop was set up under the old value -------
  //
  // The tsum on the board. Its choreography, its per-round state
  // (`lorcanaReset`, the skill's own hooks) and its gauge all belong to the
  // tsum that was picked before the round started.
  [SettingKey.SkillType]: LiveWhen.NextRound,
  // A property of that tsum too: it claims an extra cluster slot for the ink
  // stones and starts the medallion poll, which blind-taps where the card sits
  // (src/lorcana.ts).
  [SettingKey.LorcanaCard]: LiveWhen.NextRound,
  // Four colours instead of five. An item, and `uniqueTsumCount` with it --
  // how many colour clusters every scan keeps. Set against a board already
  // dealt, the scan drops a live colour off the board array and the chain
  // search cannot plan over it.
  [SettingKey.Bonus5to4]: LiveWhen.NextRound,
  // The other five items, for the plainest reason of all: `openRound`'s item
  // screen is the only thing that reads them, and that screen is the next
  // round's. Nothing in the play loop asks whether +Coin is on -- the item
  // either was bought for this round or was not.
  [SettingKey.BonusScore]: LiveWhen.NextRound,
  [SettingKey.BonusCoin]: LiveWhen.NextRound,
  [SettingKey.BonusExp]: LiveWhen.NextRound,
  [SettingKey.BonusTime]: LiveWhen.NextRound,
  [SettingKey.BonusBubble]: LiveWhen.NextRound,
  [SettingKey.BonusCombo]: LiveWhen.NextRound,
  // Bookkeeping about rounds rather than a rule one is played under, so no
  // preset carries it. A round's row is opened at the whistle and closed at the
  // tally: switched on halfway through, `sampleBaseCoins` starts sampling a
  // round whose early reads it missed; switched off, `finishRoundStats` drops a
  // round that was begun. Either way the row for the round in progress is wrong,
  // so the flag moves between rounds like everything else here.
  [SettingKey.TrackRoundStats]: LiveWhen.NextRound,

  // --- Only a fresh start() ------------------------------------------------
  //
  // Chooses which tasks a run registers (`runTaskTable`), so there is no field
  // to write: the task set is built once, by `buildRun`.
  [SettingKey.ClickAssist]: LiveWhen.Restart,
};

/**
 * Whether the whistle has already gone for the round the loop is on.
 *
 * True from the moment `playRound` drains what was held -- which is before the
 * walk that opens the pre-round screen, so `openingRound` counts -- until the
 * tally clears `roundStartedAt`. Inside that window a change to a held setting
 * cannot reach the round in front of the loop, and the strip says so; outside
 * it, the whistle is seconds away and everything effectively lands now.
 */
function quickBarInRound(tsum: Tsum): boolean {
  return tsum.openingRound || tsum.roundStartedAt !== 0;
}

/** The keys that wait for the whistle, for the strip to mark its cells from. */
function quickBarHeldKeys(): SettingKey[] {
  const keys: SettingKey[] = [];
  for (const key in LiveSettings) {
    if (LiveSettings[key] === LiveWhen.NextRound) {
      keys.push(key as SettingKey);
    }
  }
  return keys;
}

/**
 * Whether this key waits for the whistle. Both entry points ask, to say so.
 *
 * Written as "not `Now`, not `Restart`" rather than "is `NextRound`" so the
 * default falls the safe way: a setting whose entry is neither of the two
 * things that mean *write it* is held, not written. `Restart` is excluded
 * because it has no case to run at the whistle either -- it falls through to
 * the switch's `default` and the caller skips it.
 */
function quickBarHoldsBack(key: SettingKey): boolean {
  const when = LiveSettings[key];
  return when !== undefined && when !== LiveWhen.Now && when !== LiveWhen.Restart;
}

/**
 * Sets one change aside for the next round, and answers with what it will take.
 *
 * The value is coerced by its own type rather than by key, because the switch
 * has not run and `NextRound` is the default -- so this has to be a safe place
 * for any setting to land, not only for the ten that are there today. What it
 * does *not* do is clamp: a range lives in one `case` each and would have to be
 * written twice to be honoured here. The whistle clamps instead, and
 * `live:check`'s `stable` rule is what notices if that ever changes a value the
 * pages were already shown.
 *
 * Recorded onto `tsum.settings` now even though the world has not moved, and
 * both directions need it. The settings page pushes its whole form at every
 * save and skips a row already at the run's value, so without this it would
 * re-send the same change forever; and a user who sets the value back before
 * the round starts would be skipped there and left with the first change still
 * pending. The round in progress reads `roundSettings`, its own copy, so the
 * CSV is unaffected.
 */
function quickBarSetAside(tsum: Tsum, key: SettingKey,
                          value: string | number | boolean): string | number | boolean {
  const applied = typeof value === 'boolean' ? value
    : typeof value === 'number' ? Math.round(value) : String(value);
  tsum.pendingSettings[key] = applied;
  quickBarRecord(tsum.settings, key, applied);
  return applied;
}

/**
 * What the pages should draw: what was asked for, not what the round is still
 * playing under. `quickBarState` reads every held-back key through this.
 */
function quickBarAsked(tsum: Tsum, key: SettingKey,
                       live: string | number | boolean): string | number | boolean {
  const pending = tsum.pendingSettings[key];
  return pending === undefined ? live : pending;
}

/**
 * Puts everything set aside onto the world. Called by the play task at the
 * whistle, before the walk that opens the pre-round screen -- which is where
 * the bonus items are chosen and 5>4 decides the board's colours.
 *
 * Emptied before the writes, not after: `quickBarApplyOne` is re-entered with
 * `atRoundStart`, and an entry still in the map would be set aside again.
 */
function quickBarApplyPending(tsum: Tsum): void {
  const pending = tsum.pendingSettings;
  const keys = Object.keys(pending);
  if (keys.length === 0) {
    return;
  }
  tsum.pendingSettings = {};
  for (let i = 0; i < keys.length; i++) {
    quickBarApplyOne(tsum, keys[i] as SettingKey, pending[keys[i]], true);
  }
  logInfo(Log.QuickBar.PendingApplied, 'Settings held back for the round now starting are on',
    { settings: keys.join(' ') });
}

/**
 * Says on screen that a change is waiting, because nothing else would.
 *
 * The strip and the panel both draw the new value the moment it is picked --
 * that is what `quickBarAsked` is for -- so without a word the round carrying
 * on under the old skill looks like the pick having been dropped.
 */
function quickBarSayHeldBack(tsum: Tsum, held: number): void {
  if (held <= 0) {
    return;
  }
  tsum.banner(held === 1 ? 'Applies at the next round'
    : held + ' settings apply at the next round', 3500);
}

/**
 * The between-rounds delay, and the rest already running under the old one.
 *
 * The rest is re-based rather than left alone. It began at a known instant --
 * `nextRoundAt` less the delay it was set with -- so changing the delay while
 * one is running can mean what the strip says it means: ten minutes cut to six
 * with five gone has one to go, and cut to zero it is over. Clamped to now
 * rather than to 0, so the play loop still reports the rest ending instead of
 * finding it silently gone.
 */
function quickBarSetRoundDelay(tsum: Tsum, delayMs: number): void {
  if (tsum.nextRoundAt !== 0) {
    const endsAt = (tsum.nextRoundAt - tsum.roundDelayMs) + delayMs;
    tsum.nextRoundAt = Math.max(endsAt, Date.now());
  }
  tsum.roundDelayMs = delayMs;
}

/**
 * Adds or removes one chore's job on the running scheduler.
 *
 * The spec comes from `runTaskTable` with the change applied, so the interval
 * and priority are the ones a fresh start would register -- and a run the table
 * gives no such job (the walkthrough recorder) gets none. A job already there
 * is left alone rather than re-registered, which would make it due at once.
 */
function quickBarSyncJob(tsum: Tsum, name: TaskName, key: SettingKey, on: boolean): void {
  const controller = gTaskController;
  // A workflow run has no chore jobs: its nodes call the chores.
  if (controller === undefined || gWorkflowRun) {
    return;
  }
  if (!on) {
    controller.removeTask(name);
    return;
  }
  if (controller.tasks[name] !== undefined) {
    return;
  }
  const settings: RunSettings = {};
  for (const k in tsum.settings) {
    settings[k as SettingKey] = tsum.settings[k as SettingKey];
  }
  settings[key] = true;
  const jobs = runTaskTable(settings);
  for (let i = 0; i < jobs.length; i++) {
    if (jobs[i].name === name) {
      controller.register(jobs[i], taskBody(tsum, name));
    }
  }
}

function quickBarClamp(value: string | number | boolean, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!isFinite(n)) {
    return min;
  }
  return n < min ? min : (n > max ? max : n);
}

/**
 * Called by the host once the pause has taken effect, and gated in for it.
 *
 * Presses the game's own Pause button when a round is running, so the round's
 * clock stops with the script rather than draining while the Quick Bar is open.
 * `peek` rather than `detect`: a broadcast here would hand the frozen play loop
 * a page it never looked at, and `dismiss.resumeGame` would queue a Continue on
 * the pause menu this is about to open.
 *
 * The string comes back to the host's log, so say what was decided either way --
 * and a round already sitting on its own pause menu is one of the answers, not a
 * case of not being in a round at all.
 */
function onPause(): string {
  if (!quickBarRunning()) {
    return 'no run';
  }
  const t = ts!;
  t.pauses++;
  t.pausedAt = Date.now();
  // A round with its clock running counts even when the game is not in front
  // (the front watch pauses then): it comes back on the pause menu.
  t.pausedInRound = t.roundStartedAt !== 0;
  // The code this pause froze resumes with a plan for the board as it was, so
  // nothing touches the board until a look sees it back (`boardHeld`).
  t.boardHeld = t.pausedInRound;
  // Behind another app (the front watch's pause) the screen is that app's:
  // nothing on it is the game's to read or press.
  if (!t.gameInFront()) {
    return 'the game is behind another app';
  }
  const def = gPages.peek(1, 0);
  if (def === null) {
    return 'nothing recognised on screen';
  }
  if (def.name === PageName.GamePause) {
    t.pausedInRound = true;
    t.boardHeld = true;
    return 'the round is already paused';
  }
  if (def.name !== PageName.GamePlaying) {
    return 'not in a round (' + def.name + ')';
  }
  t.pausedInRound = true;
  t.boardHeld = true;
  // `back` and `next` are both the round's Pause button -- see PageRoutes in
  // data.ts, which declares the GamePlaying -> GamePause edge it presses.
  t.tapButton(def.back);
  logInfo(Log.QuickBar.PausedRound, 'Paused the round so the Quick Bar can be used');
  return 'paused the round';
}

/**
 * Longest wait for the round to be back, Continue presses included. A game
 * coming back from behind another app can show stale or black frames for a few
 * seconds first. Bounded because the host runs this on its front-watch thread.
 */
const ResumeRoundWaitMs = 6000;
/**
 * How long the board must hold before it counts as back. The first frames after
 * a return can be the board from before the pause, with the menu still to come;
 * it also covers the game's count-in after Continue.
 */
const ResumeBoardHoldMs = 600;
/** Continue still up this long after a press: the press was missed. */
const ResumeRepressMs = 1500;
const ResumePollMs = 100;

/**
 * Called by the host before the pause lifts, and gated in for it.
 *
 * Puts back the round `onPause` paused: waits for the game to redraw, presses
 * Continue (again if a press is missed), and waits for the board to hold. Also
 * credits the paused time to the round's clock so Max Round Duration does not
 * count it. A round it cannot confirm stays held (`boardHeld`): the play loop
 * then only looks until it sees the board. The string goes to the host log.
 */
function onResume(): string {
  if (!quickBarRunning()) {
    return 'no run';
  }
  const t = ts!;
  const pausedMs = t.pausedAt > 0 ? Date.now() - t.pausedAt : 0;
  t.pausedAt = 0;
  if (t.roundStartedAt !== 0) {
    t.roundStartedAt += pausedMs;
  }
  if (!t.pausedInRound) {
    return 'not in a round';
  }
  const startedAt = Date.now();
  let presses = 0;
  let pressedAt = 0;
  let boardSince = 0;
  let back = false;
  let def: PageDef | null = null;
  while (t.isRunning && Date.now() - startedAt < ResumeRoundWaitMs) {
    def = gPages.peek(1, 0);
    const now = Date.now();
    if (def !== null && def.name === PageName.GamePause) {
      boardSince = 0;
      if (presses === 0 || now - pressedAt >= ResumeRepressMs) {
        // `next` is Continue -- the menu's only exit (PageRoutes, data.ts).
        t.tapButton(def.next);
        presses++;
        pressedAt = now;
      }
    } else if (def !== null && def.name === PageName.GamePlaying) {
      if (boardSince === 0) {
        boardSince = now;
      } else if (now - boardSince >= ResumeBoardHoldMs) {
        back = true;
        break;
      }
    } else if (def !== null && isRoundOverPage(def.name)) {
      // Ended while away: the play loop's look sees it out.
      break;
    } else {
      boardSince = 0;
    }
    t.sleep(ResumePollMs);
  }
  const detail = { presses: presses, pausedMs: pausedMs, ms: Date.now() - startedAt,
    page: def === null ? '' : def.name };
  if (!back) {
    logWarn(Log.QuickBar.ResumeFailed, detail);
    return 'pressed Continue ' + presses + 'x, board not back; holding it until it is';
  }
  t.boardHeld = false;
  logInfo(Log.QuickBar.ResumedRound, detail);
  return presses > 0 ? 'pressed Continue, round back' : 'round back';
}
