// ---------------------------------------------------------------------------
// Playing one round: the walk in, the loop, and proving the round is over.
//
// `taskPlayGameQuick` is the whole of it -- the between-rounds delay, the walk
// to the board, then scan, link and skill until the HUD stops answering. Two
// things make it longer than that sounds.
//
// The round is not over when the board stops fingerprinting. A burst skill's
// animation covers the same HUD pixels, so an unreadable frame is played
// through (`HudMissesBeforeGameOver`) and only a page a round can genuinely end
// on (`isRoundOverPage`) or `confirmGameOver`'s grace window ends it.
//
// And a chain the game refuses leaves the board exactly as it was, so the next
// scan plans the same chain and draws it again. The dead-scan counter sees that
// fixpoint and the Fan is what answers it -- "The stalled board" below.
//
// The board itself -- the scan, the chains, the bubbles -- is board.ts.
// ---------------------------------------------------------------------------

Tsum.prototype.checkGameItem = function() {
  // Same positions as Button.outGameItems; the two tuples share the order.
  const isItemsOn: GameItemStates = [false, false, false, false, false, false, false];
  if (this.scoreItem) {
    isItemsOn[0] = true;
  }
  if (this.coinItem) {
    isItemsOn[1] = true;
  }
  if (this.expItem) {
    isItemsOn[2] = true;
  }
  if (this.timeItem) {
    isItemsOn[3] = true;
  }
  if (this.bubbleItem) {
    isItemsOn[4] = true;
  }
  if (this.uniqueTsumCount === 4) {
    isItemsOn[5] = true;
  }
  if (this.comboItem) {
    isItemsOn[6] = true;
  }
  for(let t = 0; t < 3; t++) {
    // A dimmed frame reads every toggle as "on", so never read under a popup.
    const img = this.awaitBonusItems();
    if (img === null) {
      break;
    }
    let isChange = false;
    try {
      for (let i = 0; i < Button.outGameItems.length; i++) {
        const c = this.getColor(img, Button.outGameItems[i]);
        if (c.b > 128) { // off
          if (isItemsOn[i]) {
            this.tap(Button.outGameItems[i]);
            isChange = true;
            this.sleep(500);
          }
        } else { // on
          if (!isItemsOn[i] && this.isBonusItemLocked(img, i)) {
            // Forced on by an event: tapping it only raises a popup.
            if (t === 0) {
              logDebug(Log.Play.BonusItemLocked, { item: i });
            }
          } else if (!isItemsOn[i]) {
            this.tap(Button.outGameItems[i]);
            isChange = true;
            this.sleep(500);
          }
        }
      }
    } finally {
      releaseImage(img);
    }
    logDebug(Log.Play.BonusItemsToggled, { changed: isChange });
    if (!isChange) {
      break;
    }
    this.sleep(500);
  }
  logDebug(Log.Play.CheckBonusItems, { itemsOn: isItemsOn });
}

/** The toggle's cost pill has become the pink free-item badge. */
Tsum.prototype.isBonusItemLocked = function(img, index) {
  const c = this.getColor(img, Button.outGameItemBadges[index]);
  return c.r > 170 && c.g < 110;
}

/** How long the free-item popup gets to clear before it is tapped away. */
const BonusPopupWaitMs = 1500;

/**
 * A frame of the pre-round screen with nothing over it, or null if it does not
 * come back. The free-item popup dims the whole screen for about a second; it
 * is waited out, then tapped away once on the caption box.
 */
Tsum.prototype.awaitBonusItems = function() {
  const pages = Page as PageMap;
  for (let attempt = 0; attempt < 2; attempt++) {
    const deadline = Date.now() + BonusPopupWaitMs;
    do {
      const img = this.screenshot();
      for (const key in pages) {
        if (pages[key].name === PageName.StartPage && gPages.score(this, img, key, pages[key]).pass) {
          return img;
        }
      }
      releaseImage(img);
      this.sleep(250);
    } while (this.isRunning && Date.now() < deadline);
    if (attempt === 0) {
      logDebug(Log.Play.BonusItemsHidden, {});
      this.tap(Button.outGameItemsCaption);
    }
  }
  return null;
}

/** Budget for the pre-round screen to leave and the board to arrive, after Start. */
const RoundStartWaitMs = 5000;
/** Between looks while it does. */
const RoundStartPollMs = 100;
/** Budget for the tsums dropping into a new board to land. */
const RoundStartSettleMs = 2000;

/**
 * Wait for the round to be up after the Start tap, and say whether it is.
 *
 * This was `sleep(5000)`, and what it guarded was the next navigation pass
 * reading the pre-round screen mid-fade and running the item check and the
 * Start tap all over again. Watching for that instead: a look that no longer
 * says `StartPage` is progress, and one that says `GamePlaying` is the answer.
 * `peek`, because nothing here may act on what it sees -- the drive loop this
 * returns to is what handles a dialog that lands in the meantime.
 *
 * The board never goes still, so its arrival is its fingerprint; the tsums
 * dropping into it are then given `settleBoard`, so the first scan reads a
 * board that has landed rather than one still filling.
 *
 * False means the budget ran out with the board not seen, which is the drive
 * loop's cue to take another pass -- exactly what followed the flat rest.
 */
Tsum.prototype.awaitRoundStart = function() {
  const startedAt = Date.now();
  const deadline = startedAt + RoundStartWaitMs;
  let looks = 0;
  let left = false;
  let seen: PageName | null = null;
  while (this.isRunning && Date.now() < deadline) {
    const page = gPages.peek(1, 0);
    looks++;
    seen = page === null ? null : page.name;
    if (seen === PageName.GamePlaying) {
      logDebug(Log.Play.BoardUp, { ms: Date.now() - startedAt, looks: looks, sawLeave: left });
      this.settleBoard(RoundStartSettleMs);
      return true;
    }
    if (seen !== PageName.StartPage) {
      left = true;
    }
    this.sleep(RoundStartPollMs);
  }
  logDebug(Log.Play.BoardUpTimeout,
    { ms: Date.now() - startedAt, looks: looks, sawLeave: left,
      saw: seen === null ? 'nothing' : seen, stopped: !this.isRunning });
  return false;
}

