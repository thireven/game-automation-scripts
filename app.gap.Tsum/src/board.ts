// ---------------------------------------------------------------------------
// The board: reading it, and drawing chains on it.
//
// One scan is one capture of the play square (`scanBoardQuick`): circles from
// two Hough passes over a single shared grayscale, colour-clustered into the
// `tsumIdx` groups `calculatePaths` (pathfinding.ts) plans on. The bubbles are
// read off that same frame and remembered, which is what lets a pop after a
// chain be taps alone -- a capture in the middle of a link batch would stall the
// cadence and the combo timer with it.
//
// `link` is the other half: the batch that scan produced, drawn one chain at a
// time, with the bubble pops and the skill check that belong between them.
//
// The loop that calls both, and everything about a round beginning or ending,
// is play.ts.
// ---------------------------------------------------------------------------

Tsum.prototype.linkTsums = function(path) {
  // Whole drags only: a chain begun is finished, one not begun never starts.
  // Nor on a held board (`boardIsHeld`): it may be the pause menu by now.
  if (!this.mayTouchBoard()) { return; }
  // Drag timings (ms). Measured, not chosen: these were 30/20/20 here for a
  // while because at 10ms the game was observed to miss the initial press or
  // skip intermediate tsums, so a found 3+ chain never cleared -- and 10/10/10
  // is what it turned out to accept once the rest of the input path was right.
  // Raise all three together if that ever comes back; a chain drawn faster than
  // the game samples is `DRIVING_SCREENS.md` § 5.
  //
  // The first point is the press alone. A move to the same point after it,
  // inherited, bought nothing the game could see: an A/B on two emulators drew
  // 11-17% more chains a second without it, with no more chains registered one
  // short. Skills' own drags keep theirs; their rests are tuned.
  const grabDuring = 10;
  const releaseDuring = 10;
  // Whether to read the game's chain counter before the release, for the
  // skills that ask (`readsChainCounter`): how much of the chain the game
  // linked, logged against the plan.
  const counted = skillReadsChainCounter(this);
  const moveDuring = 10;
  const pauses = this.pauses;
  for (let j = 0; j < path.length; j++) {
    const point = path[j];
    const x = Math.floor(this.playOffsetX + (point.x + Config.tsumWidth / 2) * this.playWidth / this.playResizeWidth);
    const y = Math.floor(this.playOffsetY + (point.y + Config.tsumWidth / 2) * this.playHeight / this.playResizeHeight);
    if (j === 0) {
      tapDown(x, y, grabDuring);
    } else {
      moveTo(x, y, moveDuring);
    }
    // Paused mid-drag: the rest of the path is off a board from before it.
    if (this.pauses !== pauses) {
      tapUp(x, y, releaseDuring);
      return;
    }
    if (j === path.length - 1) {
      if (counted) {
        this.sleep(ChainCounterConfig.settleMs);
        const count = chainCounterRead(this, chainRouteCentres(path));
        logInfo(Log.Board.ChainDrawn, {
          chain: path.length, registered: count.value, dwellMs: moveDuring,
          counter: chainCountDetail(count),
        });
      }
      // Before the call, as the host stamps its `input.up` trace.
      this.dragReleasedAt = Date.now();
      tapUp(x, y, releaseDuring);
      fluxNoteChain(path, this.dragReleasedAt);
    }
  }
}

// --- Tsums still clearing ----------------------------------------------------
//
// A released chain does not leave the board at once: the game pops its tsums
// one after another, and a linked tsum waiting its turn cannot be linked again.
// We draw a 3-chain in ~40ms and the game takes most of a second to clear it,
// so at full speed a fifth to a half of the board is waiting (a scan read 13-33
// of ~45 on a recording), and a chain planned through one stops there.
//
// So every drag records what it linked here, with when each tsum should be
// gone, and a scan taken with `fluxFilter` set leaves those circles out
// (`fluxDrop`): Rapunzel+'s look after her cut-in, the moment the clears it
// froze resume. Not the play loop's scans: filtering every scan halved its
// pace (8.9 to 4.7 drags/s on a 40s trace, 207 of 362 scans finding no chain)
// while the old build's chains drew no dead scans at all, so the play loop
// was not drawing into tsums still clearing. Cinderella reads the ledger
// directly (`fluxFreeRun`). Three things move the
// times: a Fever clears faster (`feverScale`), a skill's cut-in freezes the
// board (`fluxPause`), and a bubble popped while a chain clears finishes it at
// once (`fluxCancel`, the game's "bomb cancel").
var BoardFluxConfig = {
  // Tsum k of a chain is gone `popStartMs + k * popPerTsumMs` after release,
  // and its spot stays out `landMs` more while the refill lands in it.
  // `popPerTsumMs` is Gaston's measurement (outside Fever); the other two are
  // NOT MEASURED.
  popStartMs: 150,
  popPerTsumMs: 90,
  landMs: 200,
  // Share of those times in a Fever. NOT MEASURED: the user's observation is
  // that a Fever clears faster, not by how much.
  feverScale: 0.6,
  // A skill's cut-in, during which nothing on the board moves. Cinderella's
  // measured `cutInMs`; Rapunzel+'s veil lifts at ~1.5s too.
  cutInMs: 1500,
  // A bubble pop finishes every clear in progress this soon after it.
  cancelMs: 150,
  // A scanned circle within this (tsum widths) of a spot is that spot's tsum.
  reach: 0.5,
};

/** One linked tsum still on the board: its centre in the play square, and when it is gone. */
interface FluxSpot { x: number; y: number; freeAt: number; }

var gFlux: FluxSpot[] = [];

