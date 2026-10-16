// ---------------------------------------------------------------------------
// Sending hearts.
//
// The flow the game draws, and nothing else:
//
//   FriendPage   tap a pink heart in the right-hand column
//   GiftHeart    OK
//   HeartSent    the "Heart sent!" toast. It waits for a tap rather than
//                clearing itself, and the friend list is still underneath, so
//                one tap both acknowledges the send and puts us back on the list
//
// A row that has had its heart turns dark blue, so the column scan is its own
// progress check: send, rescan, repeat until the screenful has none left, then
// scroll and repeat until a drag stops changing anything. Then Home and back --
// which reopens the ranking at our own row -- and the same sweep upwards.
//
// This replaced an earlier loop that tracked four fixed row positions and read
// four hand-measured pixels to decide it had reached the end of the list. The
// end is now the point where the list will not move, and the rows are wherever
// the pink is.
//
// A slow connection puts a "Loading" spinner over the list, which blocks input
// and can end in a timeout dialog. So a send whose row is still pink is waited
// on, the dialog gets Retry, and a drag that did not move is tried again before
// it counts as the end of the list.
//
// The running total lives at the bottom of this file: `readRecord` /
// `saveRecord` are `hearts.json`, which counts hearts sent from here
// and hearts received in mail.ts.
// ---------------------------------------------------------------------------

// Measured on a debug run with a screen recording beside it: the game takes
// ~0.4s to open the gift dialog after the heart tap, ~0.45s to close it after
// OK and ~0.8s more before the toast, which goes the frame after its tap. The
// waits below poll for each of those rather than settling after every tap --
// three settles were ~0.6s a heart of watching a screen that had already
// stopped.

/** Between looks while a step waits for its next screen. A capture is 2-15ms. */
const HeartPollMs = 60;
/** Budget for the gift dialog the heart tap opens. */
const HeartDialogMs = 4000;
/** Budget, from OK, for the toast that confirms the send. */
const HeartToastMs = 5000;
/** Budget for the toast to go once tapped, before tapping it again. */
const HeartToastGoneMs = 800;
/** Toast taps one dismissal may make. */
const HeartToastPresses = 2;
/** Budget for a toast to turn up late after a send that showed none. */
const HeartLateToastMs = 1000;
/** Column runs this close together are the same row read twice. */
const HeartRowTolerance = 60;
/** Hearts one screenful can yield before something is wrong. Four rows fit. */
const HeartPageMaxSends = 8;
/**
 * Budget for a dialog or toast that has just fingerprinted to finish fading in.
 * Both fingerprint mid-fade, and a tap then is swallowed. A `settleScreen`
 * budget with no lead, so it usually costs one or two polls.
 */
const HeartStepSettleMs = 1500;
/**
 * OK presses one send may make.
 *
 * A tap the game never saw leaves the gift dialog exactly where it was, and the
 * toast wait then spends its whole budget watching it -- four seconds, and the
 * heart lost. Pressing again costs a few polls; not pressing costs the heart.
 * Measured at ~1% of taps, and the host's own `TAP_HOLD_MS` is the cause, so
 * this is the belt to that fix's braces rather than a replacement for it.
 */
const HeartOkPresses = 3;
/**
 * Least time from the gift dialog fingerprinting to pressing OK. The dialog
 * reads still ~70ms after it appears but ignores OK for a while longer: at
 * ~80ms 8 of 21 presses were lost, at ~650ms from the heart tap none of 103.
 */
const HeartDialogReadyMs = 230;
/**
 * Time from OK the gift dialog is given to close before the press counts as
 * lost. A press that landed closes it in ~0.3s, so the rest is slack for a
 * slow device.
 */
const HeartOkLostMs = 800;
/**
 * Time from OK before a blue row with no toast counts as sent. The row turns
 * blue just before the toast arrives (~1.3s after OK), so trusting it sooner
 * leaves a late toast over the list.
 */