// GamePlaying is recognized by HUD pixels on the pause/fan buttons, and a
// long burst-skill animation (e.g. Dapper Hat Mickey) covers them for longer
// than the old two-check window (~5s) while the game is still running — the
// play loop would bail mid-game and stall on the "unknown" screen. So an
// unrecognized screen alone is not proof of game over; require positive
// confirmation instead: a game that really ends always reaches a known
// out-of-game page (the score tally lands on ScorePage). Poll until the HUD
// comes back (still playing), a known page shows up (game over), or the
// grace window runs out (assume over — the old behavior, just later).
// The screens a round can actually end on.
//
// A round that really finished lands on the score tally, by way of the
// new-record panel, the post-round tsum level-up panel, the account level-up
// panel or the Magical Time offer. Nothing else in the table can follow a
// running round, so nothing else is evidence that one has ended.
//
// This list exists because "any page the table can name" was being treated as
// that evidence, and the table is not uniformly trustworthy. `ClosePage` is a
// deliberate single-pixel catch-all for the standard close button at centre
// bottom -- one positive probe at (540,1588) with threshold 80, which
// `pages:selftest` reports every run under "catch-all risk". Mid-round that
// pixel sits on the fever bar (rgb(8,191,231) on the corpus board frame), and a
// fever payout or a burst skill washing the bottom band yellow moves it to
// something ClosePage accepts. When that happened while the HUD was also
// obscured -- the same instant, since both are the same animation -- ClosePage
// was the only entry left passing, and one frame of it ended the round: the play
// loop broke out mid-game, waitForScorePage spent its fifteen seconds waiting
// for a tally that was never coming, and the round was recorded with no score
// and no coins.
//
// The half of that which has since been fixed is the HUD: `GamePlayingHudProbes`
// (data.ts) was re-measured against six captured fever frames and moves by at
// most 12 there, so the board now fingerprints through a fever and ClosePage is
// no longer the only entry passing on such a frame. What is not fixed is the
// general case -- a burst skill's full-screen animation and the mid-round
// level-up banner have never been captured -- which is why this list, and the
// narrowed sweep below, both stay.
//
// Widening ClosePage's fingerprint is the other half of this and is deliberately
// not done here: it is a navigation catch-all that answers for screens nobody
// has enumerated (events, My Info, settings), so tightening it trades this bug
// for a navigation stall. Not trusting it as proof of game over costs nothing.
//
// The play loop now also refuses to *read* ClosePage mid-round: its liveness
// check scores `inRoundPages()` instead of the whole table, so the entry is not
// a candidate there at all. The narrower question -- which of those pages mean
// the round is over -- is `roundOverPages()`: the tally and the panels before
// it, as each declares in `PageProfiles` (`PageRole.Tally`, `PageRole.PreTally`).
// The event card's screens are among them: the round ends onto its result
// overlay, which has no fingerprint (event art -- see waitForScorePage), and the
// play loop's own trailing taps can have advanced it to the event page already.
// Also the guard for confirmGameOver, which does sweep the whole table.
function isRoundOverPage(page: PageName): boolean {
  return roundOverPages().indexOf(page) !== -1;
}

// Watch until the round is proven over, or the board comes back.
//
// Nothing plays while this runs: the loop below neither scans nor taps, so
// every millisecond spent here is a millisecond of a round that may still be
// running. That is what makes the poll's cost the thing to watch -- see the
// `detect` call.
Tsum.prototype.confirmGameOver = function() {
  logInfo(Log.Play.ConfirmingGameOver, { graceMs: this.gameOverGraceMs });
  const startedAt = Date.now();
  const deadline = startedAt + this.gameOverGraceMs;
  let looks = 0;
  while (this.isRunning) {
    // One look, no retry budget. `detect`'s timeout is spent only when *nothing*
    // fingerprints -- which is this function's entire situation, since it is
    // only ever called after the board stopped fingerprinting. So the 1500ms
    // this used to ask for was never a wait for a page to arrive; it was 1.5s of
    // standing still per poll, on top of the 250ms below, while the round went
    // on running underneath. The loop's own `gameOverGraceMs` deadline is the
    // budget, and it is the only one this needs.
    //
    // Still the whole table, unlike the play loop's liveness check: a page
    // outside `inRoundPages()` cannot end the round here (`isRoundOverPage` is
    // what does that), and sweeping everything is what keeps the root-detection
    // and network guards live through a grace window that can last 20s.
    const page = gPages.detect(1, 0);
    looks++;
    if (page === PageName.GamePlaying || page === PageName.GamePause) {
      // Still playing after all. `idleMs` is what this cost the round.
      logDebug(Log.Play.HudBack, { page: page, looks: looks, idleMs: Date.now() - startedAt });
      return false;
    }
    if (isRoundOverPage(page)) {
      // A screen the round can genuinely end on. If it was the Magical Time
      // offer, `dismiss.magicalTime` has already cancelled it inside the
      // detection above -- which is the earliest point on this path that the
      // dialog can be seen, and used to be a branch here.
      logInfo(Log.Play.GameOverConfirmed, 'Game over confirmed by a round-over page',
        { page: page, looks: looks, idleMs: Date.now() - startedAt });
      return true;
    }
    // Not an ending either: the game went from the front. Wait for it, then
    // let the board look decide.
    if (this.gameAway()) {
      this.awaitGameBack();
      return false;
    }
    // Everything else -- `Unknown`, or a page the game cannot reach from a
    // running round -- is an animation or a misread, not an ending. Keep
    // polling: either the HUD comes back or the grace window runs out.
    if (Date.now() > deadline) {
      logWarn(Log.Play.GameOverAssumed,
        'Assumed game over: no recognisable screen within the grace window',
        { graceMs: this.gameOverGraceMs, lastPage: page, looks: looks,
          idleMs: Date.now() - startedAt });
      return true;
    }
    this.sleep(250);
  }
  return true;
}