/** Record a released chain (board points, top-left corners, in link order). */
function fluxNoteChain(path: Point[], releasedAt: number): void {
  const cfg = BoardFluxConfig;
  const scale = gFever.active ? cfg.feverScale : 1;
  const half = Config.tsumWidth / 2;
  for (let k = 0; k < path.length; k++) {
    gFlux.push({
      x: path[k].x + half,
      y: path[k].y + half,
      freeAt: releasedAt + scale * (cfg.popStartMs + k * cfg.popPerTsumMs) + cfg.landMs,
    });
  }
}

/** Record spots (centres) that stay out until `freeAt`: a skill's own clear. */
function fluxNoteSpots(centres: Point[], freeAt: number): void {
  for (let i = 0; i < centres.length; i++) {
    gFlux.push({ x: centres[i].x, y: centres[i].y, freeAt: freeAt });
  }
}

/** A skill fired at `at`: whatever was still clearing waits out its cut-in. */
function fluxPause(at: number, ms: number): void {
  for (let i = 0; i < gFlux.length; i++) {
    if (gFlux[i].freeAt > at) { gFlux[i].freeAt += ms; }
  }
}

/** A bubble popped at `at`: every clear in progress finishes now. */
function fluxCancel(at: number): void {
  const by = at + BoardFluxConfig.cancelMs;
  for (let i = 0; i < gFlux.length; i++) {
    if (gFlux[i].freeAt > by) { gFlux[i].freeAt = by; }
  }
}

/** Ms from now until `share` of the spots still clearing are gone; 0 with none. */
function fluxClearedInMs(share: number): number {
  const now = Date.now();
  const left = gFlux.filter(function(s) { return s.freeAt > now; })
    .map(function(s) { return s.freeAt - now; }).sort(function(a, b) { return a - b; });
  if (left.length === 0) { return 0; }
  return left[Math.min(left.length - 1, Math.ceil(share * left.length) - 1)];
}

/**
 * How many of `path`'s points (top-left corners), from the start, sit on no
 * spot still clearing: a chain links no further than its first blocked tsum.
 */
function fluxFreeRun(path: Point[]): number {
  const now = Date.now();
  const half = Config.tsumWidth / 2;
  const r = BoardFluxConfig.reach * Config.tsumWidth;
  const rSq = r * r;
  for (let k = 0; k < path.length; k++) {
    const c = { x: path[k].x + half, y: path[k].y + half };
    for (let i = 0; i < gFlux.length; i++) {
      if (gFlux[i].freeAt > now && getDistance(c, gFlux[i]) < rSq) { return k; }
    }
  }
  return path.length;
}

/**
 * `points` (circle centres) less those sitting on a spot still clearing.
 * Forgets the spots that have cleared.
 */
function fluxDrop<T extends Point>(points: T[]): T[] {
  const now = Date.now();
  gFlux = gFlux.filter(function(s) { return s.freeAt > now; });
  if (gFlux.length === 0) { return points; }
  const r = BoardFluxConfig.reach * Config.tsumWidth;
  const rSq = r * r;
  return points.filter(function(p) {
    for (let i = 0; i < gFlux.length; i++) {
      if (getDistance(p, gFlux[i]) < rSq) { return false; }
    }
    return true;
  });
}

// The chain length that earns a bubble, for the limits in force.
//
// `minChainForPop` is an absolute length, but the chain cap ("Maximum Chain
// Number", or the selected skill's `chainLimits`) hard-caps every path
// `calculatePaths` returns -- and the setting defaults to 3, one below the
// threshold. So the mid-chain pop could never fire at all unless the player had
// raised that setting, silently: a bubble is not a thing the log mentions when
// nothing taps it.
//
// Capping chains at 3 is choosing many short chains over a few long ones, not
// choosing never to spend a bubble. Every chain such a player links is already
// as long as their configuration can make one, and that is what earns the pop.
Tsum.prototype.bubblePopChainLength = function() {
  const limit = skillMaxChain(this);
  const cap = limit > 0 ? limit : Infinity;
  return Math.min(GameBubbleConfig.minChainForPop, cap);
};

// Whether the "Hold bubbles last fever seconds" setting is holding every bubble
// right now: a fever is running and has at most that many seconds left.
//
// A bubble popped into a chain cuts the chain's clear animation short, and
// after a fever the gauge starts from empty -- so a bubble spent on a chain in
// the fever's last seconds buys fever-bonus score once, where the same bubble
// spent on the first chains after it gets the next fever sooner.
//
// The bar is read right here, per pop, off a ~2.4ms crop: a fever the game
// has paused for a skill animation then reads as paused, where anything run
// forward by a clock would not. Asked only with the setting on, a fever
// running and bubbles to hold, so the crop is a handful of reads per fever.
// The hold lasts until `gFever` calls the fever over, which its debounce does
// a few hundred ms after the bar empties; that is at most one chain's cancel
// late.
Tsum.prototype.bubblesHeldForFever = function() {
  if (this.holdBubblesLastFeverSec <= 0 || !gFever.active) { return false; }
  const remainingMs = this.feverRemainingMs();
  if (remainingMs > this.holdBubblesLastFeverSec * 1000) { return false; }
  logDebug(Log.Bubble.Held, {
    remainingMs: remainingMs,
    bubbles: this.gameBubbles ? this.gameBubbles.length : 0
  });
  return true;
};

// The hold after a skill activation: no Bubble Strategy pop for
// `GameBubbleConfig.holdAfterSkillMs` from the tap, because the burst has
// just emptied the board round every bubble on it. Stamped by every
// activation, however the skill was fired -- `useSkill`, or a blind tap the
// gauge then showed had taken -- and honoured wherever the strategy would pop:
// `bubbleTapBudget` for the aimed pops, `link` for a skill's per-chain pops,
// the play loop for its blind sweep. A skill's own pops (an explicit limit,
// or `clearAllBubbles`) are not the strategy's and read none of it.
Tsum.prototype.holdBubblesAfterSkill = function(activatedAt) {
  this.bubbleHoldUntil = activatedAt + GameBubbleConfig.holdAfterSkillMs;
};