const HeartNoToastMs = 2000;
/**
 * Screenfuls one direction may travel. A backstop, not a limit: a ranking runs
 * to a few hundred friends and a screenful is four of them, so this only fires
 * if something keeps reading as movement when the list is not moving.
 */
const HeartSweepMaxScreenfuls = 300;
/**
 * Extra wait for a send the game is still working on: OK landed, the list is
 * back and the row is still pink. On a slow connection a "Loading" spinner sits
 * over the list here for 10s or more, ending in the toast or the timeout dialog.
 */
const HeartSlowNetworkMs = 15000;
/** Retry presses one wait may make on the game's network error dialog. */
const HeartNetworkRetries = 3;
/**
 * Pause before a drag that went nowhere is tried again. The loading spinner
 * blocks input, so a list it froze reads exactly like the end of the list.
 */
const HeartListEndRecheckMs = 3000;
/** Rechecks a list end gets; more when that screenful had a send fail. */
const HeartListEndRechecks = 1;
const HeartListEndRechecksAfterFailure = 3;

/**
 * Reopen the ranking, which puts our own row back in view.
 *
 * Home and back rather than a scroll: the list is rebuilt, so this is the one
 * position the sweep can start from without knowing how far it has travelled.
 */
Tsum.prototype.friendPageGoToSelf = function() {
  logDebug(Log.Hearts.GoToSelfStart);
  gPages.navigate(PageName.ProfilePage);
  gPages.navigate(PageName.FriendPage);
  // Upstream's, and still wanted: on an emulator the pointer parks where it
  // last tapped, and the score row below is read by colour.
  tap(0, 0, 20, TapHoldMs);
  this.sleep(1000);
  logDebug(Log.Hearts.GoToSelfDone);
}

Tsum.prototype.readHeartColumn = function(img) {
  const points: Point[] = [];
  for (let y = HeartColumn.fromY; y <= HeartColumn.toY; y += HeartColumn.step) {
    points.push({x: HeartColumn.x, y: y});
  }
  const scan = this.getColors(img, points);

  const hearts: Point[] = [];
  let start = -1;
  // One past the end, so a run reaching the bottom of the viewport is closed.
  for (let i = 0; i <= scan.length; i++) {
    const pink = i < scan.length
        && isSameColor(HeartColumn.color, scan[i], HeartColumn.threshold);
    if (pink) {
      if (start < 0) {
        start = i;
      }
      continue;
    }
    if (start >= 0) {
      const top = points[start].y;
      const bottom = points[i - 1].y;
      if (bottom - top + HeartColumn.step >= HeartColumn.minRun) {
        hearts.push({x: HeartColumn.x, y: Math.floor((top + bottom) / 2)});
      }
      start = -1;
    }
  }
  const self = this;
  traceMarks('hearts.column', function() {
    return hearts.map(function(h) {
      const p = self.toRealXY(h.x, h.y);
      return { x: p.x, y: p.y, r: 24, t: 'heart' };
    });
  });
  return hearts;
}

Tsum.prototype.friendRowScoreIsZero = function(img, heart) {
  const y = heart.y + HeartColumn.scoreOffsetY;
  const points: Point[] = [];
  for (let x = Button.outFriendScoreFrom.x; x <= Button.outFriendScoreTo.x; x += 20) {
    points.push({x: x, y: y});
  }
  const row = this.getColors(img, points);
  // A zero score is one narrow digit, so this band is empty panel all the way
  // across; any real score puts a glyph somewhere in it.
  for (let i = 0; i < row.length; i++) {
    if (!isSameColor(Button.outFriendScoreFrom.color!, row[i], 40)) {
      return false;
    }
  }
  return true;
}

/** Whether the list is showing and `heart`'s row has gone from pink to sent. */
Tsum.prototype.heartRowSent = function(heart) {
  const img = this.screenshot();
  let ys: number[];
  try {
    ys = this.readHeartColumn(img).map(h => h.y);
  } finally {
    releaseImage(img);
  }
  return !heartRefused(ys, heart);
}