// How long the play loop keeps playing through a screen it cannot read as the
// board before it starts checking for game over. Mid-round an unreadable frame
// is ordinary rather than rare -- see the liveness check at the bottom of
// taskPlayGameQuick -- and the loop plays through these rather than standing
// still while the combo timer runs down.
//
// A fever is no longer one of them. `GamePlayingHudProbes` was re-measured on
// six fever frames and moves by at most 12 against a 40 threshold, so a fever
// board fingerprints as `GamePlaying` like any other and costs no misses at
// all (OBSCURED_BOARD.md). The guard stays because the two overlays that have
// never been captured -- a burst skill's full-screen animation and the
// mid-round level-up banner -- are still unenumerated, and an overlay nobody
// has enumerated is exactly what this is for.
//
// Both bounds have to be passed, because either alone is the wrong measure. A
// scan over a board hidden by an animation finds no tsums, so it links nothing
// and comes round again in a fraction of the time a real scan takes: a count on
// its own can run out in well under a second, shorter than the animation it is
// meant to tolerate. A duration on its own would end a round that genuinely
// finished a whole grace window late, since the loop scans an empty board the
// entire time.
//
// Erring long is the cheap direction. A round that really ended lands on one of
// `roundOverPages()`, and those skip this debounce entirely -- they are recognised
// and end the round on the frame they first appear.
const HudMissesBeforeGameOver = 3;
const HudMissGraceMs = 1500;

/** The debounce above, carried between the turns that share it. */
interface HudWatch {
  /** Consecutive looks that did not fingerprint as the board. */
  misses: number;
  /** When that run of them started, epoch ms. Only read while `misses` is up. */
  firstMissAt: number;
}

/** Between the looks of a turn whose board is held (`boardIsHeld`). */
const HeldBoardPollMs = 250;
/** How often a missed board may pay for a focus read: an animation misses it many turns running. */
const FrontCheckMs = 1000;
/** Between focus reads while the game is away. */
const GameAwayPollMs = 500;
/**
 * Away this long and the script brings the game back itself (Auto launch only),
 * then again at the same interval. Long enough not to fight a quick look at
 * another app.
 */
const GameAwayRelaunchMs = 30000;

/** Whether the game has left the front, read at most once per `FrontCheckMs`. */
Tsum.prototype.gameAway = function() {
  const now = Date.now();
  if (now - this._frontCheckedAt < FrontCheckMs) {
    return false;
  }
  this._frontCheckedAt = now;
  return !this.gameInFront();
}

/**
 * Mid-round, the game is not in front. Hold the board, so nothing taps whatever
 * is showing, and wait for the game to come back -- bringing it back past
 * `GameAwayRelaunchMs`. It returns on its pause menu, which the play loop's held
 * turns press Continue on. The time away is taken off the round's clock.
 */
Tsum.prototype.awaitGameBack = function() {
  const leftAt = Date.now();
  const pauses = this.pauses;
  this.boardHeld = true;
  logWarn(Log.Play.GameAway, 'The game is not in front; holding the round until it is back');
  let relaunchAt = leftAt + GameAwayRelaunchMs;
  let relaunches = 0;
  while (this.isRunning && !this.gameInFront()) {
    if (this.autoLaunch && Date.now() >= relaunchAt) {
      relaunches++;
      logInfo(Log.Play.GameAwayRelaunch, 'The game is still not back; bringing it to the front',
        { awayMs: Date.now() - leftAt, relaunches: relaunches });
      this.startApp();
      relaunchAt = Date.now() + GameAwayRelaunchMs;
    }
    this.sleep(GameAwayPollMs);
  }
  const awayMs = Date.now() - leftAt;
  // A host pause in between has had `onResume` credit its share already.
  if (this.pauses === pauses && this.roundStartedAt !== 0) {
    this.roundStartedAt += awayMs;
  }
  logInfo(Log.Play.GameBack, 'The game is back; waiting for the board',
    { awayMs: awayMs, relaunches: relaunches });
}

/** What one liveness look says about the round. */
const enum RoundLook {
  /** The board answered. Carry on. */
  Playing,
  /**
   * A paused board, or an animation over one. Carry on, but nothing this turn's
   * scan found is evidence about the board -- neither takes a chain.
   */
  Unreadable,
  /** Over: `roundEndedAt` is stamped and `round.over` has gone out. */
  Over,
}

/** How old `useSkill`'s look may be and still answer for `watchRoundEnd`. */
const RoundLookReuseMs = 250;

/**
 * Liveness check: is the board still up?
 *
 * One look, no retry budget. `detect`'s timeout is spent only when *nothing*
 * fingerprints, so a generous one costs nothing on the yes and everything on
 * the no -- and mid-round the no is an ordinary frame, not a rare one. A
 * burst skill's full-screen animation and the mid-round level-up banner both
 * cover the HUD this is read from, and neither has an entry. Asking for
 * 2500ms here bought a stall of up to that long in which the loop neither
 * scanned nor tapped, silent in the log because a sweep that matches nothing
 * logs nothing -- and the combo timer does not survive it.
 *
 * A fever used to be the third of those and is not any more: the entries
 * this scores were re-measured off six fever frames, and a fever board now
 * answers `GamePlaying` outright (OBSCURED_BOARD.md).
 *
 * The wait is not gone, it moved: HudMissesBeforeGameOver/HudMissGraceMs
 * debounce the same thing here, where the loop plays through the animation
 * instead of watching it.
 *
 * Scored against `inRoundPages()` rather than the whole table. A running round
 * can only be looking at the board, the pause menu, or a screen it ended on,
 * so the other 48-odd entries are answers this call cannot want -- and one of
 * them, `ClosePage`, is a single-pixel catch-all sitting on the fever bar
 * that has previously been the only entry left passing over an obscured
 * board and ended the round on the spot (see `isRoundOverPage` above). It
 * cannot win here now. The branches below already treat "nothing matched" and
 * "matched something a round cannot become" the same way, so a narrowed
 * sweep that comes back empty needs no new handling.
 *
 * A method rather than the tail of the play loop because the loop is not the
 * only caller: a round the Max Round Duration cap has stopped playing still has
 * to be seen out, and it watches with exactly this.
 */