// `holdMs` defaults to the strategy's own hold: short under All Bubbles ASAP
// and the Save One pair, which want board space rather than a good blast.
Tsum.prototype.bubblesHeldAfterSkill = function(holdMs) {
  const cfg = GameBubbleConfig;
  if (typeof holdMs !== 'number') {
    const s = this.bubbleStrategy;
    holdMs = s === BubbleStrategy.AllAsap || s === BubbleStrategy.SaveOne
        || s === BubbleStrategy.SaveOneMidChain
      ? cfg.shortHoldAfterSkillMs : cfg.holdAfterSkillMs;
  }
  // `bubbleHoldUntil` is stamped with the long hold; shift it to this one.
  const remainingMs = this.bubbleHoldUntil - cfg.holdAfterSkillMs + holdMs - Date.now();
  if (remainingMs <= 0) { return false; }
  logDebug(Log.Bubble.HeldAfterSkill, {
    remainingMs: remainingMs,
    bubbles: this.gameBubbles ? this.gameBubbles.length : 0
  });
  return true;
};

// How many of the bubbles the last scan found this strategy will spend at once.
// The ceilings, and why there are any, are in GameBubbleConfig.
Tsum.prototype.bubbleTapBudget = function() {
  // A skill that chains bubbles keeps every one of them: the one this would pop
  // on the way past is a link out of that chain, and its chain is worth far more
  // than the bigger clear the pop buys. See `SkillHandler.claimsBubbles`.
  if (skillClaimsBubbles(this)) { return 0; }
  // The hold after a skill activation, for every strategy: the bubbles are in
  // the hole the burst left, and the refill closes round them inside it.
  if (this.bubblesHeldAfterSkill()) { return 0; }
  // The fever hold, for every strategy: the bubbles stay on the board for the
  // chains after the fever. `popGameBubbles` keeps the list on a 0 budget, and
  // the next scan re-finds them anyway.
  if (this.bubblesHeldForFever()) { return 0; }
  switch (this.bubbleStrategy) {
    case BubbleStrategy.AllMidChain: return GameBubbleConfig.maxTapsMidChain;
    // All but the richest -- `popGameBubbles` leaves that one out.
    case BubbleStrategy.SaveOneMidChain: return GameBubbleConfig.maxTapsMidChain;
    case BubbleStrategy.AllAsap: return GameBubbleConfig.maxTapsAsap;
    // The one bubble `popBubbleOverflow` kept.
    case BubbleStrategy.SaveOne: return 1;
    // One Bubble Mid Chain, and anything a stale setting or a hand-written
    // start() puts here: the stingiest reading, which is the safe one to be
    // wrong in -- a bubble left on the board is a bubble the next chain can
    // still spend.
    default: return 1;
  }
};

/** Each bubble's age since first sighting, ms; -1 for one never tracked. */
function bubbleAges(bubbles: GameBubble[]): number[] {
  const now = Date.now();
  const ages: number[] = [];
  for (let i = 0; i < bubbles.length; i++) {
    const seen = bubbles[i].firstSeen;
    ages.push(seen === undefined ? -1 : now - seen);
  }
  return ages;
}

// Give this scan's bubbles their first sightings. See `minAgeMs`. Each is
// matched to the nearest known sighting within `matchRadius`, nearest first;
// one nothing matched is kept for `sightingMemoryMs`, so a scan that missed
// a bubble does not make it new again. A popped one lends its age to nothing.
Tsum.prototype.trackGameBubbles = function(bubbles) {
  const cfg = GameBubbleConfig;
  const now = Date.now();
  const known = this.bubbleSightings;
  const taken: boolean[] = [];
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    let best = -1;
    let bestD = cfg.matchRadius * cfg.matchRadius;
    for (let k = 0; k < known.length; k++) {
      if (taken[k] || known[k].popped) { continue; }
      const dx = known[k].x - b.x;
      const dy = known[k].y - b.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best >= 0) { taken[best] = true; }
    b.firstSeen = best >= 0 ? known[best].firstSeen : now;
    b.lastSeen = now;
  }
  const next = bubbles.slice();
  for (let k = 0; k < known.length; k++) {
    if (!taken[k] && !known[k].popped
        && now - (known[k].lastSeen || 0) <= cfg.sightingMemoryMs) {
      next.push(known[k]);
    }
  }
  this.bubbleSightings = next;
};

// The bubbles of the last scan a pop is worth taking now: seen for at least
// `minAgeMs`, with at least `minTsumsInBlast` tsums in the blast, richest
// first, so a budget of one takes the one that clears most. A bubble that has
// just appeared, or sits in the hole a burst just left, is left for a later
// scan, which re-finds it once the refill has closed round it. Past
// `unripeReleaseMs` the count is a misread and the bubble is worth it by fiat
// -- see GameBubbleConfig.
Tsum.prototype.ripeGameBubbles = function(bubbles) {
  const cfg = GameBubbleConfig;
  const now = Date.now();
  const ripe: GameBubble[] = [];
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    // Never tracked: old enough, and judged on the count alone.
    const age = b.firstSeen === undefined ? cfg.unripeReleaseMs : now - b.firstSeen;
    if (age < cfg.minAgeMs) { continue; }
    if (age >= cfg.unripeReleaseMs || b.near === undefined || b.near >= cfg.minTsumsInBlast) {
      ripe.push(b);
    }
  }
  return richestFirst(ripe);
};

/** A copy of `bubbles`, most tsums in the blast first. */
function richestFirst(bubbles: GameBubble[]): GameBubble[] {
  return bubbles.slice().sort(function(a, b) { return (b.near || 0) - (a.near || 0); });
}