/**
 * Poll the narrowed page set until `want` shows up, and say where it stopped.
 *
 * One capture a look, `HeartPollMs` apart, for up to `maxMs`; `0` looks once.
 * `abortOn` ends the wait early on a screen whose presence makes waiting
 * pointless -- the gift dialog still up after OK -- but only from
 * `HeartOkLostMs` on. So does `sentRow`, from `HeartNoToastMs` on: the list
 * back with that row no longer pink means the heart went out with no toast to
 * wait for. The page it ends on is the answer, so a caller can tell "the screen
 * never moved" from "it moved and the one I wanted never came".
 *
 * The game's network error dialog is answered with Retry, and the wait starts
 * over: the game is sending again. After `HeartNetworkRetries` it gives up and
 * sets `heartNetworkDown`.
 */
Tsum.prototype.waitForHeartPage = function(want, maxMs, abortOn, sentRow) {
  let startedAt = Date.now();
  let page = PageName.Unknown;
  let previous = PageName.Unknown;
  let retries = 0;
  while (this.isRunning) {
    previous = page;
    page = gPages.detect(1, 0, heartSweepPages());
    const elapsed = Date.now() - startedAt;
    if (page === want) {
      return page;
    }
    if (isNetworkErrorPage(page) && previous === page) {
      if (retries >= HeartNetworkRetries) {
        heartNetworkDown = true;
        return page;
      }
      retries++;
      this.retryNetworkError(page, want);
      startedAt = Date.now();
      page = PageName.Unknown;
      continue;
    }
    if (abortOn !== undefined && page === abortOn && elapsed >= HeartOkLostMs) {
      return page;
    }
    if (sentRow !== undefined && page === PageName.FriendPage && elapsed >= HeartNoToastMs
        && this.heartRowSent(sentRow)) {
      return page;
    }
    if (elapsed >= maxMs) {
      return page;
    }
    // The tap opened the friend's card instead of the gift dialog. Acted on
    // only when two looks agree, since a fading toast or dialog can read as
    // another page for a frame; settled, so the next look does not tap the
    // closing card again.
    if (page === PageName.FriendInfo && previous === PageName.FriendInfo) {
      this.tap(Page.FriendInfo.back);
      this.settleScreen(HeartStepSettleMs);
    }
    this.sleep(HeartPollMs);
  }
  return page;
}

function isNetworkErrorPage(page: PageName): boolean {
  return page === PageName.NetworkTimeout || page === PageName.NetworkDisable;
}

/** Press Retry on the network error dialog; never its other button, which goes to the title screen. */
Tsum.prototype.retryNetworkError = function(page, waitingFor) {
  logInfo(Log.Hearts.NetworkRetry, 'Connection error; pressing Retry', {page: page, waitingFor: waitingFor});
  this.settleScreen(HeartStepSettleMs, 0, HeartPollMs);
  this.tap(page === PageName.NetworkTimeout ? Page.NetworkTimeout.back : Page.NetworkDisable.back);
  this.settleScreen(HeartStepSettleMs);
}

/**
 * Wait `ms` for whatever froze the list to end, answering a network error
 * dialog if one comes up meanwhile.
 */
Tsum.prototype.waitOutHeartNetwork = function(ms) {
  const until = Date.now() + ms;
  while (this.isRunning && Date.now() < until) {
    const page = gPages.detect(1, 0, heartSweepPages());
    if (isNetworkErrorPage(page)) {
      this.retryNetworkError(page, PageName.FriendPage);
    }
    this.sleep(250);
  }
}

/**
 * Set by a send counted off its blue row: its toast may still turn up, and
 * `sendHeartsOnPage` gives it time to before leaving the screenful.
 */
let heartToastMayBeLate = false;

/**
 * Set when Retry on the network error dialog has stopped helping. The sweep
 * stops there rather than fail every heart left and call the frozen list its end.
 */
let heartNetworkDown = false;