Tsum.prototype.watchRoundEnd = function(hud) {
  // The board being up is the usual answer, and `useSkill`'s look a moment ago
  // gave it already when nothing has touched the screen since -- the same
  // moment, so no second capture. Any other answer is looked at again here.
  const page = gPages.freshPage(RoundLookReuseMs) === PageName.GamePlaying
    ? PageName.GamePlaying
    : gPages.detect(1, 0, inRoundPages());
  const stillDebouncing = hud.misses < HudMissesBeforeGameOver
      || Date.now() - hud.firstMissAt < HudMissGraceMs;
  if (page === PageName.GamePlaying || page === PageName.GamePause) {
    hud.misses = 0;
    // A paused board takes no chain and every scan of one reads the same tsums
    // standing in the same places, which is the stall's signature without being
    // the stall. The pause handler is already resuming it.
    return page === PageName.GamePause ? RoundLook.Unreadable : RoundLook.Playing;
  }
  // A missed board can also be the game gone from the front: the host does not
  // pause for an overlay in the game's own task, the notification shade, or a
  // run with "pause when behind" off. Waiting it out beats the debounce below,
  // which would end the round and play on over whatever is showing.
  if (!isRoundOverPage(page) && this.gameAway()) {
    hud.misses = 0;
    this.awaitGameBack();
    return RoundLook.Unreadable;
  }
  if (!isRoundOverPage(page) && stillDebouncing) {
    // Nothing matched, or something matched that a running round cannot turn
    // into -- both of which are what an animation over the board looks like,
    // and neither of which is an ending. Keep playing.
    if (hud.misses === 0) {
      hud.firstMissAt = Date.now();
    }
    hud.misses++;
    // The scan that fed this turn looked through that animation, so what it
    // found is not evidence about whether the game took the chain.
    return RoundLook.Unreadable;
  }
  // Either a page the round can genuinely end on -- proof on its own, and so
  // not debounced at all -- or the debounce above running out.
  //
  // Stamped from the frame the HUD went away on rather than from here: the
  // round was already over then, and neither the scans spent playing through
  // the debounce nor the twenty seconds confirmGameOver is allowed to spend
  // proving it are time the round ran for.
  const endedAt = hud.misses > 0 ? hud.firstMissAt : Date.now();
  hud.misses = 0;
  // Nothing reads the coin counter here. The board is still paying out at
  // this point, so the counter is not yet showing the round's figure --
  // `record.baseCoins` waits for the level-up screen, which is the first one
  // that is certainly after the payout, and finishRoundStats' wait for the
  // score page is what polls long enough to see it.
  if (!this.confirmGameOver()) {
    // Still playing after all: the screen that looked like an ending was an
    // animation.
    return RoundLook.Playing;
  }
  this.roundEndedAt = endedAt;
  logInfo(Log.Play.GameOver, { chains: this.runTimes,
    hudLostMs: Date.now() - endedAt });
  // The board is done; the tally has not started. Not the stop signal -- that
  // is round.end, once the figures can be read.
  this.emit(Emit.Round.Over, {
    id: this.roundUid,
    round: this.roundNumber,
    seconds: Math.round((endedAt - this.roundStartedAt) / 1000),
  });
  return RoundLook.Over;
}

// --- The stalled board -------------------------------------------------------
//
// A chain the game refuses leaves the board exactly as it was, so the next scan
// reads the same board, plans the same chain and draws it again. That fixpoint
// is what `Config.linkReach`'s comment describes, and what a player watching it
// sees: the same few tsums lighting up over and over with nothing going off.
//
// Two things get a board into it, and neither is worth telling apart from
// inside the loop. Reach past what the game itself accepts proposes a hop it
// will not link; two tsums whose colours merged into one cluster (12% of
// rosters, Board Studio's measurement) put both kinds in one chain, and the
// game breaks it where the kind changes. Either way a prefix shorter than three
// links, so nothing clears.
//
// What they leave behind is the same and is free to see: the tsums the last
// drag went over are still standing. The Fan is the answer because it is the
// only move that changes the board without the game having to accept a link --
// it re-packs the pile, which is what a player does by hand to clear this.
//
// The barren board below (`zeroPath`) is a different complaint: there the loop
// finds nothing to draw, where here it draws and is refused.
/** How far a tsum may have shifted and still count as standing, in play-square px. */
const DeadScanTolerancePx = 4;
/** What share of a drawn chain still standing makes a scan a dead one. */
const DeadScanStillFraction = 0.8;
/**
 * Dead scans in a row before the Fan goes out.
 *
 * Four rather than one because a refill can drop a tsum back onto a cleared
 * spot, and because a bubble pop or a skill firing mid-batch can leave a chain
 * standing for a reason that is not a stall. None of those repeats four scans
 * running; a board the game has stopped taking links from does nothing else.
 */
const DeadScansBeforeFan = 4;
/** Budget for the fanned board to land again before it is scanned. */
const DeadScanFanSettleMs = 1200;

// --- The Max Round Duration cap ---------------------------------------------
//
// A round that will not end -- a choreography stuck on a board it cannot clear,
// a screen the router never recognised -- is the one failure the play loop
// cannot see from inside, because every part of it is behaving. The cap is the
// clock saying so from outside, and `MaxRoundAction` is what to do about it.
//
// Both options stop *playing* the round and leave the game's own timer to run
// it out; what they decide is what becomes of the script. Coasting is the
// default because it costs the least -- leaving the board alone ends the round
// within a minute or so, and the run then carries on as normal.
//
// Coasting has no time limit of its own. It used to give up after three minutes
// and hand the task back, and that undid the cap: the next pass found the board
// still up, restamped the clock and played on, so a round the person had asked
// to be left alone was played again in stretches until it ended. The only thing
// that ends a coast now is the game over screen, or the script being stopped.
//
// Neither presses the game's Pause button, and that is the point rather than an
// omission: pausing the game stops its round timer, and a round that can no
// longer time out is exactly what this is here to avoid. The game's Pause
// button has one caller and keeps it -- `onPause` (src/quickbar.ts), where a
// person has asked for the round to stop where it is.

/** Between looks while a round is coasting to its end. */
const RoundCoastPollMs = 500;
/** Between `play.roundCoasting` lines, so a long coast is visibly still alive. */
const RoundCoastHeartbeatMs = 60 * 1000;

