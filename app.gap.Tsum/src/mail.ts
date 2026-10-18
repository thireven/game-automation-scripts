// ---------------------------------------------------------------------------
// The mailbox: the gifts the game hands out, taken all at once or one at a time.
//
// `taskReceiveAllItems` presses Claim All. `taskReceiveOneItem` walks the list
// instead, which is what a player keeping their rubies -- or skipping the
// Mission Clear medals -- needs.
//
// The list only ever gives up the row a tap lands on, so Skip Medals and Skip
// Ruby are `readMailRows` plus `mailRowToOpen`: the rows are *found* on the
// frame -- each Check button is one unbroken run of gold down a column that
// misses the lettering -- and reported as the offset every `outReceive*` probe
// moves by to reach one, so a list that came to rest between rows still reads.
// A screenful of nothing but skipped mail is scrolled past, and the list
// refusing to move is the end of the mail.
//
// Every heart taken here is counted into `ts.record`, which hearts.ts owns.
// ---------------------------------------------------------------------------

/** Budget for one panel of the receive-all choreography to arrive or leave. */
const ReceiveAllSettleMs = 3000;

Tsum.prototype.taskReceiveAllItems = function() {
  if (roundInProgress()) {
    return;
  }
  logInfo(Log.Page.Friends);
  // The mailbox is a navigation destination rather than a tap-and-hope: the hop
  // that used to be `navigate(FriendPage)` + `tap(outReceive)` + `sleep(3500)`
  // is `nav.move.toMail` plus the MailBox plan, so arriving is confirmed by the
  // fingerprint instead of assumed from a sleep. The taps below this line are
  // still open-loop -- the receive-all confirmation and the results panel have
  // no corpus frames yet, so they have no entries to navigate to.
  gPages.navigate(PageName.MailBox);
  logInfo(Log.Gifts.ReceiveAll);
  // Open-loop taps, so each one has to be given the panel it is aimed at. These
  // were rests of 2500/2000/1500ms; as budgets they end when the panel does,
  // which is a different number of milliseconds on a device drawing at 60fps.
  this.tap(Button.outReceiveAll);
  this.settleScreen(ReceiveAllSettleMs);
  this.fetchAllMails();
  this.settleScreen(ReceiveAllSettleMs);
  this.tap(Button.outReceiveClose);
  this.settleScreen(ReceiveAllSettleMs);
  this.tap(Button.outClose);
  gPages.navigate(PageName.FriendPage);
  logInfo(Log.Gifts.AllReceived);
}

Tsum.prototype.fetchAllMails = function() {
  const intlOkButton = Button.outReceiveOk;
  const jpOkButton = Button.outReceiveAllOkJP;

  const img = this.screenshot();

  try {
    if (this.isOnScreenshot(img, intlOkButton, 35)) {
      this.tap(intlOkButton);
    } else if (this.isOnScreenshot(img, jpOkButton, 35)) {
      // check important previous buttons before pressing OK
      if (this.keepRuby && this.isOnScreenshot(img, Button.outReceiveAllRubiesEnabledJP)) {
        this.tap(Button.outReceiveAllRubiesEnabledJP);
        this.sleep(500);
      }
      if (this.isOnScreenshot(img, Button.outReceiveAllHeartsDisabledJP)) {
        this.tap(Button.outReceiveAllHeartsDisabledJP);
        this.sleep(500);
      }
      this.tap(jpOkButton);
    } else {
      logError(Log.Gifts.NoOkButton, 'No OK button found on the receive-all screen');
      this.exitUnknownPage();
    }
  } finally {
    releaseImage(img);
  }
}

/** `mailRowToOpen`: nothing on screen that a tap could open. */
const MailNoRow = -100000;
/** `mailRowToOpen`: rows on screen, every one of them skipped. Scroll. */
const MailAllSkipped = -200000;

/** A badge a row is stepped past for, and the debug line that says so. */
type MailSkip = { badge: ColorProbe; event: Log.Gifts };