Tsum.prototype.sendOneHeart = function(heart) {
  this.tap(heart);
  if (this.waitForHeartPage(PageName.GiftHeart, HeartDialogMs) !== PageName.GiftHeart) {
    logDebug(Log.Hearts.SendStep, {step: 'noGiftDialog', y: heart.y});
    return false;
  }
  const shownAt = Date.now();
  this.settleScreen(HeartStepSettleMs, 0, HeartPollMs);
  this.sleepUntil(shownAt + HeartDialogReadyMs);

  let page = PageName.Unknown;
  for (let press = 1; press <= HeartOkPresses; press++) {
    this.tap(Page.GiftHeart.next);  // OK
    page = this.waitForHeartPage(
      PageName.HeartSent, HeartToastMs, PageName.GiftHeart, heart);
    // Only the dialog still being up is worth another press. A wait that ran
    // out anywhere else means the press landed and it is the toast that went
    // missing -- and OK's coordinate on the friend list below is a friend's row.
    if (page !== PageName.GiftHeart) {
      break;
    }
    logDebug(Log.Hearts.SendStep, {step: 'okLost', y: heart.y, press: press});
  }

  if (page === PageName.FriendPage && !this.heartRowSent(heart)) {
    // OK landed but the row is still pink: the game is still sending, behind
    // its loading spinner. Giving up here loses a heart that lands moments later.
    logDebug(Log.Hearts.SendStep, {step: 'slowNetwork', y: heart.y});
    page = this.waitForHeartPage(PageName.HeartSent, HeartSlowNetworkMs, undefined, heart);
  }
  if (page === PageName.FriendPage && this.heartRowSent(heart)) {
    // No toast, but the row has turned blue, which is the game's own record of
    // the send. ~6% of sends on BlueStacks, each of which used to wait out the
    // whole toast budget and go uncounted.
    logDebug(Log.Hearts.SendStep, {step: 'sentNoToast', y: heart.y});
    heartToastMayBeLate = true;
    return true;
  }
  if (page !== PageName.HeartSent) {
    // The heart may well have gone out; without the toast or the row turning
    // blue nothing says so, and counting it would be counting a guess.
    logWarn(Log.Hearts.NoToast, 'Pressed OK but never saw the confirmation',
      {y: heart.y, stoppedOn: page});
    return false;
  }
  this.dismissHeartToast();
  return true;
}

Tsum.prototype.dismissHeartToast = function() {
  this.settleScreen(HeartStepSettleMs, 0, HeartPollMs);
  for (let press = 1; press <= HeartToastPresses; press++) {
    this.tap(Page.HeartSent.back);
    // The toast goes in a frame and the list under it is already still, so
    // the list fingerprinting again is the whole wait.
    if (this.waitForHeartPage(PageName.FriendPage, HeartToastGoneMs) !== PageName.HeartSent) {
      return;
    }
    // Only a toast still showing earns a second tap: its spot on the bare
    // list is a friend's row.
    logDebug(Log.Hearts.SendStep, {step: 'toastLost', press: press});
  }
}

/** Whether this run is one the sender has already tried and failed to send. */
function heartRefused(refused: number[], heart: Point): boolean {
  for (let i = 0; i < refused.length; i++) {
    if (Math.abs(refused[i] - heart.y) < HeartRowTolerance) {
      return true;
    }
  }
  return false;
}