/** Tap one bubble at its scan position, and mark it popped. */
function tapGameBubble(ts: Tsum, b: GameBubble): void {
  if (!ts.mayTouchBoard()) { return; }
  const x = Math.floor(ts.playOffsetX + b.x * ts.playWidth / ts.playResizeWidth);
  const y = Math.floor(ts.playOffsetY + b.y * ts.playHeight / ts.playResizeHeight);
  tap(x, y, GameBubbleConfig.tapDuring, TapHoldMs);
  b.popped = true;
  fluxCancel(Date.now());
}

// Tap the bubbles the last board scan found. Taps only -- the positions were
// worked out at scan time -- so this stays inside the window where the chain is
// still clearing. A tap that misses costs nothing: it is not a drag, so it
// links nothing and the game ignores it.
//
// `limit` caps how many are taken; the default is whatever the Bubble Strategy
// setting allows, and it spends only bubbles worth spending
// (`ripeGameBubbles`). Pass one explicitly only to override that setting
// outright, the way a skill choreography does -- that takes every bubble as
// read, since a choreography wants them gone rather than spent well.
Tsum.prototype.popGameBubbles = function(limit) {
  const all = this.gameBubbles;
  if (!all || all.length === 0 || !this.isRunning) { return; }
  // An explicit `limit` is an override and stands on its own -- the ceilings in
  // bubbleTapBudget are what the *setting* allows, not a hard cap on callers.
  const override = typeof limit === 'number';
  const budget = override ? limit : this.bubbleTapBudget();
  if (budget <= 0) { return; }
  // All Bubbles ASAP takes every one: it wants the space, not the best blast.
  // Save One Mid Chain takes every one but the richest, ripe or not.
  const asap = this.bubbleStrategy === BubbleStrategy.AllAsap;
  const saveOne = !override && this.bubbleStrategy === BubbleStrategy.SaveOneMidChain;
  const bubbles = override || asap ? all
    : saveOne ? richestFirst(all).slice(1)
    : this.ripeGameBubbles(all);
  const held = all.length - bubbles.length;
  const count = Math.min(bubbles.length, budget);
  if (count <= 0) {
    // Every bubble has just appeared or is in a hole. The list stays: the next
    // scan replaces it.
    logDebug(Log.Bubble.Unripe, {
      held: held,
      near: all.map(function(b) { return b.near || 0; }),
      age: bubbleAges(all)
    });
    return;
  }
  for (let i = 0; i < count; i++) { tapGameBubble(this, bubbles[i]); }
  logDebug(Log.Bubble.Popped, { popped: count, seen: all.length, held: held });
  // A bubble only pops once, and one left behind is one this strategy is
  // deliberately saving for the next chain -- either way this list is spent:
  // the board has moved, so the positions in it are no longer where anything
  // is. The next scan finds whatever is still there.
  this.gameBubbles = [];
};

// The overflow pop, for every strategy but All Bubbles ASAP: a scan that sees
// `overflowAt` bubbles or more pops all but the `overflowKeep` richest now,
// ripe or not, so a fast tsum cannot bury the board in them. Save One is the
// same pop kept to one, from two. What is kept stays in the list for `link`'s
// mid-chain pop. Held like the strategy's own pops, but only for the short
// hold after a skill.
Tsum.prototype.popBubbleOverflow = function() {
  const cfg = GameBubbleConfig;
  const all = this.gameBubbles;
  const saveOne = this.bubbleStrategy === BubbleStrategy.SaveOne;
  const keep = saveOne ? 1 : cfg.overflowKeep;
  if (!all || all.length < (saveOne ? 2 : cfg.overflowAt) || !this.isRunning) { return; }
  if (this.bubbleStrategy === BubbleStrategy.AllAsap || skillClaimsBubbles(this)
      || this.bubblesHeldForFever() || this.bubblesHeldAfterSkill(cfg.shortHoldAfterSkillMs)) {
    return;
  }
  const sorted = richestFirst(all);
  const kept = sorted.slice(0, keep);
  const extra = sorted.slice(keep, keep + cfg.maxTapsAsap);
  for (let i = 0; i < extra.length; i++) { tapGameBubble(this, extra[i]); }
  logDebug(Log.Bubble.Overflow, { popped: extra.length, kept: kept.length, seen: all.length });
  this.gameBubbles = kept;
};

