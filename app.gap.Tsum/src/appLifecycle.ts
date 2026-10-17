// ---------------------------------------------------------------------------
// The game app: whether it is in front, getting it there, and bouncing it.
//
// `isAppOn` is the reading, cached only when positive; `startApp` and
// `forceRestartApp` are the two ways the script changes the answer, and the two
// `await*` waits either side of a restart watch focus and the first fingerprint
// rather than a clock.
//
// The game is two packages, one per build (`GameBuild`). The Game Region
// setting can pick one (`chosenBuild`); on Automatic `gameBuild` works it out:
// the one in front, else the one last seen in front, else the one installed.
// That is what `startApp` launches, the restarts stop, and `selectedTsum` names
// a tsum by.
//
// `taskTsumAppRestart` is the scheduled bounce and navigates to a known screen
// at both ends. `forceRestartApp` deliberately does not -- it is the recovery
// path the navigation loops themselves call (dialogs.ts), and navigating from
// inside one would recurse back into it.
// ---------------------------------------------------------------------------

/**
 * How long a positive focus check is trusted for.
 *
 * `PageRouter.navigate` asks this once per pass round its loop, and every pass
 * also takes a screenshot and scores the whole page table -- so the question was
 * costing a process spawn and a full `dumpsys window` parse at roughly the rate
 * the script can act at all. Three seconds is far shorter than anything that
 * legitimately moves the game out of focus, and the waits that watch the game
 * leave and come back (`awaitAppOff`, `awaitAppUp`) start by clearing it.
 */
const AppOnCacheMs = 3000;

/**
 * Whether the game is the focused app.
 *
 * Only the *positive* answer is cached. A negative one sends the caller into
 * `startApp()`, which changes the very thing being measured, so it is always
 * re-read; and both `startApp` and `forceRestartApp` clear the cache anyway, so
 * a stale "yes" cannot survive the script bouncing the app itself.
 */
Tsum.prototype.isAppOn = function() {
  if (!this.autoLaunch) {
    return true;
  }
  if (this._appOnCheckedAt !== 0 && Date.now() - this._appOnCheckedAt < AppOnCacheMs) {
    return true;
  }
  // A "cannot tell" leaves `_appOnCheckedAt` alone, which is what keeps it
  // from being remembered as an answer.
  const packageName = focusedPackage();
  if (packageName === null) {
    return false;
  }
  // The focus line has just been paid for, so `gameBuild` need not read it again.
  const build = buildOfPackage(packageName);
  if (build !== null) {
    this._gameBuild = build;
  }
  // With a build chosen, the other one in front counts as off, so it is
  // replaced by the chosen one.
  const isOn = this.chosenBuild !== null
    ? packageName === GamePackages[this.chosenBuild]
    : packageName.indexOf('LGTMTM') !== -1;
  this._appOnCheckedAt = isOn ? Date.now() : 0;
  return isOn;
};

/** An Android package name; the misread below (`mCurrentFocus=null`) is not one. */
const PackageNamePattern = /^[A-Za-z]\w*(\.\w+)+$/;
/** The `pkg/Activity` inside a `Window{...}` or `ActivityRecord{...}`. */
const FocusComponentPattern = /\s([\w.]+)\/[\w.$]+/;

/**
 * The package of the focused window, or null when the host cannot say.
 * `isAppOn` asks whether it is the game, `focusedGameBuild` which build of it.
 */
function focusedPackage(): string | null {
  const app = foregroundApp();
  if (app !== null && PackageNamePattern.test(app.package)) {
    return app.package;
  }
  // GAP hosts before 3.3 (alpha: 4.0) read only the first `mCurrentFocus` line, and a dump
  // has one per display: MuMu on Android 15 puts a `null` one first, which
  // came back as the package `mCurrentFocus=null`. Read them all here instead.
  return focusedPackageInDump(execute('dumpsys window'));
}

/**
 * The focused package in a `dumpsys window` dump: the first `mCurrentFocus`
 * that names an app, else the first `mFocusedApp` (a system window such as the
 * notification shade can hold focus over the game).
 */