Tsum.prototype.readMailRows = function(img) {
  const col = MailList.buttonColumn;
  const points: Coord[] = [];
  for (let y = col.fromY; y <= col.toY; y += col.step) {
    points.push({x: col.x, y: y});
  }
  const read = this.getColors(img, points);
  // Where the first row sits when the list is at home, so a row is reported as
  // the offset every `outReceive*` probe has to be moved by to reach it.
  const home = Button.outReceiveOne.y + MailList.buttonCentreDy;
  const rows: number[] = [];
  let from = -1;
  for (let i = 0; i <= points.length; i++) {
    if (i < points.length && isSameColor(Button.outReceiveOne.color, read[i], 35)) {
      if (from < 0) { from = points[i].y; }
      continue;
    }
    if (from < 0) { continue; }
    const to = points[i - 1].y;
    // A run against either end of the scan is a row the viewport cuts in half,
    // and its midpoint is not its button's centre -- so it is not a row here.
    const clipped = from <= points[0].y || to >= points[points.length - 1].y;
    if (!clipped && to - from >= MailList.minButtonRun) {
      rows.push((from + to) / 2 - home);
    }
    from = -1;
  }
  return rows;
}

Tsum.prototype.mailRowToOpen = function(img) {
  const rows = this.readMailRows(img);
  // The ad is always stepped past; each switch adds the badge it steps past too.
  // Every row is read at all of them.
  const skips: MailSkip[] = [
    {badge: Button.outReceiveOneAd, event: Log.Gifts.ReceiveOneSkipAd},
  ];
  if (this.skipMedals) {
    skips.push({badge: Button.outReceiveOneMedal, event: Log.Gifts.ReceiveOneSkipMedal});
  }
  if (this.keepRuby) {
    skips.push({badge: Button.outReceiveOneRuby, event: Log.Gifts.ReceiveOneSkipRuby});
  }
  // Every probe a row is judged by hangs below its Check button, the ad's gift
  // box lowest of all. So the last row of a scrolled screen can show its button
  // whole with those still under the Claim All bar, and a badge read off the
  // bar is no badge -- that row is left for the next scroll to bring up whole.
  const deepestProbe = Math.max(Button.outReceiveOneMedal.y,
    Button.outReceiveOneRuby.y, Button.outReceiveOneAd.y);
  let underBar = false;
  const wanted: number[] = [];
  const points: Coord[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (deepestProbe + rows[i] > MailList.buttonColumn.toY) {
      logDebug(Log.Gifts.ReceiveOneRowUnderBar, {offset: rows[i]});
      underBar = true;
      continue;
    }
    wanted.push(rows[i]);
    for (let j = 0; j < skips.length; j++) {
      points.push({x: skips[j].badge.x, y: skips[j].badge.y + rows[i]});
    }
  }
  if (wanted.length === 0) {
    return underBar ? MailAllSkipped : MailNoRow;
  }
  const badges = this.getColors(img, points);
  for (let i = 0; i < wanted.length; i++) {
    let skipped = false;
    for (let j = 0; j < skips.length && !skipped; j++) {
      skipped = isSameColor(skips[j].badge.color, badges[i * skips.length + j], 35);
      if (skipped) { logDebug(skips[j].event, {offset: wanted[i]}); }
    }
    if (!skipped) {
      return wanted[i];
    }
  }
  return MailAllSkipped;
}

Tsum.prototype.scrollMailList = function() {
  const moved = this.dragList(MailList.scroll.x, MailList.scroll.path,
    MailList.scroll.settleMs, MailList.sample);
  logDebug(Log.Gifts.MailScrolled,
    {moved: moved, needed: MailList.sample.minMoved});
  return moved >= MailList.sample.minMoved;
}

/**
 * Budgets for the gift dialog to open after Check, and for Received! and the
 * list's shuffle up to finish after OK. The game crashes in its own asset
 * loading on MuMu (ARM translation) when taps land mid-animation, so each gift
 * is let settle instead of being tapped through at the 200ms poll.
 */
const ReceiveOneOpenSettleMs = 1500;
const ReceiveOneDoneSettleMs = 2000;
/** Times one run relaunches a game that died mid-mail before giving up. */
const ReceiveOneMaxRelaunches = 3;
/**
 * The game's memory grows with every gift, and on a small emulator the crash
 * follows the low-memory warning (2 min at 4 GB, 3 at 6 GB). So free memory is
 * read every few gifts and the game restarted before it runs that low.
 * Provisional: tune from the `gifts.receiveOne.freeMemory` lines in users' logs.
 */
const ReceiveOneMemCheckGifts = 10;
const ReceiveOneMinFreeMb = 600;

/** Budget for the mailbox to arrive after its button, before the loop looks anyway. */
const ReceiveOneMailOpenMs = 2000;