Tsum.prototype.link = function(paths, board) {
  let isBubble = false;
  traceSend(Trace.Kind.BoardPaths, function() {
    const half = Config.tsumWidth / 2;
    return {
      // One array of [centre x, centre y] per chain, in drawing order.
      paths: paths.map(function(path) {
        return path.map(function(p) { return [Math.round(p.x + half), Math.round(p.y + half)]; });
      }),
      clusters: paths.map(function(path) { return path.length > 0 ? +path[0].tsumIdx : -1; }),
    };
  });
  // Overloading (burst skills): erased MyTsums keep counting into the gauge
  // for a moment after the drag, and firing the skill right as the gauge tops
  // off lets the rest of that count spill into the next gauge instead of
  // capping at 100%. So after each drag a crop read of the button decides, and
  // a tap goes out when it reads full: no waits, no change to the link cadence
  // (`maybeAutoTapSkill`). The game fires the skill on that tap.
  // Choreographed skills can't ride blind taps (activating without the
  // follow-up aiming wastes the skill) and go through maybeAutoTapSkill,
  // which verifies readiness before handing over to useSkill.
  const pauses = this.pauses;
  for (const i in paths) {
    const path = paths[i];
    // >= 7 should be correct, but practically the real chain is always shorter
    // so using a bigger value than theoretically correct
    if (path.length >= 12) {
      isBubble = true;
    }
    this.linkTsums(path);
    // A pause under this batch: what is left was planned before it, so the
    // next scan re-plans off the board the round came back to.
    if (this.pauses !== pauses) {
      logInfo(Log.Board.BatchPaused, { drawn: +i + 1, planned: paths.length });
      break;
    }
    // Pop what the last scan saw the moment a long chain lands: with Tiara
    // Minnie+ a bubble popped as a chain goes off clears a bigger area, which
    // is the whole reason bubbles are worth saving for a chain at all. How many
    // go is the Bubble Strategy setting's call -- one, under the default. Under
    // All Bubbles ASAP there is nothing left here to pop: the loop spent them
    // the moment the scan found them.
    const ts = this;
    const len = path.length;
    const popAfterChain = function(): void {
      if (len >= ts.bubblePopChainLength()) {
        ts.popGameBubbles();
      }
      // A skill that claimed the bubbles gets its own say. The budget above is 0
      // while a claim stands, and hoarding every bubble for the next activation
      // leaves the board clearing no faster than tsum chains clear it -- so Aurora
      // spends one every couple of long chains. See `popBubblesAfterChain`. Held
      // after an activation as the strategy's pops are, since an explicit count
      // is an override to `popGameBubbles`.
      const pops = skillPopBubblesAfterChain(ts, len);
      if (pops > 0 && !ts.bubblesHeldAfterSkill(GameBubbleConfig.holdAfterSkillMs)) {
        ts.popGameBubbles(pops);
      }
    };
    // Normally the pop goes out with the chain; a skill that wants its gauge
    // checked first (`popsAfterActivating`) pops only if it did not fire.
    const popsLate = skillPopsAfterActivating(this);
    if (!popsLate) { popAfterChain(); }
    // Linking a full batch of chains can take several seconds; check between
    // chains so a gauge that fills mid-batch fires right away.
    //
    // A choreography that ran here ends the batch. It is seconds of taps, drags
    // and waits, and the paths still to draw were planned on the board it was
    // handed, not the one it leaves -- so they either link nothing or link the
    // wrong tsums, and the next scan re-plans off what is actually there.
    // Lorcana Aurora is the case that made it obvious: her window bursts most of
    // the board and chains the bubbles that burst leaves, and the two stale
    // chains drawn afterwards were clearing the board her next burst wanted.
    if (this.maybeAutoTapSkill(board)) {
      break;
    }
    if (popsLate) { popAfterChain(); }
  }
  return isBubble;
}

/** Logical y where the bottom bubble band (`GameBubbleConfig.bandFrom`) starts. */
function bubbleBandTopY(): number {
  return PlayAreaTopY + GameBubbleConfig.bandFrom * 1080;
}

/**
 * The blind sweep: ~50 taps over the whole play area on a fixed grid.
 *
 * This is the deliberate override of the Bubble Strategy setting and is never
 * gated on it. A skill that turns tsums into bubbles, or ends on a board
 * covered in them, is not hoarding anything for a chain that will not come --
 * it declares that with `sweepsBubbles` and calls this. The play loop's own
 * pile-up sweep is the one caller that *is* gated, to `BubbleStrategy.AllAsap`.
 *
 * Blind because it needs no capture: it is far too slow to land inside a chain
 * (that is `popGameBubbles`), so it runs where there is time for it.
 */
Tsum.prototype.clearAllBubbles = function(startDelay, endDelay, fromY, delayBetweenLines) {
  delayBetweenLines = delayBetweenLines || 0;
  if (typeof startDelay === 'number' && startDelay > 0) {
    this.sleep(startDelay);
  }

  let fy = Button.gameBubblesFrom.y;
  if (typeof fromY == 'number') {
    fy = fromY;
  }

  for (let by = fy; by <= Button.gameBubblesTo.y; by += 140) {
    for (let bx = Button.gameBubblesFrom.x; bx <= Button.gameBubblesTo.x; bx += 140) {
      this.tap({x: bx, y: by}, 10);
    }
    this.sleep(delayBetweenLines);
  }
  // Blind, so nothing knows which it took: whatever the next scan finds is
  // new, rather than a new bubble inheriting the age of one this just popped.
  this.bubbleSightings = [];

  if (typeof endDelay === 'number' && endDelay > 0) {
    this.sleep(endDelay);
  }
}

Tsum.prototype.sampleMyTsumColor = function() {
  // The MyTsum portrait is the circular icon inside the skill button at the
  // bottom-left of the play area. Sample a small region around its center,
  // run the same smooth + HSV pipeline as findTsums, and average central
  // pixels so the result is directly comparable to tsum cluster colors.
  const center = this.toRealXY(Button.gameSkill1.x, Button.gameSkill1.y);
  const sampleR = Math.max(4, Math.floor(40 * this.captureGameRatio));
  const x = Math.max(0, center.x - sampleR);
  const y = Math.max(0, center.y - sampleR);
  const img = getScreenshotModify(x, y, sampleR * 2, sampleR * 2, 40, 40, 100);
  try {
    // Same blur-then-convert ordering findTsums uses, for the same reason: the
    // result is compared against cluster centres, so it has to be built the
    // way they were.
    smooth(img, 1, 7);
    smooth(img, 1, 22);
    convertColor(img, 40);
    let sumB = 0, sumG = 0, sumR = 0, count = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const c = getImageColor(img, 20 + dx, 20 + dy);
        sumB += c.b; sumG += c.g; sumR += c.r;
        count++;
      }
    }
    return chromaFeature({ b: sumB / count, g: sumG / count, r: sumR / count });
  } finally {
    releaseImage(img);
  }
};

// How many usable size reads `boardScale` is the median of. Smooths over a
// board read mid-clear without lagging a change by much more than a second.
const BoardScaleWindow = 9;
// Reads needed after a roll before the scale moves, so one taken while the
// new tsums are still falling in cannot set it alone.
const BoardScaleMinReads = 3;
// The smallest scale the reads are trusted to; NBC Set bottoms out ~0.75.
const BoardScaleMin = 0.6;