function focusedPackageInDump(dump: string): string | null {
  const lines = dump.split('\n');
  const keys = ['mCurrentFocus=', 'mFocusedApp='];
  for (const key of keys) {
    for (const line of lines) {
      const at = line.indexOf(key);
      if (at === -1) {
        continue;
      }
      const match = FocusComponentPattern.exec(line.substring(at + key.length));
      if (match !== null) {
        return match[1];
      }
    }
  }
  return null;
}

/** GAP's own package: its panel or Quick Bar holding focus leaves the game in front. */
const HostPackage = 'com.generalautomation.platform';

/**
 * Whether the game has focus, read now and whatever Auto launch says. The play
 * loop asks this when the board stops showing, to tell a lost focus from an
 * animation. "Cannot tell" answers yes: that is the old behaviour.
 */
Tsum.prototype.gameInFront = function() {
  const packageName = focusedPackage();
  return packageName === null || packageName === HostPackage
    || buildOfPackage(packageName) !== null;
};

/** Whether the game's process is alive; false when the shell cannot say. */
function gameRunning(build: GameBuild): boolean {
  try {
    return execute('pidof ' + GamePackages[build]).trim() !== '';
  } catch (e) {
    return false;
  }
}

/** Which build of the game is in front, or null when neither is. */
function focusedGameBuild(): GameBuild | null {
  const packageName = focusedPackage();
  return packageName === null ? null : buildOfPackage(packageName);
}

/**
 * Forget the cached focus answer.
 *
 * Called wherever the script itself moves the game in or out of focus, so the
 * next `isAppOn()` goes and looks instead of repeating what was true before.
 */
Tsum.prototype.invalidateAppOn = function() {
  this._appOnCheckedAt = 0;
};

/** The package each build of the game installs as. */
const GamePackages: {[build in GameBuild]: string} = {
  [GameBuild.Global]: 'com.linecorp.LGTMTMG',
  [GameBuild.Japan]: 'com.linecorp.LGTMTM',
};

function buildOfPackage(packageName: string): GameBuild | null {
  if (packageName === GamePackages[GameBuild.Japan]) {
    return GameBuild.Japan;
  }
  if (packageName === GamePackages[GameBuild.Global]) {
    return GameBuild.Global;
  }
  return null;
}

/**
 * The builds the device has installed. `pm path` prints the APK's `package:`
 * line for an installed package and nothing for an unknown one.
 */
function installedGameBuilds(): GameBuild[] {
  const builds: GameBuild[] = [GameBuild.Global, GameBuild.Japan];
  const installed: GameBuild[] = [];
  for (let i = 0; i < builds.length; i++) {
    if (isInstalled(GamePackages[builds[i]])) {
      installed.push(builds[i]);
    }
  }
  return installed;
}

/**
 * The build the Game Region setting picks, or null for Automatic. A chosen
 * build that is not installed is ignored with a warning, since launching it
 * could never succeed. Read once per run, by `buildRun`.
 */
function chosenGameBuild(region: GameRegion | undefined): GameBuild | null {
  if (region !== GameRegion.Global && region !== GameRegion.Japan) {
    return null;
  }
  const build = region as string as GameBuild;
  if (!isInstalled(GamePackages[build])) {
    logWarn(Log.App.ChosenBuildMissing,
      'The game region chosen is not installed; picking one automatically', { build: build });
    return null;
  }
  return build;
}

/**
 * Which build of the game this device plays.
 *
 * The Game Region setting settles it when it names one. Otherwise the one in
 * front does. With neither in front -- before the first launch, or after a
 * force-stop -- the build last seen in front stands, and failing that the one
 * installed. Both installed (a region switcher) or, more
 * oddly, neither answers global, which is what the script always assumed
 * before it looked. The answer is remembered, so the installed-package read
 * happens at most once a run.
 */