// --- Stop after games --------------------------------------------------------
//
// Counted at the round's tail, so the last round is always seen out and a round
// abandoned by a stop never counts. Firing resets the count, so a Resume after
// `Pause` plays the same number again.

/** Anything unrecognised is AutoPlayOff: the one action that loses nothing. */
function stopAfterActionOf(value: unknown): StopAfterAction {
  return value === StopAfterAction.Pause || value === StopAfterAction.Stop
    ? value : StopAfterAction.AutoPlayOff;
}

Tsum.prototype.countGameTowardStop = function() {
  // "Stop after this round" wins over the count: the run ends either way.
  if (this.wrapUpIfAsked('roundEnd')) {
    return true;
  }
  if (this.stopAfterGames <= 0 || !this.isRunning) {
    return false;
  }
  this.gamesTowardStop++;
  if (this.gamesTowardStop < this.stopAfterGames) {
    return false;
  }
  this.gamesTowardStop = 0;
  let action = this.stopAfterAction;
  // An older host has no pauseScript; ending play is the closest safe answer.
  if (action === StopAfterAction.Pause && typeof pauseScript !== 'function') {
    action = StopAfterAction.AutoPlayOff;
  }
  logInfo(Log.Play.GamesLimitReached, { games: this.stopAfterGames,
    action: action });
  switch (action) {
    case StopAfterAction.Stop:
      this.banner('Played ' + this.stopAfterGames + ' games: stopping', 5000);
      requestStop();
      break;
    case StopAfterAction.Pause:
      this.banner('Played ' + this.stopAfterGames + ' games: pausing', 5000);
      pauseScript();
      break;
    default:
      // Only the round job goes; chores and their schedules keep running.
      this.banner('Played ' + this.stopAfterGames + ' games: Auto Play off', 5000);
      if (gTaskController !== undefined) {
        gTaskController.removeTask(TaskName.PlayRound);
      }
  }
  return true;
}

// --- Stop after this round ----------------------------------------------------
//
// A run-time flag (`wrapUpAsked`), armed by `stopAfterThisRound` (src/index.ts)
// and never saved. Checked at a round's tail, before a round starts, and by a
// one-shot job between rounds -- so a run with Auto Play off still stops.

Tsum.prototype.wrapUpIfAsked = function(at: string) {
  if (!this.wrapUpAsked || !this.isRunning) {
    return false;
  }
  this.wrapUpAsked = false;
  logInfo(Log.Play.WrapUpFired, { at: at });
  this.banner(at === 'roundEnd' ? 'Round over: stopping as asked' : 'Stopping as asked', 5000);
  notifyWrapUp(this, at === 'roundEnd');
  requestStop();
  return true;
}

Tsum.prototype.roundDelayRemainingMs = function() {
  const left = this.nextRoundAt - Date.now();
  return left > 0 ? left : 0;
}

/**
 * Open the round: mint its id, freeze the settings it is played under, and
 * announce it.
 *
 * Called from `nav.move.startToGame` in the moment between the bonus items
 * being set and Start being tapped, so a recorder starting on `round.start`
 * opens on the items the round will be played with rather than on a board that
 * is already running. `taskPlayGameQuick` calls it again once the board is up,
 * for the round that never passed that screen -- one already in play when the
 * task arrived, or a walk that reached the board another way.
 *
 * Gated on `openingRound` because the pre-round screen alone cannot tell a round
 * from click assist, which walks to the same board through the same handler and
 * closes no round afterwards. Whichever call gets here first clears the flag, so
 * the second is a no-op and one round is announced once.
 *
 * A round already open is one whose walk was cut short between the tap and the
 * board -- a level-cap sweep asking for the screen during those five seconds --
 * and the pass that picks the board up is the same round arriving late, not a
 * new one. `finishRoundStats` is what closes a round, by zeroing the clock.
 */
Tsum.prototype.openRound = function() {
  if (!this.openingRound) {
    return;
  }
  this.openingRound = false;
  if (this.roundStartedAt !== 0) {
    return;
  }
  this.beginRoundStats();
  // After beginRoundStats, so `roundUid` and `roundSettings` are this round's own.
  this.roundNumber++;
  this.emit(Emit.Round.Start, {
    // What every other round.* event of this round repeats. `round` counts this
    // device's rounds and repeats across emulators; `id` does not.
    id: this.roundUid,
    round: this.roundNumber,
    myTsum: this.myTsum,
    // The full name, as the build's (INTL/JP) library spells it; `myTsum` is the CSV's short one.
    myTsumName: this.myTsumName,
    skill: statsSkillName(this.roundSettings ? this.roundSettings.skillType : this.skillType),
    // The CSV's `build` column: INTL and JP rounds only compare with their own.
    build: this.gameBuild(),
    // What the round is played under, so a consumer can group rounds without
    // waiting for the CSV. The snapshot, so a mid-round Quick Bar change is the
    // next round's news.
    settings: statsSettingsPayload(this.roundSettings),
  });
}