Tsum.prototype.sendHeartsOnPage = function(stopAtZeroScore) {
  const result: HeartPageResult = {sent: 0, failed: 0, zeroScore: false, networkDown: false};
  // Rows that would not send. Without them a stuck button is found by every
  // rescan and the loop never ends.
  const refused: number[] = [];
  let toastChecked = false;

  // `mayContinue`: a level-cap sweep asked for from the settings page takes the
  // screen at the next heart rather than the next screenful.
  while (this.mayContinue() && result.sent < HeartPageMaxSends) {
    const img = this.screenshot();
    let hearts: Point[];
    let zero = false;
    try {
      hearts = this.readHeartColumn(img);
      if (stopAtZeroScore && hearts.length !== 0) {
        zero = this.friendRowScoreIsZero(img, hearts[0]);
      }
    } finally {
      releaseImage(img);
    }
    if (zero) {
      result.zeroScore = true;
      return result;
    }

    let next: Point | null = null;
    for (let i = 0; i < hearts.length; i++) {
      if (!heartRefused(refused, hearts[i])) {
        next = hearts[i];
        break;
      }
    }
    if (next === null) {
      // A toast over the list dims it, so the scan reads empty: one that turned
      // up after a no-toast send, or one a lost tap left. Clear it and rescan
      // rather than scroll past pink rows. Only a no-toast send is worth
      // waiting on; otherwise one look says whether a toast is up.
      if (result.sent !== 0 && !toastChecked) {
        toastChecked = true;
        const wait = heartToastMayBeLate ? HeartLateToastMs : 0;
        heartToastMayBeLate = false;
        if (this.waitForHeartPage(PageName.HeartSent, wait) === PageName.HeartSent) {
          logDebug(Log.Hearts.SendStep, {step: 'lateToast'});
          this.dismissHeartToast();
          continue;
        }
      }
      return result;
    }

    logDebug(Log.Hearts.SendAttempt, {y: next.y, onPage: hearts.length});
    if (this.sendOneHeart(next)) {
      result.sent++;
      this.record[RecordKey.HeartsCount]!.sentCount++;
    } else {
      result.failed++;
      if (heartNetworkDown) {
        result.networkDown = true;
        return result;
      }
      refused.push(next.y);
      // Whatever the failed send left up, the next scan has to read the list.
      gPages.navigate(PageName.FriendPage);
    }
  }
  return result;
}

Tsum.prototype.scrollFriendList = function(down) {
  const moved = this.dragList(HeartScrollPath.x,
    down ? HeartScrollPath.down : HeartScrollPath.up,
    HeartScrollPath.settleMs, FriendListSample);
  logDebug(Log.Hearts.Scrolled,
    {down: down, moved: moved, needed: FriendListSample.minMoved});
  return moved >= FriendListSample.minMoved;
}

/**
 * Give a drag that went nowhere another go before calling it the end of the
 * list. The loading spinner blocks input, so a list it froze does not move
 * either; one recheck costs a few seconds per half at the real end.
 */
Tsum.prototype.friendListMovesAfterAll = function(down, sendFailed) {
  const tries = sendFailed ? HeartListEndRechecksAfterFailure : HeartListEndRechecks;
  for (let attempt = 1; attempt <= tries && this.isRunning; attempt++) {
    this.waitOutHeartNetwork(HeartListEndRecheckMs);
    if (this.scrollFriendList(down)) {
      logInfo(Log.Hearts.ListEndRecheck, 'The list moved on a second try', {down: down, attempt: attempt});
      return true;
    }
  }
  return false;
}

Tsum.prototype.outOfHeartTime = function(startTime) {
  if (this.sendHeartMaxDuring === 0) {
    return false;
  }
  const elapsed = Date.now() - startTime;
  if (elapsed <= this.sendHeartMaxDuring) {
    return false;
  }
  logInfo(Log.Hearts.TimeUp, {elapsedMs: elapsed, budgetMs: this.sendHeartMaxDuring});
  return true;
}