Tsum.prototype.gameBuild = function() {
  if (this.chosenBuild !== null) {
    return this.chosenBuild;
  }
  const focused = focusedGameBuild();
  if (focused !== null) {
    this._gameBuild = focused;
    return focused;
  }
  if (this._gameBuild !== null) {
    return this._gameBuild;
  }
  const installed = installedGameBuilds();
  const build = installed.length === 1 ? installed[0] : GameBuild.Global;
  logInfo(Log.App.Build, 'Game build read off the installed packages',
    { build: build, installed: installed });
  this._gameBuild = build;
  return build;
};

/** The game's own activity, not its launcher entry: it starts on the title screen. */
const GameActivity = 'com.linecorp.LGTMTM.TsumTsum';

// The host composes the command now (`launchApp`, GAP's DeviceHost), including
// the single-top flag that keeps a relaunch from stacking a second copy. It
// also owns what used to be the trap here: a hardcoded `BOOTCLASSPATH=` prefix
// in front of the java-backed commands, which `uiautomator` reads and *aborts*
// on when stale -- quietly disabling the dialog path's view hierarchy.
function startTsumTsumApp(build: GameBuild): void {
  launchApp(GamePackages[build], GameActivity);
}

/** Budget for a launched game to be in front and on a screen the table knows. */
const AppUpWaitMs = 30000;
/** Between looks while it comes up. */
const AppUpPollMs = 500;
/** Budget for a force-stopped game to leave the foreground. */
const AppOffWaitMs = 3000;
/** Between focus checks while it goes. */
const AppOffPollMs = 250;

Tsum.prototype.startApp = function() {
  if (!this.autoLaunch) {
    return;
  }
  logInfo(Log.App.Start);
  this.invalidateAppOn();
  const build = this.gameBuild();
  // A game still running comes back where it was (mid-round: its pause menu),
  // so it is no boot, and the boot phase's TAP TO START taps would land on it.
  // A game that did restart shows its title, and `observe.startupPhase` starts
  // the phase from there.
  if (gameRunning(build)) {
    logInfo(Log.App.Resumed, 'The game is still running; bringing it back to the front');
  } else {
    this.beginBoot();
  }
  startTsumTsumApp(build);
  this.awaitAppUp();
  logInfo(Log.App.Started, 'TsumTsum app starting');
}

/**
 * Wait for the launched game to be in front and showing a screen the table
 * knows, and say whether it is.
 *
 * This was `sleep(10000)`: right for the slowest cold start it was measured
 * against and paid in full on every faster one. Focus is asked first because a
 * splash fingerprints as nothing, and `isAppOn`'s negative answer is never
 * cached; then a look, because focus arrives well before the first screen does.
 * The screen it finds is whatever the game opens on -- the root warning, a logo
 * or the title screen -- and leaving it is the navigation loop's job.
 *
 * False means the budget ran out, or the run stopped; the caller carries on
 * exactly as it did after the flat rest.
 */
Tsum.prototype.awaitAppUp = function() {
  const startedAt = Date.now();
  const deadline = startedAt + AppUpWaitMs;
  let looks = 0;
  while (this.isRunning && Date.now() < deadline) {
    if (this.isAppOn()) {
      const page = gPages.peek(1, 0);
      looks++;
      if (page !== null) {
        logDebug(Log.App.Up, { ms: Date.now() - startedAt, looks: looks, page: page.name });
        return true;
      }
    }
    this.sleep(AppUpPollMs);
  }
  logWarn(Log.App.UpTimeout, 'The game did not reach a known screen after launch',
    { waitedMs: Date.now() - startedAt, looks: looks, stopped: !this.isRunning });
  return false;
}

/**
 * Wait for a force-stopped game to leave the foreground, and say whether it did.
 * The focus cache is cleared before every check: a "yes" cached seconds ago is
 * the one answer this must not be given.
 */