Tsum.prototype.taskPlayGameQuick = function() {
  // Armed between rounds: no new round, whatever the delay says.
  if (this.wrapUpIfAsked('beforeRound')) {
    return;
  }
  // The between-rounds delay, if one is running. Held here rather than by
  // lengthening this task's interval, because an interval is a schedule nothing
  // else can see or cut short: `nextRoundAt` is what the Quick Bar's countdown
  // reads and what its Skip clears. Returning instead costs one clock read
  // every 3s and leaves the schedule alone -- the chores keep running through
  // the wait, which is the point of having one.
  const waitMs = this.roundDelayRemainingMs();
  if (waitMs > 0) {
    // One line per turn, so a wait ticking down is visible rather than looking
    // like a stalled loop. Debug-gated, and logDebug returns before building
    // anything when debug is off.
    logDebug(Log.Play.RoundDelayWaiting, { remainingMs: waitMs });
    return;
  }
  if (this.nextRoundAt !== 0) {
    this.nextRoundAt = 0;
    logInfo(Log.Play.RoundDelayOver);
  }
  // A level-cap sweep asked for from the settings page goes before a round that
  // has not started. One already on screen is still this task's to finish --
  // the sweep stood aside for it and is waiting on it. `peek`: nothing may act.
  if (this.yieldAsked) {
    const seen = gPages.peek(1, 0);
    if (seen === null
        || (seen.name !== PageName.GamePlaying && seen.name !== PageName.GamePause)) {
      logInfo(Log.Unlock.NowYielded, { task: 'playRound' });
      return;
    }
  }
  // The whistle, and the last moment a setting can still shape this round:
  // below here the walk opens the pre-round screen, which is where the bonus
  // items are chosen and where 5>4 decides how many colours the board is dealt.
  quickBarApplyPending(this);
  // Opens this round's correlation scope: every record until the next round
  // starts carries the same roundId, injected by the logger.
  logBeginRound();
  logInfo(Log.Play.GameStart);
  // This walk is a round starting, which is what lets the pre-round screen open
  // it in front of the bonus items -- see `openRound`.
  this.openingRound = true;
  // Abandoned if the sweep is asked for on the way there: the round has not
  // started, so there is nothing to finish.
  if (!gPages.navigate(PageName.GamePlaying, () => this.yieldAsked)) {
    // Whatever happens next is not this walk. A round the pre-round screen
    // already opened stays open and is closed by the pass that finds the board.
    this.openingRound = false;
    if (this.yieldAsked) {
      logInfo(Log.Unlock.NowYielded, { task: 'playRound', stage: 'navigating' });
    }
    return;
  }
  logInfo(Log.Play.GamingFast);
  // Normally a no-op: the pre-round screen opened this round a few seconds ago,
  // before it tapped Start. This is the round that never passed it.
  this.openRound();
  // The clock, restamped now the board is actually up. The round is opened
  // ahead of the tap so `round.start` lands with the items in frame, and
  // `duration_seconds` must still measure play rather than the walk in.
  this.roundStartedAt = Date.now();
  // A new round's first activation is never held by the last round's.
  this.skillActivatedAt = 0;
  // Nor its board by a hold the last round never cleared.
  this.boardHeld = false;
  // Every round starts with normal-size tsums.
  Config.boardScale = 1;
  this.boardScaleReads = [];
  this.boardScaleTrend = 0;
  this.runTimes = 0;
  // Re-resolved on the first board scan of each game: the player may have
  // changed which tsum is selected, and `identifyMyTsum` has just re-read it.
  this.myTsumColor = null;
  this.myTsumIdx = -1;
  // What this round's level-up panel says about the MyTsum's cap; nothing yet.
  this.myTsumCapSeen = false;
  this.overloadPending = false;
  // Same reasoning as `gFever.reset()` in buildRun: the transformation belongs
  // to a round, and the round that just ended has nothing to say about this one.
  lorcanaReset();
  // Bubbles the last scan saw, before any were popped: a pile this big is what
  // sets off All Bubbles ASAP's blind sweep below.
  let bubblesSeen = 0;
  let zeroPath = 0;
  // The liveness check's debounce, carried across the turns that share it.
  const hud: HudWatch = { misses: 0, firstMissAt: 0 };
  // When the Max Round Duration cap stopped playing this round, epoch ms; 0
  // while it is still being played. The loop then only watches for the end,
  // with `nextCoastBeatAt` pacing the heartbeat line. See the cap block above.
  let coastStartedAt = 0;
  let nextCoastBeatAt = 0;
  // The chain the last turn certainly drew, and how many scans running have
  // found it still standing afterwards -- the stalled-board check above. Null
  // means the last turn drew nothing, or churned the board by some other means,
  // so this scan has nothing to judge.
  let drawnChain: BoardPoint[] | null = null;
  let deadScans = 0;
  while(this.isRunning) {
    // The Max Round Duration cap. Read off `ts` each turn, which is what lets a
    // Quick Bar change land at once, and measured from `roundStartedAt` -- the
    // board coming up, not the walk in.
    if (coastStartedAt === 0 && this.maxRoundMs > 0
        && Date.now() - this.roundStartedAt >= this.maxRoundMs) {
      const stopping = this.maxRoundAction === MaxRoundAction.Stop;
      logWarn(Log.Play.RoundTimeUp, { ranMs: Date.now() - this.roundStartedAt,
        capMs: this.maxRoundMs, action: this.maxRoundAction });
      this.banner(stopping ? 'Round time up: stopping'
        : 'Round time up: letting the clock run out', 5000);
      if (stopping) {
        // Abandons the round where it stands: `roundEndedAt` is never stamped,
        // which is what has `finishRoundStats` below drop it -- the same as any
        // other mid-round stop. The game is left alone and its own timer ends
        // the round, whether or not anything is still watching.
        requestStop();
        break;
      }
      // Coast. Nothing below runs again; the round then finishes like any
      // other, so the tally, the stats and the next round all follow as usual.
      coastStartedAt = Date.now();
      nextCoastBeatAt = coastStartedAt + RoundCoastHeartbeatMs;
    }
    if (coastStartedAt !== 0) {
      // Watching, not playing: no scan, no chain, no skill. The liveness check
      // is the whole turn, and the rest is what keeps it cheap. No deadline --
      // see the cap block above -- so the heartbeat is what says this is a
      // coast still going rather than a script that has hung.
      if (Date.now() >= nextCoastBeatAt) {
        logInfo(Log.Play.RoundCoasting, { ranMs: Date.now() - this.roundStartedAt,
          coastedMs: Date.now() - coastStartedAt });
        nextCoastBeatAt = Date.now() + RoundCoastHeartbeatMs;
      }
      this.sleep(RoundCoastPollMs);
      if (this.watchRoundEnd(hud) === RoundLook.Over) {
        break;
      }
      continue;
    }
    if (this.boardIsHeld()) {
      // Back from a pause or a lost focus with the board not yet seen: look
      // only. The look presses Continue on the pause menu (`dismiss.resumeGame`)
      // and seeing the board lifts the hold (`observe.boardBack`).
      drawnChain = null;
      deadScans = 0;
      this.sleep(HeldBoardPollMs);
      if (this.watchRoundEnd(hud) === RoundLook.Over) {
        break;
      }
      continue;
    }
    let board = this.scanBoardQuick();
    if (board == null) {
      break;
    }
    // Did the last drag do anything? The chain is gone from a board that took
    // it, and standing on a board that refused it.
    if (drawnChain !== null) {
      const held = boardStillHolds(board, drawnChain, DeadScanTolerancePx);
      if (held >= drawnChain.length * DeadScanStillFraction) {
        deadScans++;
        logDebug(Log.Board.DeadScan,
          { held: held, chain: drawnChain.length, deadScans: deadScans });
      } else {
        deadScans = 0;
      }
      drawnChain = null;
    }
    if (deadScans >= DeadScansBeforeFan) {
      // Not gated on `useFan`, unlike both fans below: that setting is a
      // preference about stirring a board that is still playing, and this one
      // has stopped. `fanWouldBeWasted()` is not consulted either -- it answers
      // "the skill is nearly ready", and on a board where nothing clears the
      // gauge never fills, so asking it would refuse the rescue for as long as
      // the stall lasts, which is the whole of it.
      logWarn(Log.Board.Stalled, { deadScans: deadScans, tsums: board.length });
      this.tap(Button.fan, 60);
      this.tap(Button.fan, 60);
      deadScans = 0;
      // Re-scan rather than plan off the pre-fan capture: those positions are
      // where the tsums were before the Fan moved them. Deliberately not a
      // `continue` -- the liveness check at the bottom runs every turn round
      // this loop, and a rescue is no reason to skip one.
      this.settleBoard(DeadScanFanSettleMs);
      board = this.scanBoardQuick();
      if (board == null) {
        break;
      }
    }
    // All Bubbles ASAP: spend them where they are, before a chain can earn
    // them. The other two strategies leave the list for `link` to spend on the
    // first long chain of this batch -- less any overflow, popped now (Save
    // One: all but one).
    bubblesSeen = this.gameBubbles.length;
    if (this.bubbleStrategy === BubbleStrategy.AllAsap) {
      this.popGameBubbles();
    } else {
      this.popBubbleOverflow();
    }
    logDebug(Log.Board.PathStart);
    // The cap is the "Maximum Chain Number" setting unless the selected skill
    // overrides it (`SkillHandler.chainLimits`); the reach likewise
    // (`SkillHandler.linkReach`).
    let paths = calculatePaths(board, this.myTsumIdx, skillMyTsumPriority(this),
      skillMaxChain(this), false, skillLinkReach(this));
    // The selected skill may have an opinion about which of those to link and
    // in what order -- Formal Suit Beast keeps his two gauges level. Before the
    // cut below, so a skill choosing between colours can reach past the longest
    // chains; every other skill hands the list straight back.
    paths = skillOrderPaths(this, paths, board);
    // Each linked chain is a clear that refreshes the combo timer; the combo
    // is only at risk during the scan gap between batches. More chains per
    // scan means fewer gaps, but chains linked late in a batch can miss
    // because earlier clears already reshuffled the board. The skill may have
    // its own count here too.
    // How many chains the scan *found*, kept before the cut below: the barren
    // check further down asks whether the board has stopped producing chains,
    // and a board cut to fewer than three per scan by the skill's own
    // `chainLimits` would otherwise answer "barren" on every scan of a board
    // covered in them -- and fan the tsums away. Gaston's cut is 1.
    const foundPaths = paths.length;
    paths = paths.splice(0, skillMaxChainsPerScan(this));
    // Catch a gauge that filled during the scan/calculation above before linking.
    this.maybeAutoTapSkill(board);
    const isBubble = this.link(paths, board);
    // What the next scan judges the stall by. `paths[0]` rather than the batch:
    // it is the one chain `link` always draws, where a later one can be left
    // undrawn when a skill fires mid-batch.
    drawnChain = paths.length > 0 ? paths[0] : null;
    if (isBubble) {
      logDebug(Log.Bubble.Generated);
    }
    if (foundPaths < 3) {
      zeroPath++;
      if (zeroPath === 6) {
        // Same guard as the periodic fan below. Without it this fires the fan
        // with the skill already full, and useSkill() runs immediately after --
        // so the skill activates onto a board that is still being tossed about.
        // It also self-sustains: a churning board scans as few paths, which is
        // what increments this counter in the first place.
        //
        // Gated on `useFan` like the periodic fan below: the setting is off by
        // default, and a board that stopped producing chains is not a reason to
        // override it. Tested first so the readiness screenshot is skipped outright
        // when the fan is off.
        if (this.useFan && !this.fanWouldBeWasted()) {
          this.tap(Button.fan, 60);
          this.tap(Button.fan, 60);
          // The Fan moved everything, so the chain above says nothing about
          // whether the game took it.
          drawnChain = null;
        }
        zeroPath = 0;
      }
    } else {
      // Counts *consecutive* barren scans: a board that is producing chains is
      // not stuck, and letting the count carry over between them fires the fan
      // on a board that never needed shuffling.
      zeroPath = 0;
    }
    // Before the pile-up sweep and the fan below: both are busywork a full
    // gauge should not wait behind. A ready skill used to sit through a blind
    // sweep (and then, for a skill whose beforeActivate swept too, a second
    // one) before its activation tap went out.
    while (this.useSkill(board)) {
      // An activation clears most of what it touches, so the chain drawn above
      // is not evidence about the game refusing it either way.
      drawnChain = null;
      // A skill that ends its own choreography with a bubble sweep
      // (`sweepsBubbles`) has just cleared the pile the scan saw.
      if (skillSweepsBubbles(this.skillType)) {
        bubblesSeen = 0;
      }
      // Every Lorcana activation leaves one bubble with an ink stone inside it,
      // and tapping that bubble is what clears the stones already on the board.
      // Aimed, and now rather than at the next chain: it is the one bubble
      // hoarding cannot pay for, since leaving it means the next activation
      // adds another stone to a board that still has all of the last ones.
      // Skipped for a skill that sweeps its own bubbles -- that sweep has just
      // taken this one with it. See src/lorcana.ts.
      if (this.lorcanaCard && !gLorcana.transformed
          && !skillSweepsBubbles(this.skillType)) {
        this.popLorcanaStoneBubble();
      }
    }
    // The transformation: while the skill button is still a medallion the
    // card's spot is tapped blind, and the medallion going is the
    // transformation. Rate-limited inside, so most turns round this loop cost
    // nothing.
    this.lorcanaMaybeTapCard();
    // The pile-up sweep. Only All Bubbles ASAP wants it: it is the one
    // strategy that would rather have a bubble gone than saved, and the sweep
    // catches what the Hough pass in `scanBoardQuick` missed -- about half of
    // a packed row, which is why a pile is what sets it off. Under either
    // mid-chain strategy this is exactly the tapping that throws bubbles away,
    // so it does not run -- a skill that needs it asks for it itself
    // (`clearAllBubbles`, declared with `sweepsBubbles`).
    //
    // A standing claim silences it too, whatever the strategy says. `AllAsap`
    // is a preference about bubbles the play loop owns, and while a claim
    // stands it owns none: `bubbleTapBudget` already returns 0 for the aimed
    // pops, and a blind sweep that ignored that would spend the hoard the
    // skill's next activation is counting on -- Gaston's cancel bubble, or
    // Aurora's chain. So does the fever hold, for the same reason: it has
    // just refused the aimed pops so the bubbles are there after the fever.
    // And the (short) hold after an activation: the next scan that still sees
    // the pile sweeps it.
    if (this.bubbleStrategy === BubbleStrategy.AllAsap
        && bubblesSeen >= GameBubbleConfig.pileUpSweepAt
        && !skillClaimsBubbles(this) && !this.bubblesHeldForFever()
        && !this.bubblesHeldAfterSkill()) {
      logDebug(Log.Bubble.Cleared, { seen: bubblesSeen });
      bubblesSeen = 0;
      // A popped bubble clears the area around it, which can take the chain
      // above with it whether or not the game ever linked it.
      drawnChain = null;
      // The bottom band only: that is where piles form.
      this.clearAllBubbles(0, 0, bubbleBandTopY());
    }
    if (this.useFan && this.runTimes % 4 === 3) {
      // Skip the fan when the skill is nearly ready — the next clear will fill
      // the gauge, so the fan would just be wasted on tsums about to be
      // cleared. (A gauge already full was spent by useSkill above.)
      if (!this.fanWouldBeWasted()) {
        this.tap(Button.fan, 60);
        this.tap(Button.fan, 60);
        // Same as the barren fan above: the board this chain was drawn on is
        // gone, so it is no longer evidence of a stall.
        drawnChain = null;
      }
    }

    // Is the board still up? See `watchRoundEnd` -- it owns the debounce and,
    // on the turn the round is proven over, the stamp and `round.over`.
    const look = this.watchRoundEnd(hud);
    if (look === RoundLook.Over) {
      break;
    }
    if (look === RoundLook.Unreadable) {
      // A paused board, or an animation over one: this turn's scan proves
      // nothing about whether the game took the chain.
      drawnChain = null;
      deadScans = 0;
    }
    this.runTimes++;
  }
  // Captured first: finishRoundStats closes the round by zeroing both, and this
  // is the one figure `round.end` must carry even when it read nothing.
  const roundSeconds = this.roundStartedAt && this.roundEndedAt
    ? Math.round((this.roundEndedAt - this.roundStartedAt) / 1000)
    : 0;
  if (roundSeconds > 0) {
    this.runClock.rounds++;
    this.runClock.roundSec += roundSeconds;
    // -1 is "no round yet", so the first one sets both ends.
    if (this.runClock.minSec < 0 || roundSeconds < this.runClock.minSec) {
      this.runClock.minSec = roundSeconds;
    }
    if (roundSeconds > this.runClock.maxSec) {
      this.runClock.maxSec = roundSeconds;
    }
  }
  this.finishRoundStats();
  // The stop signal, and emitted from here rather than from inside
  // finishRoundStats: that returns early when round stats are off, and an event
  // stream must not depend on a stats setting. `lastRound` is what it managed to
  // read; null means it read nothing, and the figures go out as nulls.
  const outcome = this.lastRound;
  this.emit(Emit.Round.End, {
    // The id round.start opened with, and the id of the CSV row this round
    // writes -- so a consumer can join what it reacted to against the row that
    // gets published. `roundSettings` is still this round's: finishRoundStats
    // closes the round without clearing either.
    id: this.roundUid,
    round: this.roundNumber,
    myTsum: this.myTsum,
    // The full name, as the build's (INTL/JP) library spells it; `myTsum` is the CSV's short one.
    myTsumName: this.myTsumName,
    skill: statsSkillName(this.roundSettings ? this.roundSettings.skillType : this.skillType),
    build: this.gameBuild(),
    seconds: outcome === null ? roundSeconds : outcome.seconds,
    score: outcome === null ? null : outcome.score,
    baseCoins: outcome === null ? null : outcome.baseCoins,
    finalCoins: outcome === null ? null : outcome.finalCoins,
    medals: outcome === null ? null : outcome.medals,
    settings: statsSettingsPayload(this.roundSettings),
  });
  // Auto Unlock MyTsum Level: the level-up panel this round ended on may have
  // shown the MyTsum capped, and the raise goes here, between the round and
  // whatever comes next. Before the delay below, which measures from the game
  // being back between rounds.
  this.raiseMyTsumLevelCapIfPending();
  // Not due again at once: a pause lands at the next sleep, not the next walk.
  if (this.countGameTowardStop()) {
    return false;
  }
  // Start the wait here rather than at game over: finishRoundStats sees the
  // score screen away, so this measures from the game being back at the start
  // screen -- which is what "between rounds" means to the person who set it.
  if (this.roundDelayMs > 0) {
    this.nextRoundAt = Date.now() + this.roundDelayMs;
    const minutes = Math.round(this.roundDelayMs / 60000);
    logInfo(Log.Play.RoundDelayStarted, { delayMs: this.roundDelayMs,
      nextRoundAt: new Date(this.nextRoundAt).toISOString() });
    this.banner('Next round in ' + minutes + ' min', 4000);
  }
  // Due again at once: the job's 3s interval otherwise left the finished tally
  // sitting on screen before Play was pressed.
  return true;
}