Tsum.prototype.sweepHearts = function(down, startTime) {
  let screenfuls = 0;
  while (this.isRunning) {
    if (gPages.detect(1, 500, heartSweepPages()) !== PageName.FriendPage) {
      gPages.navigate(PageName.FriendPage);
      if (!this.isRunning) {
        return false;
      }
    }

    // The zero-score stop is for the downward half only: everything above us in
    // the ranking outscores us by definition.
    const page = this.sendHeartsOnPage(down && !this.sentToZero);
    screenfuls++;
    if (page.sent !== 0) {
      logInfo(Log.Hearts.Screenful, {down: down, sent: page.sent, screenfuls: screenfuls});
      this.saveRecord();
    } else {
      logDebug(Log.Hearts.Screenful, {down: down, sent: 0, screenfuls: screenfuls});
    }
    if (page.zeroScore) {
      logInfo(Log.Hearts.ZeroScore, {screenfuls: screenfuls});
      return true;
    }
    if (page.networkDown) {
      // Unfinished: the list is frozen, not ended, so the next run tries again.
      logWarn(Log.Hearts.NetworkDown, 'Retry keeps failing; stopping the heart sweep for now',
        {down: down, screenfuls: screenfuls});
      return false;
    }
    if (this.yieldAsked) {
      // Unfinished, like running out of time: the next run carries on from
      // here, since `sendHeartsDownwards` survives between runs.
      logInfo(Log.Unlock.NowYielded, {task: 'sendHearts', screenfuls: screenfuls});
      return false;
    }
    if (this.outOfHeartTime(startTime)) {
      return false;
    }
    if (!this.scrollFriendList(down) && !this.friendListMovesAfterAll(down, page.failed !== 0)) {
      logInfo(Log.Hearts.ListEnd, {down: down, screenfuls: screenfuls});
      return true;
    }
    if (screenfuls >= HeartSweepMaxScreenfuls) {
      logWarn(Log.Hearts.SweepTooLong, 'The list keeps moving; ending this half anyway',
        {down: down, screenfuls: screenfuls});
      return true;
    }
  }
  return false;
}

Tsum.prototype.taskSendHearts = function() {
  if (roundInProgress()) {
    return;
  }
  logInfo(Log.Page.Friends);
  gPages.navigate(PageName.FriendPage);
  logInfo(Log.Hearts.SendStart);

  const startTime = Date.now();
  heartNetworkDown = false;
  // With no budget every run is a whole sweep, so it starts from our own row
  // rather than wherever the last one left the list -- which is what the
  // setting's "0 starts from the first place every time" means. With a budget
  // the list is left where the time ran out and the next run carries on from
  // there, so `sendHeartsDownwards` has to survive between runs.
  if (this.sendHeartMaxDuring === 0) {
    this.sendHeartsDownwards = true;
    this.friendPageGoToSelf();
  }

  while (this.isRunning) {
    if (!this.sweepHearts(this.sendHeartsDownwards, startTime)) {
      logDebug(Log.Hearts.SendTaskUnfinished, {downwards: this.sendHeartsDownwards});
      return;
    }
    if (!this.sendHeartsDownwards) {
      // Both halves done; the next run starts downwards again.
      this.sendHeartsDownwards = true;
      break;
    }
    // The turn is the one step of the sweep with no yield point in it: the
    // upward half must start from our own row, and reopening the ranking is two
    // navigations. `sweepHearts` hands back at the next screenful but returns
    // *true* at the end of a half, so a sweep queued from the settings page used
    // to wait out the whole round trip. Handing back before the flip costs the
    // next run one screenful at the list's end and nothing else -- the anchor
    // still happens, on the other side of the wait.
    if (!this.mayContinue()) {
      logInfo(Log.Unlock.NowYielded, {task: 'sendHearts', at: 'halfTurn'});
      return;
    }
    this.sendHeartsDownwards = false;
    this.friendPageGoToSelf();
  }
  logInfo(Log.Hearts.SendDone);
}

// `hearts.json` holds one thing: how many hearts this account has
// received and sent. Read once by `buildRun` and rewritten by `saveRecord`
// after every heart that lands, so the running total in the hearts log lines
// survives a restart instead of starting from zero every run.
Tsum.prototype.readRecord = function() {
  logInfo(Log.Hearts.ReadRecords);
  const recordFile = this.devicePath + '/hearts.json';
  const txt = readFile(recordFile);
  if (txt !== undefined && txt !== "") {
    this.record = JSON.parse(txt);
  }
}

Tsum.prototype.saveRecord = function() {
  logInfo(Log.Hearts.SaveRecords);
  const recordFile = this.devicePath + '/hearts.json';
  writeFile(recordFile, JSON.stringify(this.record));
}