/**
 * Tap the mailbox open from the friend page and wait for it to be up and still.
 * Upstream slept a flat second either side; the friend page's own arrival has
 * already settled, and the mailbox fingerprint is the arrival here. It matches
 * mid-slide, so a settle follows -- a look at a half-open mailbox would take
 * the loop's blind close tap.
 */
function receiveOneOpenMail(ts: Tsum): void {
  ts.tap(Button.outReceive);
  const deadline = Date.now() + ReceiveOneMailOpenMs;
  while (ts.isRunning && Date.now() < deadline) {
    if (gPages.matches(PageName.MailBox)) {
      ts.settleScreen(ReceiveOneOpenSettleMs, 0);
      return;
    }
    ts.sleep(100);
  }
}

/**
 * A tsum box from the mail ends on the store's reveal card ("GET!", the tsum,
 * Close). Its fingerprint minus the foot probe, which the Quick Bar covers.
 * Not `ClosePage`: that one-pixel catch-all passes on the mailbox itself.
 */
const MailTsumCardProbes = Page.BoxPurchasedPage.colors.filter(c => c.y < 1800);

function isMailTsumCard(ts: Tsum, img: NativeImage): boolean {
  const read = ts.getColors(img, MailTsumCardProbes);
  return MailTsumCardProbes.every((c, i) => isSameColor(c, read[i], 35));
}

/** The device's available memory in MB, or null when it cannot be read. */
function memAvailableMb(): number | null {
  const m = /^MemAvailable:\s+(\d+) kB/m.exec(readFile('/proc/meminfo'));
  return m ? Math.round(Number(m[1]) / 1024) : null;
}