/**
 * Read the tsums' size off this scan's gray and set `Config.boardScale` to the
 * median of the last few reads, in 0.05 steps and only in the direction
 * `boardScaleTrend` allows. Reset to 1 at each round's start.
 */
Tsum.prototype.updateBoardScale = function(grayImg) {
  // Nothing can change, so no Hough pass.
  if (this.boardScaleTrend === 0) { return; }
  const read = readBoardScale(grayImg, this.boardScaleTrend > 0);
  if (read === null) { return; }
  this.boardScaleReads.push(read);
  if (this.boardScaleReads.length > BoardScaleWindow) { this.boardScaleReads.shift(); }
  if (this.boardScaleReads.length < BoardScaleMinReads) { return; }
  const median = Math.min(1, Math.max(BoardScaleMin, skillMedian(this.boardScaleReads)));
  const scale = Math.round(median * 20) / 20;
  // Only the way the skill said, which is also what stops a median sitting on
  // a step boundary from flipping the scale back and forth.
  if (Math.sign(scale - Config.boardScale) !== this.boardScaleTrend) { return; }
  logInfo(Log.Board.Scale, { from: Config.boardScale, to: scale, read: +read.toFixed(2) });
  Config.boardScale = scale;
};

// The round's last ~5 seconds wash the screen edges cyan once a second: ~0.55s
// bright, then ~0.45s dim. Under the bright part, tsums near the left and right
// edges read the wrong colour (whites join Sally on NBC Set), so chains planned
// through them break after a link or two. Read off the gaps between tsums in
// the edge strips: dark on any board, bright only under the wash. Measured on
// the NBC, Gaston and Elsa recordings (play square, blurred board gray).
var EdgeWash = {
  strip: 8,        // strip width at each side, play-square px
  top: 20,         // rows read, clear of the corners
  bottom: 180,
  step: 2,
  percentile: 0.1, // the darkest tenth: the gaps, not the tsums
  bright: 130,     // both strips at least this bright = washed (normal ~50-80)
  pollMs: 50,
  maxWaitMs: 800,  // the dim part always comes within ~0.55s
  // A wait that ran out was something else lighting the edges, not the wash;
  // don't spend another wait on it this soon.
  backoffMs: 3000,
};

// Sample points of the two strips, left strip first. Built on first use.
let edgeWashPoints: Point[] | null = null;

function edgeWashSamplePoints(): Point[] {
  if (edgeWashPoints !== null) { return edgeWashPoints; }
  const c = EdgeWash;
  const size = Config.screenResize;
  const pts: Point[] = [];
  for (const x0 of [0, size - c.strip]) {
    for (let y = c.top; y < c.bottom; y += c.step) {
      for (let x = x0; x < x0 + c.strip; x += c.step) { pts.push({x: x, y: y}); }
    }
  }
  edgeWashPoints = pts;
  return pts;
}

/** How bright the dimmer edge strip's gaps are, on the board gray. */
function edgeWashLevel(grayImg: NativeImage): number {
  const colors = getImageColors(grayImg, edgeWashSamplePoints());
  const half = colors.length >> 1;
  const level = function(from: number): number {
    const v: number[] = [];
    for (let i = from; i < from + half; i++) { v.push(colors[i].r); }
    v.sort(function(a, b) { return a - b; });
    return v[Math.floor(v.length * EdgeWash.percentile)];
  };
  return Math.min(level(0), level(half));
}

/**
 * If this scan's gray is under the last seconds' edge wash, wait for its dim
 * part. True when it waited, so the caller captures the board again.
 */
Tsum.prototype.waitOutEdgeWash = function(grayImg) {
  const c = EdgeWash;
  const first = edgeWashLevel(grayImg);
  if (first < c.bright || Date.now() < this.edgeWashBackoffUntil) { return false; }
  const start = Date.now();
  let level = first;
  while (this.isRunning && level >= c.bright && Date.now() - start < c.maxWaitMs) {
    this.sleep(c.pollMs);
    const img = this.playScreenshotSquare();
    let gray: NativeImage | null = null;
    try {
      gray = buildBoardGray(img);
      level = edgeWashLevel(gray);
    } finally {
      if (gray !== null) { releaseImage(gray); }
      releaseImage(img);
    }
  }
  const timedOut = level >= c.bright;
  if (timedOut) { this.edgeWashBackoffUntil = Date.now() + c.backoffMs; }
  logDebug(Log.Board.EdgeWash, { waitedMs: Date.now() - start, first: first,
    level: level, timedOut: timedOut });
  return true;
};

/** Large tsums the last scan found, so `board.largeTsums` is logged on a change. */
var gLargeSeen = 0;
/** The large tsums the scan before found, which a hit has to repeat. */
var gLargePrev: LargeCircle[] = [];
/** Scans skipped since the last large-tsum read (`LargeTsum.idleEvery`). */
var gLargeSkipped = 0;