Tsum.prototype.awaitAppOff = function() {
  if (!this.autoLaunch) {
    // `isAppOn` answers yes unasked without Auto launch, so there is nothing to
    // watch; this is the one blind rest left on the path.
    this.sleep(AppOffWaitMs);
    return false;
  }
  const startedAt = Date.now();
  const deadline = startedAt + AppOffWaitMs;
  while (this.isRunning) {
    this.invalidateAppOn();
    if (!this.isAppOn()) {
      logDebug(Log.App.Off, { ms: Date.now() - startedAt });
      return true;
    }
    if (Date.now() >= deadline) {
      break;
    }
    this.sleep(AppOffPollMs);
  }
  logWarn(Log.App.OffTimeout, 'The game was still in front after force-stop',
    { waitedMs: Date.now() - startedAt, stopped: !this.isRunning });
  return false;
}

// Bounce the game app. Deliberately does not navigate anywhere afterwards (that
// is taskTsumAppRestart's job) so the recovery paths inside the navigation loops
// can call it without recursing back into themselves.
Tsum.prototype.forceRestartApp = function() {
  if (!this.autoLaunch) {
    logWarn(Log.App.RestartSkipped, "Not restarting the game app: 'Auto launch app' is off");
    return false;
  }
  this.invalidateAppOn();
  stopApp(GamePackages[this.gameBuild()]);
  this.awaitAppOff();
  this.isStartupPhase = true;
  // Its own boot: a stopped process can still answer `pidof` for a moment.
  this.beginBoot();
  this.startApp();
  return true;
}

// ---------------------------------------------------------------------------
// The boot phase
//
// From a launch to the hub the game shows a fixed run of
// screens: splash, root warning, logos, the opening video, the title and its
// loading text. Each wants one of three things -- wait, TAP TO START, or
// PERMIT -- and the title art changes every month, so they are recognised by
// layout where they can be (`TitleStart`, `TitleWait`) and by this phase where
// they cannot: an unknown screen while booting gets one TAP TO START tap
// (`nav.move.bootUnknown`) instead of the blind escape, the stall guard leaves
// it alone, and the startup settle is skipped. Past the budget all of that
// lapses and unknown screens are handled as usual.
// ---------------------------------------------------------------------------

/** Launch to the hub is ~25s; this covers a slow network on "Retrieving data". */
const BootBudgetMs = 90000;

Tsum.prototype.beginBoot = function() {
  this.bootStartedAt = Date.now();
  this.bootUntil = this.bootStartedAt + BootBudgetMs;
}

Tsum.prototype.inBoot = function() {
  return Date.now() < this.bootUntil;
}

Tsum.prototype.endBoot = function(page) {
  if (this.bootStartedAt === 0) {
    return;
  }
  logInfo(Log.App.BootDone, 'The game is up', {
    ms: Date.now() - this.bootStartedAt,
    page: page,
    overBudget: !this.inBoot(),
  });
  this.bootStartedAt = 0;
  this.bootUntil = 0;
}

Tsum.prototype.tapThroughBoot = function() {
  // A root-warning variant the table misses is still a native dialog, and a
  // tap on its dimmed backdrop can cancel it -- which is REFUSE, and quits.
  if (this.dismissSystemDialog()) {
    return;
  }
  this.tap(Button.titleStart);
}

Tsum.prototype.taskTsumAppRestart = function () {
    logInfo(Log.App.RestartPreparing, 'Preparing to restart the Tsum app');
    if (!this.isAppOn()) {
        this.startApp();
    }
    gPages.navigate(PageName.FriendPage);

    logInfo(Log.App.Restarting, 'Restarting the Tsum app');
    // Inlined rather than routed through forceRestartApp(): that helper is the
    // stall-recovery path (dialogs.ts) and is a different job -- gated on "Auto
    // launch app", and always relaunches. This is a scheduled restart that
    // navigates to a known screen at both ends.
    // `awaitAppOff` clears the focus cache before every check, so the answer
    // below is never one taken while the app was still up.
    this.invalidateAppOn();
    stopApp(GamePackages[this.gameBuild()]);
    this.awaitAppOff();
    if (!this.isAppOn()) {
        this.beginBoot();
        this.startApp();
    }
    gPages.navigate(PageName.FriendPage);
    logInfo(Log.App.Restarted, 'Tsum app restarted');
}