Tsum.prototype.taskReceiveOneItem = function() {
  if (roundInProgress()) {
    return;
  }
  logInfo(Log.Page.Friends);
  gPages.navigate(PageName.FriendPage);
  logInfo(Log.Gifts.ReceiveOneByOne);
  receiveOneOpenMail(this);

  let receivedCount = 0;
  let receiveCheckLimit = 1;

  // A gift has been taken and its OK not yet counted. Cleared once the heart
  // is tallied, so an OK the loop sees twice cannot count twice.
  let pickedUp = false;
  let receiveTime = Date.now();
  let timeoutCounter = 0;
  const maxTimeoutCount = 100;
  let receivedHeartWithoutCoins = 0;
  // `mailScrolls` is the budget for looking past a run of skipped mail, and it
  // is refilled by every gift that does get taken.
  let mailScrolls = 0;
  let relaunches = 0;
  let giftsSinceMemCheck = 0;
  // From the friend page back into the mail, with the loop's state reset.
  const reopenMail = () => {
    receiveOneOpenMail(this);
    pickedUp = false;
    mailScrolls = 0;
    timeoutCounter = 0;
    receiveTime = Date.now();
  };
  while (this.isRunning && timeoutCounter < maxTimeoutCount) {
    if (this.yieldAsked) {
      // A level-cap sweep asked for from the settings page goes first. Close
      // the gift screen as the idle exit below does; the sweep navigates from
      // wherever that leaves the game.
      logInfo(Log.Unlock.NowYielded, { task: 'receiveOneItem' });
      this.tap(Button.outClose);
      break;
    }
    if (!this.isAppOn()) {
      // The game crashed under the loop. Left alone, the home screen reads as
      // "not idle" and the loop taps blindly until its counter runs out.
      if (relaunches >= ReceiveOneMaxRelaunches) {
        logWarn(Log.Gifts.ReceiveOneRelaunchLimit, 'The game keeps closing; leaving the mail for now',
          { relaunches: relaunches, receivedCount: receivedCount });
        break;
      }
      relaunches++;
      logWarn(Log.Gifts.ReceiveOneRelaunch, 'The game closed while receiving mail; relaunching',
        { relaunches: relaunches, max: ReceiveOneMaxRelaunches });
      // `navigate` relaunches the game and gets past its start-up screens.
      gPages.navigate(PageName.FriendPage);
      reopenMail();
      continue;
    }
    let img = this.screenshot();
    // Declared outside the try so the if-chain below can read them after the
    // screenshot is released.
    let isItem: boolean, isNonItem: boolean,
        isOk: boolean, isOk2: boolean, isTimeout: boolean, isHeartWithoutCoins: boolean,
        isTsumCard = false;
    // How far from the first mail row this turn works, in screen pixels. Only
    // a skipped row (the ad, a medal, a ruby) ever moves it, and `MailNoRow` / `MailAllSkipped` are
    // the two answers that are not an offset at all.
    let rowOffset = 0;
    try {
      // Four distinct points, one crossing. `outReceiveOne` is compared against
      // two different expected colours (an item vs. nothing), so it is sampled
      // once and tested twice rather than read twice.
      const p = this.getColors(img, [
        Button.outReceiveOne,
        Button.outReceiveOk,
        Button.outReceiveItemSetOk,
        Button.outReceiveTimeout
      ]);
      isItem = isSameColor(Button.outReceiveOne.color, p[0], 35);
      isNonItem = isSameColor(Button.outReceiveOne.color2, p[0], 35);
      isOk = isSameColor(Button.outReceiveOk.color, p[1], 35);
      isOk2 = isSameColor(Button.outReceiveItemSetOk.color, p[2], 35);
      isTimeout = isSameColor(Button.outReceiveTimeout.color, p[3], 35);
      // Both page checks read `img` rather than capturing again, so every
      // reading in a pass describes the same frame.
      isHeartWithoutCoins = gPages.matches(PageName.ReceiveHeartWithoutCoins, img);
      // The scan may only run with the mail list in front of it: a gift dialog
      // has gold buttons of its own, and a row found on one would aim the tap
      // at it. `isItem` is that proof -- a dialog never shows gold there --
      // and otherwise it is asked for: a scrolled list, or the ad's top row,
      // whose film icon sits where `outReceiveOne` reads gold.
      if (isItem || gPages.matches(PageName.MailBox, img)) {
        rowOffset = this.mailRowToOpen(img);
        if (rowOffset === MailNoRow) {
          // Whatever the fixed probe read, there is no row under it to open.
          isItem = false;
        } else if (rowOffset !== MailAllSkipped) {
          isItem = true;
          isNonItem = false;
        }
      }
      // Only read when nothing else did: it is the rare screen.
      if (!isItem && !isOk && !isOk2 && !isTimeout) {
        isTsumCard = isMailTsumCard(this, img);
      }
      logDebug(Log.Gifts.ReceiveOneProbe, {
        isItem: isItem, isNonItem: isNonItem, isOk: isOk, isTsumCard: isTsumCard,
        isTimeout: isTimeout, rowOffset: rowOffset, timeoutCounter: timeoutCounter,
      });
    } finally {
      releaseImage(img);
    }
    if (rowOffset === MailAllSkipped) {
      // Every row on screen is the ad, a medal or a ruby being kept -- but the hearts
      // under them are out of sight, not gone. Scroll on and look again; the
      // list refusing to move is what says the mail has actually run out.
      if (mailScrolls < MailList.maxScrolls && this.scrollMailList()) {
        mailScrolls++;
        timeoutCounter = 0;
        receiveTime = Date.now();
        continue;
      }
      logInfo(Log.Gifts.ReceiveOneSkippedOnly,
        { receivedCount: receivedCount, scrolls: mailScrolls });
      this.tap(Button.outClose);
      gPages.navigate(PageName.FriendPage);
      break;
    }
    if (isItem) {
      if (receivedHeartWithoutCoins > 2) {
        if (receivedCount <= 5 + receivedHeartWithoutCoins) {
          this.sleep(2000);
          logDebug(Log.Gifts.ReceiveOneReceiveAll, { receivedCount: receivedCount });
          this.taskReceiveAllItems();
          this.tap(Button.outReceive);
          this.sleep(1500);
        }
        logDebug(Log.Gifts.ReceiveOneClosing,
          { receivedHeartWithoutCoins: receivedHeartWithoutCoins });
        this.tap(Button.outClose);
        receivedHeartWithoutCoins = 0;
        this.tap(Button.outClose);
        gPages.navigate(PageName.FriendPage);
        this.sleep(500);
        receivedCount = 0;
        pickedUp = true;
        timeoutCounter = 0;
        logInfo(Log.Gifts.CheckUnreceived, { reason: 'heartsWithoutCoins' });
        this.sleep(500);
        this.tap(Button.outReceive);
        this.sleep(1500);
      } else {
        // The ad or a ruby being kept never gets here: `mailRowToOpen` stepped past it.
        pickedUp = true;
        this.tap({x: Button.outReceiveOne.x, y: Button.outReceiveOne.y + rowOffset});
        this.settleScreen(ReceiveOneOpenSettleMs);
        timeoutCounter = 0;
      }
    } else if (isTimeout) {
      logDebug(Log.Gifts.ReceiveOneTimeout);
      logInfo(Log.Gifts.ReceiveAgain);
      this.tap(Button.outReceiveOk);
      this.sleep(1000);
      timeoutCounter = 0;
    } else if (isOk || isOk2) {
      this.sleep(100);
      if (isOk) {
        logDebug(Log.Gifts.ReceiveOneOk, { button: 'outReceiveOk' })
        this.tap(Button.outReceiveOk);
      } else {
        logDebug(Log.Gifts.ReceiveOneOk, { button: 'outReceiveItemSetOk' })
        this.tap(Button.outReceiveItemSetOk);
      }
      this.settleScreen(ReceiveOneDoneSettleMs);
      if (pickedUp) {
        this.record[RecordKey.HeartsCount]!.receivedCount++;
        receivedCount++;
        // The scroll budget is per run of medals, not per pass: a mailbox that
        // alternates medals and hearts is making progress every time one lands.
        mailScrolls = 0;
        this.saveRecord();
      }
      pickedUp = false;
      timeoutCounter = 0;
      if (this.claimAllWithoutCoins &&  isHeartWithoutCoins)
        receivedHeartWithoutCoins++;
      // A restart stops and relaunches the game, so it needs Auto launch.
      if (this.autoLaunch && ++giftsSinceMemCheck >= ReceiveOneMemCheckGifts) {
        giftsSinceMemCheck = 0;
        const freeMb = memAvailableMb();
        logInfo(Log.Gifts.ReceiveOneFreeMemory, 'Free memory check', { freeMb: freeMb, minMb: ReceiveOneMinFreeMb });
        if (freeMb !== null && freeMb < ReceiveOneMinFreeMb) {
          logInfo(Log.Gifts.ReceiveOneLowMemory, 'Memory is low; restarting the game before it crashes',
            { freeMb: freeMb, minMb: ReceiveOneMinFreeMb });
          // Navigates to the friend page at both ends.
          this.taskTsumAppRestart();
          reopenMail();
          continue;
        }
      }
    } else if (isTsumCard) {
      // The gift dialog's Close spot below lands mid-card and does nothing.
      logDebug(Log.Gifts.ReceiveOneTsumCard);
      this.tap(Page.BoxPurchasedPage.back);
      this.settleScreen(ReceiveOneDoneSettleMs);
      timeoutCounter = 0;
    } else {
      logDebug(Log.Gifts.ReceiveOneFetchedAllSoFar);
      this.tap(Button.outReceiveClose); // usual close button
    }
    this.sleep(200);

    if (!isNonItem) {
      receiveTime = Date.now();
    }

    if (Date.now() - receiveTime > 3000) {
      logDebug(Log.Gifts.ReceiveOneIdle, { idleMs: Date.now() - receiveTime });
      this.tap(Button.outClose);
      gPages.navigate(PageName.FriendPage);
      this.sleep(500);
      if (receivedCount === 0 || receiveCheckLimit >= this.receiveCheckLimit) {
        logInfo(Log.Gifts.Completed, {
          receivedCount: receivedCount,
          checks: receiveCheckLimit,
          checkLimit: this.receiveCheckLimit,
        });
        break;
      } else {
        receiveCheckLimit++;
        receivedCount = 0;
        pickedUp = true;
        timeoutCounter = 0;
        logInfo(Log.Gifts.CheckUnreceived, { reason: 'nextCheckCycle', checks: receiveCheckLimit });
        this.sleep(500);
        this.tap(Button.outReceive);
        this.sleep(1500);
      }
    }
    timeoutCounter++;
    if (timeoutCounter % 10 === 0) {
      logInfo(Log.Gifts.ReceiveOneWaiting, 'Still waiting on the gift screen',
        { timeoutCounter: timeoutCounter, maxTimeoutCount: maxTimeoutCount });
    }
  }
  if (maxTimeoutCount <= timeoutCounter) {
    // we seem to be trapped, try to exit the trap
    logWarn(Log.Gifts.ReceiveOneStuck, 'Stuck on the gift screen; trying to exit',
      { timeoutCounter: timeoutCounter, maxTimeoutCount: maxTimeoutCount });
    this.exitUnknownPage();
    this.sleep(1000);
    if (gPages.detect() === PageName.Unknown) {
      // last attempt
      logWarn(Log.Gifts.ReceiveOneStuckRetry, 'Still stuck; last attempt to exit');
      this.exitUnknownPage();
      this.sleep(1000);
    }
  }
}