Tsum.prototype.scanBoardQuick = function() {
  // load game tsums
  const startTime = Date.now();
  let srcImg = this.playScreenshotSquare();
  const board: BoardPoint[] = [];
  // Owned here rather than inside either pass, so the two Hough passes below
  // share one image and exactly one release covers it -- including when a
  // native call throws mid-scan, which the task controller swallows and
  // retries, so a leak here would recur on every scan.
  let grayImg: NativeImage | null = null;
  try {
    // The skill sees the frame first (`SkillHandler.watchScan`); one that acted
    // on it has moved the board on, so capture again.
    if (skillWatchScan(this, srcImg)) {
      releaseImage(srcImg);
      srcImg = this.playScreenshotSquare();
    }
    // Overload carry-over: the last batch's count-in may top the gauge off
    // during this scan; one blind tap catches it. After the capture so the tap
    // can't disturb the frame, and inside the try so a tap that throws still
    // releases it.
    if (this.overloadPending) {
      this.overloadPending = false;
      if (!skillStillRunning(this)) {
        this.tap(Button.gameSkill1, 10);
      }
    }
    // Both circle passes want the same grayscale, blurred copy of the board, so
    // it is built once here and handed to each. They used to build one apiece:
    // two clones, two colour conversions and two 9x9 Gaussians per scan for a
    // pair of identical images.
    grayImg = buildBoardGray(srcImg);
    if (this.waitOutEdgeWash(grayImg)) {
      releaseImage(grayImg);
      grayImg = null;
      releaseImage(srcImg);
      srcImg = this.playScreenshotSquare();
      grayImg = buildBoardGray(srcImg);
    }
    if (skillScalesBoard(this)) {
      this.updateBoardScale(grayImg);
    }
    const circles = findTsumCircles(srcImg, grayImg);
    // Read bubble positions off this same capture and remember them, so popping
    // one after a chain is taps only -- no screenshot in the middle of a batch,
    // which would stall the link cadence and the combo timer with it. Bubbles
    // are big and drift slowly, so a position a second old still lands. Each
    // carries how many of this scan's tsums its pop would take (`near`).
    // Not while a skill's animation is on: it dims the board and, for Sulley,
    // draws a giant one, and both read as large tsums. Timed from any tap known
    // to fire the skill (`skillFiredAt`), the play loop's bare taps included.
    const animating = Math.max(this.skillFiredAt,
      this.bubbleHoldUntil - GameBubbleConfig.holdAfterSkillMs) + LargeTsum.skillQuietMs > Date.now();
    let large: LargeCircle[] = [];
    if (animating) {
      gLargePrev = [];
      // The first scan after the animation reads.
      gLargeSkipped = LargeTsum.idleEvery;
    } else if (gLargePrev.length === 0 && gLargeSkipped < LargeTsum.idleEvery - 1) {
      // Nothing pending or confirmed: this scan skips the read.
      gLargeSkipped++;
    } else {
      gLargeSkipped = 0;
      // A large tsum barely moves, so a hit counts once it has been found at
      // the same spot for `LargeTsum.confirmScans` scans running; the flat
      // patches a refill leaves are gone within two.
      const found = findLargeTsums(srcImg, circles);
      for (let i = 0; i < found.length; i++) {
        found[i].seen = 1;
        for (let j = 0; j < gLargePrev.length; j++) {
          const dx = found[i].x - gLargePrev[j].x, dy = found[i].y - gLargePrev[j].y;
          if (dx * dx + dy * dy <= LargeTsum.sameSpot * LargeTsum.sameSpot) {
            found[i].seen = (gLargePrev[j].seen || 1) + 1;
            break;
          }
        }
      }
      gLargePrev = found;
      large = found.filter(function(f) { return (f.seen || 0) >= LargeTsum.confirmScans; });
    }
    // A bubble-pass circle on a large tsum is the tsum, not a bubble.
    this.gameBubbles = findGameBubbles(grayImg, srcImg, circles).filter(function(b) {
      return !pointInLarge(b, large, 1);
    });
    // Large tsums are sampled and planned with the rest, and reach farther
    // (`buildTsumNeighbors`).
    // Info, but only when the count changes: the debug records never reach the
    // log file, and this is the line that says whether the detector sees any.
    if (large.length !== gLargeSeen) {
      gLargeSeen = large.length;
      logInfo(Log.Board.LargeTsums, { count: large.length,
        at: large.map(function(l) { return [Math.round(l.x), Math.round(l.y)]; }) });
    }
    // Circles still waiting to clear are left out only for a look that asks
    // (`fluxFilter`): see the ledger's header for why not every scan.
    const seen = findTsums(srcImg, grayImg, dropInsideLarge(circles, large), large);
    const points = this.fluxFilter ? fluxDrop(seen) : seen;
    // Kept for the dead-scan check, which asks whether a chain just drawn is
    // still standing -- exactly the tsums the ledger leaves out.
    this.boardClearing = [];
    for (let i = 0; i < seen.length; i++) {
      if (points.indexOf(seen[i]) < 0) {
        this.boardClearing.push({ tsumIdx: '', x: seen[i].x - Config.tsumWidth / 2, y: seen[i].y - Config.tsumWidth / 2 });
      }
    }
    // Each one's first sighting, carried over from earlier scans -- what
    // `ripeGameBubbles` ages it by. Run on an empty list too: that is what
    // lets old sightings go.
    this.trackGameBubbles(this.gameBubbles);
    if (this.gameBubbles.length > 0) {
      logDebug(Log.Bubble.Found, { bubbles: this.gameBubbles.length,
        near: this.gameBubbles.map(function(b) { return b.near || 0; }),
        age: bubbleAges(this.gameBubbles) });
    }
    logDebug(Log.Board.RecognitionStart);
    const tcs = classifyTsums(points);
    tcs.sort(function(a, b) { return a.points.length > b.points.length ? -1: 1; });
    // HSV cluster centers — compare these (and the inter-cluster distance3D)
    // against the boardImg circles when tuning the color-clustering settings.
    // One record with a cluster per array entry rather than a line each: the
    // whole point of reading these is comparing them against one another.
    logDebug(Log.Board.Clusters, {
      clusters: function() {
        const out: LogFields[] = [];
        for (let ci = 0; ci < tcs.length; ci++) {
          const distances: number[] = [];
          for (let cj = 0; cj < ci; cj++) {
            distances.push(Math.round(distance3D(tcs[ci], tcs[cj])));
          }
          // h/s/v, which is how a cluster centre is read; `distances` are
          // `distance3D`'s own, which is what the merge threshold measures --
          // texture axes included between two greys, hence the two texture
          // means beside them.
          const hsv = chromaToHsv({b: tcs[ci].b, g: tcs[ci].g, r: tcs[ci].r});
          out.push({
            cluster: ci,
            n: tcs[ci].points.length,
            h: Math.round(hsv.b),
            s: Math.round(hsv.g),
            v: Math.round(hsv.r),
            contrast: Math.round(tcs[ci].contrast),
            peak: Math.round(tcs[ci].peak),
            distances: distances,
          });
        }
        return out;
      },
    });

    // Identify which color cluster (if any) is the player's MyTsum by matching
    // the skill-button portrait color against cluster centers. Only the
    // "Link MyTsum first" setting reads myTsumIdx, so with it off -- or held
    // off by the skill (`setMyTsumPriority`) -- the whole thing is skipped;
    // the portrait sample is a screenshot per game.
    // How many clusters this scan keeps. Normally `uniqueTsumCount - 1`; a
    // skill that turns tsums into a colour of their own declares the extra it
    // needs, so its ice does not push live colours off the board array
    // (`SkillHandler.extraClusterSlots`).
    const clusterSlots = skillClusterSlots(this);
    this.myTsumIdx = -1;
    if (skillMyTsumPriority(this)) {
      if (!this.myTsumColor) {
        // The library first: `identifyMyTsum` read which tsum this is off the
        // pre-round screen, and what that tsum looks like on a board was
        // derived from its own art rather than photographed. Sampling the
        // skill button is the fallback -- see `MyTsumBoard` for why it is not
        // the first choice any more.
        //
        // The library column is HSV, so it converts here -- clusters live on
        // the chroma plane. It answers null for the file shipping today: that
        // column was derived through the old blur ordering, so
        // `MyTsumBoard.tag` no longer matches it and the loader drops it. The
        // button sample needs no conversion, `sampleMyTsumColor` already
        // building it the way this scan built its clusters.
        const known = myTsumBoardColor(this.myTsum);
        this.myTsumColor = known ? chromaFeature(known) : this.sampleMyTsumColor();
        logDebug(Log.Board.MyTsumColor, {
          color: this.myTsumColor,
          source: known ? 'library' : 'button',
          tsum: this.myTsum,
        });
      }
      let bestMyDist = MyTsumBoard.maxDistance;
      for (let ci = 0; ci < tcs.length && ci < clusterSlots; ci++) {
        const dMy = distance3D(tcs[ci], this.myTsumColor);
        if (dMy < bestMyDist) {
          bestMyDist = dMy;
          this.myTsumIdx = ci;
        }
      }
    }

    // Keep the colour behind each tsumIdx. `calculatePaths` and everything
    // after it see only the index, so without this the board's colours are
    // gone by the time anything downstream could ask -- which is what a skill
    // that has to tell two of them apart needs (`SkillHandler.orderPaths`).
    // Three numbers per cluster, off numbers the scan has already computed.
    this.boardClusters = [];
    this.boardClusterSizes = [];
    for(const i in tcs) {
      if (+i >= clusterSlots) {
        break;
      }
      const tc = tcs[i];
      // Published as hue/saturation/value, not as the chroma feature they were
      // grouped on -- the skills that read these (Elsa's frozen box, Formal
      // Beast's two families) are written in those terms and stay that way.
      this.boardClusters.push(chromaToHsv({b: tc.b, g: tc.g, r: tc.r}));
      // The size beside the colour: a colour that is a handful of tsums on one
      // scan is a transient, and Elsa's ice-alike whitelist must not learn it.
      this.boardClusterSizes.push(tc.points.length);
      // The debug palette is five long and a skill may ask for more slots than
      // that, so it wraps -- two clusters sharing an overlay colour is a
      // cosmetic collision, reading past the end is a crash.
      const dbg = Config.colors[+i % Config.colors.length];
      for (const j in tc.points) {
        const p = tc.points[j];
        // The tsum's own colour and texture ride along for per-tsum reads.
        board.push({
          tsumIdx: i,
          x: p.x - (Config.tsumWidth / 2),
          y: p.y - (Config.tsumWidth / 2),
          local: p.local,
          contrast: p.contrast,
          grow: p.grow,
        });
        if (this.debug) {
          drawCircle(srcImg, p.x, p.y, 4, dbg[0], dbg[1], dbg[2], 0);
        }
      }
    }
    if (this.debug) {
      saveImage(srcImg, this.devicePath + "/tmp/" + ts!.runTimes + "-boardImg.jpg");
    }
  } finally {
    if (grayImg != null) { releaseImage(grayImg); }
    releaseImage(srcImg);
  }
  this.boardSeenAt = Date.now();
  this.boardSeenTsums = board.length;
  logDebug(Log.Board.Recognized, { tsums: board.length, clearing: this.boardClearing.length });
  logDebug(Log.Board.RecognitionTime, { durationMs: Date.now() - startTime });
  // Compact arrays: a scan is ~50 tsums, several times a second.
  traceSend(Trace.Kind.BoardScan, () => {
    const half = Config.tsumWidth / 2;
    return {
      width: this.playResizeWidth,
      height: this.playResizeHeight,
      tsumWidth: Config.tsumWidth,
      // [cluster, centre x, centre y]
      tsums: board.map(function(t) { return [+t.tsumIdx, Math.round(t.x + half), Math.round(t.y + half)]; }),
      // [h, s, v] per cluster index, and how many tsums each holds.
      clusters: this.boardClusters.map(function(c) { return [Math.round(c.b), Math.round(c.g), Math.round(c.r)]; }),
      sizes: this.boardClusterSizes,
      myTsumIdx: this.myTsumIdx,
      // The frame this was read from, when the viewer got it (`frame.square`).
      frame: this.squareFrame,
      // [x, y, radius, tsums its pop would take]
      bubbles: this.gameBubbles.map(function(b) { return [Math.round(b.x), Math.round(b.y), Math.round(b.r), b.near || 0]; }),
      durationMs: Date.now() - startTime,
    };
  });

  return board;
}
