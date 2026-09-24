// ---------------------------------------------------------------------------
// Gaston
//
// While his skill window is open, every tsum that drops is a Gaston. A chain of Gastons cleared
// in the window refills with more Gastons, so the skill is worth as much board as it clears.
//
// ## The round
// Before the first activation the round plays normally. From then on the skill owns the bubbles
// (`claimsBubbles`) and nothing between windows pops one. Each window (`gastonWindow`) is:
//   1. Two cancelled chains (`passesBeforeHold`, `nextPassMs`), each cut to its slot and
//      cancelled with a bubble on release so the refill lands at once.
//   2. A closing chain, cut to end `closeLeadMs` before the close and released `antlerReleaseMs`
//      after it, so its pop charges the gauge. Gastons cleared while the skill runs charge
//      nothing. A chain with no bubble is held too if its pop would refill after `refillBy`.
//   3. The skill button is spammed (`gastonSpamSkill`). The first full read is the next
//      activation, and the next window opens from it (`afterActivate`).
// The close is timed off the antlers in the chrome (`antlerMs`), not the tap. The window opens
// on a full tsum count that has stopped climbing, behind `openFloorMs`.
//
// ## The route
// The longest path over the free Gastons (`gastonChain`), started from its higher end and away
// from leftovers (`gastonOrient`). The game links only from the head, and links whatever a hop
// crosses, so hops may cross no other tsum or bubble (`gastonNeighbors`). HUD digits in the top
// `hudBand` are not tsums (`gastonFreeBoard`). Each hop dwells `dwellMs`.
//
// ## The paint read: which tsums are Gaston
// A finger resting on a Gaston paints every other Gaston pale. The drag reads each circle before
// the grab and after `paintMs`; a rise of `paintRise` marks a Gaston, and the route is planned
// from the head over those (`gastonLinkChain`, `gastonChainFrom`). A head that paints nothing is
// lifted and the next start tried. Nothing is read inside `paintBlackoutMs` of the close.
// Without a read, the pass falls back to the carry (`gastonCarry`: circles last read as not
// Gaston), then to the biggest colour cluster (`gastonGastons`).
//
// ## Bubbles
// The game stops linking at a bubble, so routes keep clear of every bubble known (`bubbleAvoid`):
// the Hough pass, a lower-threshold pass over the bowl's bottom, and the round's memory
// (`gastonBubbles`). A cancel taps all but `bubbleReserve` (`gastonTapBubbles`), skips chains
// under `cancelMinChain`, and is checked off the tsum count (`cancelDrop`).
//
// ## Other rules
// - Nothing here consults the player's chain settings. Between windows `chainLimits` sends one
//   uncapped chain per scan.
// - Stalls are recovered by the coin check (`rewind`): the drag walks back or restarts.
// - A pass with a short Gaston chain or a mostly-leftover board chains other colours too
//   (`mixedFrom`).
// ---------------------------------------------------------------------------

// --- Tuning data -----------------------------------------------------------

// `var`, like every other skill's table: a `const` here is lexical, so it is not
// a property of the global object and the offline harness cannot reach it.
var GastonConfig = {
  // How long the drops stay Gaston after the activation animation ends, by
  // skill level 1-6, in ms. Only level 6 is measured; the rest are a straight
  // ladder. Erring long is safe: an under-run releases inside the window.
  durationMs: [4000, 4400, 4800, 5200, 5600, 6000],

  // --- the board gates -----------------------------------------------------
  //
  // Polls the tsum count (one capture + one Hough pass, ~10ms) rather than
  // `settleBoard`, whose grid popups and coin showers keep moving.
  pollMs: 80,
  // Full: count at or over `enoughTsums` and not up by more than `countNoise`
  // for `stillReads` reads. 36, not ~43, because bubbles take up tsum slots.
  enoughTsums: 36,
  countNoise: 2,
  stillReads: 2,
  // Length of the activation animation; the window's clock (`refillBy`) runs
  // from its end.
  openMinMs: 3500,
  // Opening gate floor and ceiling. Before the floor a full count is the last
  // closing chain still popping, and early gates drew much shorter chains.
  openFloorMs: 4600,
  openWaitMs: 6500,
  // Refill gates between passes. A cancelled clear refills in ~1s, so its floor
  // is `fillMinMs` from the release. An uncancelled clear pops one tsum per
  // `popPerTsumMs`, so its floor is the pop's length plus `popTailMs`.
  // `fillWaitMs` is the ceiling past the floor for a board that never reads full.
  fillMinMs: 800,
  fillWaitMs: 1500,
  popPerTsumMs: 90,
  popTailMs: 400,
  // Wait after a full count before scanning: the last tsums may still be falling.
  landMs: 250,
  // A pass that found no chain waits this long before looking again.
  rescanIdleMs: 120,

  // --- the chain -----------------------------------------------------------
  //
  minChain: 3,
  // Step budget per component for `findLongestTsumPath` (~12ms on device);
  // more steps barely lengthen routes.
  searchSteps: 3000,
  // A route end within this of a leftover (tsum widths) is the frontier, and
  // the drag starts from the other end (`gastonOrient`). 1.2 = touching.
  frontierAvoid: 1.2,
  // Skip hops whose segment passes within this of another tsum's centre (tsum
  // widths): the game links what the line crosses. Every adjacent hop still fits.
  crossAvoid: 0.7,
  // Longest planned hop in tsum widths, under the play loop's `linkReach`
  // (1.9); longer hops stall far more often.
  hopReach: 1.6,

  // --- the paint read ------------------------------------------------------
  //
  // With a Gaston under the finger the game paints every other Gaston pale.
  // Read as each circle's rise in floor (darkest channel, median over a
  // (2*paintGrid+1)^2 grid at `paintStep`) from just before the grab to
  // `paintMs` after. A circle up by `paintRise` is Gaston. Fewer than
  // `minChain - 1` means the head was not: lift and retry, `deadRetries` times.
  // No read within `paintBlackoutMs` of the close (the game paints all Gastons
  // pale on its own then), except a closing chain begun after the antlers go,
  // and none for the rest of a window once a pass has read nothing twice.
  paintMs: 80,
  paintGrid: 3,
  paintStep: 2,
  paintRise: 12,
  paintBlackoutMs: 1000,
  deadRetries: 2,
  // A head painting fewer than this, and under half its colour cluster, is a
  // dark-haired lookalike: lifted, and the next start avoids what it painted.
  strayPaint: 12,
  // A pass with no read skips circles within this of the last read's leftovers
  // (tsum widths); leftovers sit under the Gastons and mostly stay put.
  carryMatch: 0.6,
  // The two round HUD buttons under the bowl, in play-square coordinates. The
  // hem brings them into the bubble capture; a circle within `hemButtonAvoid`
  // tsum widths of one is a button, not a bubble.
  hemButtons: [{ x: 30, y: 214 }, { x: 170, y: 214 }],
  hemButtonAvoid: 1.0,
  // How far a planned tsum stays from a bubble's centre, in tsum widths (a
  // bubble is ~1.4 across). Larger cuts the pile into unroutable pieces.
  bubbleAvoid: 1.0,
  // A second Hough pass over the bottom of the capture (from `bubbleBandFrom`
  // of its height) at `bandParam2`, for bubbles resting on the bowl's bottom
  // that the rim lights hide from `GameBubbleConfig.param2`. Its finds are
  // `band`: avoided and tapped like the main pass's. It may take a tsum now and
  // then; tapping one is ignored by the game.
  bubbleBandFrom: 0.68,
  bandParam2: 14,
  bandMaxRadius: 20,
  // The main pass's own threshold (vs `GameBubbleConfig`'s 26). Every circle
  // from either pass is then checked inside: no dark Gaston hair through its
  // middle (`bubbleDarkMax` of the disc at 0.7 radius under value 64), and not
  // white like a pale-painted tsum (`bubbleWhiteMax`).
  hardParam2: 24,
  bubbleDarkMax: 0.03,
  bubbleWhiteMax: 0.4,
  // Bubbles stay known this long, matched within `bubbleMatch` widths on later
  // reads, since one can drop out of the Hough. Remembered bubbles are `soft`:
  // avoided, but tapped only when a cancel did not take, as they may have rolled.
  bubbleMemoryMs: 12000,
  bubbleMatch: 1.2,
  // How far below the play square the bubble capture runs, as a share of its
  // height: bubbles resting at the bowl's deep middle are cut off the square.
  bubbleHem: 0.1,
  // Share of gold (bubble icons) in a circle's coin grid that marks a
  // tsum-scan circle in the bottom band (`bubbleBandFrom`) as a bubble the
  // Hough missed. Band only: higher up, rim lights and coin showers read gold.
  bubbleGold: 0.3,
  // Band across the top of the play square, in tsum widths, where the HUD draws;
  // a circle centred in it is a glyph, not a tsum. A full pile's top row
  // starts at 1.25.
  hudBand: 1.25,
  // The band for circles the paint read found painted: those are tsums, so
  // only the glyph rows stay cut.
  paintedHudBand: 0.6,

  // --- the drag ------------------------------------------------------------
  //
  // 30ms on each tsum, unpaced: 10ms linked far fewer chains whole, 50ms fit
  // only two passes per window. A thirty-chain is ~1s.
  //
  // One MOVE per tsum, queued: the game links along the line between MOVEs,
  // and `crossAvoid` keeps that line clear of other tsums.
  grabMs: 10,
  dwellMs: 30,
  releaseMs: 10,

  // --- the rewind ----------------------------------------------------------
  //
  // ~2% of hops fail at random, leaving the finger dragging an empty line, so
  // the drag checks as it goes (`gastonStalled`). Linked tsums get a gold coin
  // (bar the first 2-4). Every `checkEvery` tsums, and `coinSettleMs` after
  // the last, the `checkSpan` tsums ending `coinLag` behind the finger are
  // read; with no coin on any, the finger walks back to the tsum before the
  // last coin (which unwinds the chain) and redraws, up to `maxRewinds` times.
  rewind: true,
  checkEvery: 4,
  checkSpan: 4,
  coinLag: 2,
  // Route index of the first tsum that can carry a coin.
  coinFrom: 4,
  // The fewest tsums a check reads, so the first check is at the twelfth
  // tsum; earlier checks called chains stalled before their coins showed.
  checkMinSpan: 4,
  // Where the walk-back searches for the last coin from: the coins can start
  // at the second link.
  coinBackFrom: 2,
  // How far past its slot the last cancelled pass's redraw may run; the
  // closing chain starts that much later.
  rewindGraceMs: 500,
  // How far the game's count may trail the route index before a coin stall is
  // believed.
  countSlack: 3,
  // A cancelled pass linked this far releases at a stall rather than
  // rewinding (`gastonLinkChain`) -- except the last cancel with this much of
  // its slot left, grace included, since time saved there only waits.
  stopFrom: 8,
  lastRewindRoomMs: 600,
  // Same for the first cancel, within its own slot.
  firstRewindRoomMs: 400,
  coinSettleMs: 80,
  // Coin test: a (2*coinGrid+1)^2 grid at `coinStep` round the planned
  // centre is a coin when `coinShare` of it is gold (hue 36-60, saturation
  // over 0.5, value over 0.82).
  coinGrid: 3,
  coinStep: 2,
  coinShare: 0.2,
  maxRewinds: 3,
  // A first stall with no more than `restartBelow` linked is stuck at the head
  // in a way no walk-back undoes: lift and restart from the route's far end,
  // skipping the `restartSkip` tsums round the old head.
  restartBelow: 3,
  restartSkip: 3,
  // Stalls repeat on the same route, so after a walk-back the rest is replanned
  // clear of every linked tsum, with a first hop no longer than this (tsum
  // widths). A repeat stall also excludes the failing tsum; no route stops the drag.
  replanFirstHop: 1.5,

  // --- the cancel, and the hold --------------------------------------------
  //
  // Chains drawn and cancelled before the closing one, each timed into the
  // window (see `nextPassMs`); each earns a bubble back. A pass with no bubble
  // to cancel with still counts as one -- unless its pop would refill past
  // the close, when it is held instead (see `gastonPass`).
  passesBeforeHold: 2,
  // Tapped as the drag releases: a late tap spends a bubble on nothing.
  cancelTapMs: 10,
  // Bubbles a cancel leaves standing for the next pass, since a chain that
  // breaks short earns none back. A lone bubble is still tapped. Memory counts;
  // the one kept is a read one out toward the rim (`gastonTapBubbles`).
  bubbleReserve: 1,
  // A chain this long earns its own bubble, so its cancel keeps none back.
  bubbleEarnChain: 12,
  // Chains under this are not cancelled: their pop ends inside `fillMinMs`
  // anyway, and the bubble is worth more later.
  cancelMinChain: 10,
  // From this many known bubbles (memory included) they are not scarce: every
  // release is cancelled, and a pass with no chain pops all but the reserve.
  // Two, because each extra bubble cuts routes (`bubbleAvoid`) and they pile up
  // across windows (`claimsBubbles`).
  surplusBubbles: 2,
  // A cancel is confirmed when the tsum count drops `cancelDrop` within
  // `cancelCheckMs` of the tap (a pop manages ~4). Unconfirmed, the `soft`
  // bubbles are tapped too and the refill gate waits out the pop. Chains under
  // `cancelCheckMin` are not checked.
  cancelDrop: 8,
  cancelCheckMs: 400,
  cancelPollMs: 40,
  cancelCheckMin: 10,
  // A chain whose drag ends within this of the earliest close is held, not
  // cancelled: there is no time to chain the refill. Without a bubble the tail
  // is the pop itself (`popPerTsumMs`, `popTailMs`).
  noCancelTailMs: 800,
  // The window's schedule: `passesBeforeHold` cancelled passes, then the
  // closing chain. The last cancel releases `nextPassMs` before the antlers go
  // (release to next grab; tracked per round in `gastonCycleMs`), so its
  // refill lands as they go. Earlier cancels share the time before it evenly;
  // a share too short for `cancelMinChain` drops a pass. The closing chain is
  // drawn up to `closeLeadMs` before the close, held through it, continued
  // once the antlers leave, and released at once, capped at `closeChainMax`.
  // Its clear alone fills the gauge, so it must be long.
  nextPassMs: 1500,
  closeChainMax: 32,
  // Ceiling on how long past the close the held chain stays down, for a window
  // where the antlers were never seen; otherwise it lets go `antlerReleaseMs`
  // after they leave. Errs late: releasing inside the window loses the charge.
  holdPastCloseMs: 300,
  antlerReleaseMs: 100,
  // How much later than a full refill cycle before the antlers go the last
  // cancel releases: the closing pass only needs to clear its refill gate by
  // then, not grab. Gives the cancelled chains more time.
  closeSlackMs: 120,
  antlerEarlyMs: 700,
  // The chrome left of the score capsule: the antlers are up there when red
  // is over `antlerMinRed` and over blue by `antlerRedOverBlue`.
  antlerProbe: { x: 300, y: 250 },
  antlerMinRed: 110,
  antlerRedOverBlue: 30,
  // How long the antlers stay up at level 6, and tap to close when they were
  // not seen coming up; other levels are shorter by the `durationMs` gap. A
  // first sighting outside `antlerUpMs` (from the tap) is a misread.
  antlerMs: 8450,
  tapToCloseMs: 9650,
  antlerUpMs: [800, 2000],
  // The closing chain is cut to end this long before the predicted close,
  // if `chargeMinChain` or more still fits: the game freezes around the close
  // and breaks drags. `hopOverMs` is each hop's cost past the dwell.
  closeLeadMs: 300,
  hopOverMs: 6,
  // The hold sleeps in slices this long, so a stopped run lifts the finger
  // within one.
  holdSliceMs: 50,

  // --- charging the gauge after the release --------------------------------
  //
  // How long the button is spammed after the release; past this the play loop
  // takes over. A held chain under `chargeMinChain` skips the wait entirely.
  gaugeWaitMs: 4500,
  chargeMinChain: 12,
  // Closing-chain total the charge needs (gauge takes ~23 tsums). A closing
  // chain short of this is followed by another once its pop lands, at most
  // `closeRetries` more.
  gaugeChain: 24,
  closeRetries: 2,
  // The spam's minimum run.
  chargeMinMs: 300,
  // The spam also stops this long after the held chain's clear should be over
  // (`popPerTsumMs` a tsum, using the late count when the counter read one).
  chargeTailMs: 1500,
  // The spam tap's `during`; the host holds every tap 40ms anyway.
  spamTapMs: 10,
  // How often the spam checks the board is still up, so taps stop if the round
  // ends.
  spamPageCheckMs: 500,

  // A scan reading far under a board the gate just saw full is under a flash
  // (the fever label's) and rescans for up to this long.
  flashRetryMs: 600,

  // --- a board of leftovers ------------------------------------------------
  //
  // Whatever the window clears refills as Gaston, so a pass whose Gaston chain
  // is under `mixedBelow`, or whose board has `mixedFrom`+ leftovers, also
  // clears other-colour chains off the same scan for up to `mixedChainMs`
  // before the cancel. So does a pass with no Gaston chain
  // (`gastonClearLeftovers`). 0 turns it off.
  mixedBelow: 15,
  mixedFrom: 15,
  mixedChainMs: 1000,
  // The play loop's window (a round's first, or after a charge that did not
  // fire) starts on a mixed board. Its cancelled passes each clear other
  // colours for this long past their slot, as long as the refill lands before
  // the close (`noCancelTailMs`).
  convertChainMs: 1500,
  // Leftover kinds a converting pass reads and chains after the scan's own
  // (`gastonPaintedLeftovers`).
  convertReads: 3,
};

// `roundStartedAt` of the round whose first activation has gone out, or 0.
// Bubbles belong to the window from then to round end (`claimsBubbles`).
// Round stamps are unique, so nothing resets.
var gastonClaimRound = 0;

// The open window's round and earliest close, for `stillRunning`: a full
// gauge inside it waits.
var gastonWindowRound = 0;
var gastonWindowUntil = 0;

// The open window's tap time, and the round's measured refill cycle (cancel
// release to next grab, see `nextPassMs`), keyed to the round.
var gastonWindowT0 = 0;
var gastonCycleMs = 0;
var gastonCycleRound = 0;

// The skill's antlers in the chrome (`gastonWatchAntlers`): `up` 1 while up
// (-1 unread), and when they came up and left. Zeroed at each window's tap.
var gastonAntlers = { up: -1, onAt: 0, offAt: 0 };

// Non-Gaston centres (play-square scale) from the window's last paint read, for
// passes that cannot read (see `carryMatch`), and whether a read happened this
// window: an empty carry after a read means the board is all Gaston.
// Both reset as each window opens.
var gastonCarry: Point[] = [];
var gastonCarryRead = false;

// Every bubble seen this round, with when it was last seen
// (`gastonRememberBubbles`), so ones a later Hough misses are still known.
var gastonBubbleMemory: GameBubble[] = [];
var gastonBubbleRound = 0;

/** Whether this round's first skill activation has fired. */
function gastonActivated(ts: Tsum): boolean {
  return ts.roundStartedAt !== 0 && gastonClaimRound === ts.roundStartedAt;
}

/** What one pass of the window came to. */
interface GastonPass {
  /** Tsums in the chain drawn, 0 when none was. */
  chain: number;
  /** Chain length per the game's counter (chainCounter.ts); null when nothing was drawn or unread. */
  registered: number | null;
  /** The counter again just before a held chain's release; null unless held and read. */
  registeredLate: number | null;
  /** Bubbles tapped to cancel the pop animation. */
  cancelled: number;
  /** Whether the tsum count showed the cancel worked; null when unchecked (`cancelCheckMin`). */
  confirmed: boolean | null;
  /** Other colours' chains drawn beside it (`mixedFrom`). */
  extra: number;
  /** Release to the last tsum popping, uncancelled. */
  popMs: number;
  /** The closing chain: held on its last tsum until the window closed, then left to pop. */
  held: boolean;
  /** How long the finger stayed on the last tsum past the drag, in ms. */
  heldMs: number;
  /** Epoch ms of the release, 0 when nothing was drawn. */
  releasedAt: number;
  /** Epoch ms of the grab, 0 when there was none. */
  headAt: number;
  /** Tsums the scan found, HUD glyphs included. */
  read: number;
  /** Tsums in the board's biggest colour cluster. */
  biggest: number;
  /** Time the drag spent waiting on the game beyond its dwells (see `GastonDrag`). */
  overMs: number;
  /** Drags lifted at the head: it painted nothing, or no chain reaches from it. */
  dead: number;
  /** Of those, heads that painted nothing (a read failure, not a route one). */
  blank: number;
  /** False when the round ended during the window. */
  onBoard: boolean;
}

/** What a wait for the board came to. */
interface GastonWait {
  /** The fullest the board was seen. */
  peak: number;
  /** It left on a full count, not the timeout. */
  full: boolean;
}

/** What the charge after the held chain came to. */
interface GastonCharge {
  /** Taps sent to the button. */
  taps: number;
  /** The gauge read full: the next activation fired or fires on the next tap. */
  ready: boolean;
  /** False when the round ended during the charge. */
  onBoard: boolean;
}

/**
 * Whether a round-over screen has replaced the board. Uses the play loop's
 * sweep, so the pause menu or a HUD animation does not count.
 */
function gastonRoundOver(): boolean {
  return isRoundOverPage(gPages.detect(1, 0, inRoundPages()));
}

// --- The antlers -------------------------------------------------------------

/**
 * Read the antlers at `antlerProbe` and stamp when they come up and leave
 * (`gastonAntlers`). Called on every poll of the window.
 */
function gastonWatchAntlers(ts: Tsum): void {
  const cfg = GastonConfig;
  const p = ts.toRealXY(cfg.antlerProbe.x, cfg.antlerProbe.y);
  const x = Math.max(0, p.x - 1);
  const y = Math.max(0, p.y - 1);
  const img = getScreenshotModify(x, y, 3, 3, 0, 0, 100);
  let up = 0;
  try {
    const c = getImageColor(img, p.x - x, p.y - y);
    up = c.r >= cfg.antlerMinRed && c.r - c.b >= cfg.antlerRedOverBlue ? 1 : 0;
  } finally {
    releaseImage(img);
  }
  if (up === gastonAntlers.up) { return; }
  if (up === 1) { gastonAntlers.onAt = Date.now(); }
  if (up === 0 && gastonAntlers.up === 1) { gastonAntlers.offAt = Date.now(); }
  gastonAntlers.up = up;
}

/** About how long a drag over `chain` tsums takes. */
function gastonDragEstimate(chain: number): number {
  const cfg = GastonConfig;
  return cfg.grabMs + cfg.releaseMs + chain * (cfg.dwellMs + cfg.hopOverMs);
}

// --- Reading the board ------------------------------------------------------

/** How many tsum circles the board shows, from one capture. */
function gastonCountTsums(ts: Tsum): number {
  const img = ts.playScreenshotSquare();
  let gray: NativeImage | null = null;
  try {
    gray = buildBoardGray(img);
    return findTsumCount(gray);
  } finally {
    if (gray != null) { releaseImage(gray); }
    releaseImage(img);
  }
}

/**
 * Wait until the board reads full and report the peak count.
 * Leaves once the count is at `enoughTsums` and has stopped climbing
 * (`stillReads` reads not up by more than `countNoise`), or at `until`.
 * Never leaves before `notBefore`.
 */
function gastonAwaitBoard(ts: Tsum, until: number, notBefore: number): GastonWait {
  const cfg = GastonConfig;
  let count = gastonCountTsums(ts);
  let peak = count;
  let held = 0;
  let full = false;
  while (ts.isRunning && Date.now() < until) {
    if (Date.now() >= notBefore && count >= cfg.enoughTsums && held >= cfg.stillReads) {
      full = true;
      break;
    }
    ts.sleep(cfg.pollMs);
    const now = gastonCountTsums(ts);
    held = now > count + cfg.countNoise ? 0 : held + 1;
    count = now;
    if (count > peak) { peak = count; }
    gastonWatchAntlers(ts);
  }
  // The last of the refill is still falling (`landMs`).
  if (full) { ts.sleep(cfg.landMs); }
  return { peak: peak, full: full };
}

/**
 * Spam the skill button from the held chain's release until the gauge reads
 * full. Taps on a filling gauge are ignored and the first after it fills fires,
 * so the next window is opened from here, not by `useSkill`. Stops at `until`
 * or when the round ends.
 */
function gastonSpamSkill(ts: Tsum, until: number): GastonCharge {
  const cfg = GastonConfig;
  const charge: GastonCharge = { taps: 0, ready: false, onBoard: true };
  let checkedAt = Date.now();
  while (ts.isRunning && Date.now() < until) {
    if (Date.now() - checkedAt >= cfg.spamPageCheckMs) {
      checkedAt = Date.now();
      if (gastonRoundOver()) { charge.onBoard = false; return charge; }
    }
    ts.tap(Button.gameSkill1, cfg.spamTapMs);
    charge.taps++;
    if (ts.checkSkillReadinessFast() === SkillReadiness.Active) { charge.ready = true; return charge; }
    gastonWatchAntlers(ts);
  }
  return charge;
}

/** The Gastons on the board: the points of its biggest colour cluster. */
function gastonGastons(ts: Tsum, board: BoardPoint[]): BoardPoint[] {
  const sizes: number[] = [];
  for (let c = 0; c < ts.boardClusters.length; c++) { sizes.push(0); }
  for (let i = 0; i < board.length; i++) {
    const c = +board[i].tsumIdx;
    if (c >= 0 && c < sizes.length) { sizes[c]++; }
  }
  let biggest = -1;
  for (let c = 0; c < sizes.length; c++) {
    if (sizes[c] > 0 && (biggest < 0 || sizes[c] > sizes[biggest])) { biggest = c; }
  }
  const out: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    if (+board[i].tsumIdx === biggest) { out.push(board[i]); }
  }
  return out;
}

/**
 * The bubbles on the board, in play-square scale, from a capture extending
 * `bubbleHem` below the play square (such centres have y past `playResizeHeight`).
 * Returned in order: a Hough pass at `hardParam2`; one at `bandParam2` over the
 * bottom `bubbleBandFrom` (`band`); with `board`, its gold circles there
 * (`bubbleGold`, `gold`); remembered ones (`soft`). Hough finds must pass
 * `gastonBubbleLooks`; a find within `minDist` of an earlier one is dropped.
 */
function gastonBubbles(ts: Tsum, board?: BoardPoint[]): GameBubble[] {
  const cfg = GastonConfig;
  const bc = GameBubbleConfig;
  const hem = cfg.bubbleHem;
  const h = Math.min(Math.round(ts.playHeight * (1 + hem)), ts.screenHeight - ts.playOffsetY);
  const outH = Math.round(ts.playResizeHeight * h / ts.playHeight);
  const img = getScreenshotModify(ts.playOffsetX, ts.playOffsetY, ts.playWidth, h,
    ts.playResizeWidth, outH, 100);
  let gray: NativeImage | null = null;
  const hard: GameBubble[] = [];
  const low: GameBubble[] = [];
  const bandFrom = outH * cfg.bubbleBandFrom;
  let gold: Point[] = [];
  let hardKept: GameBubble[];
  let lowKept: GameBubble[];
  try {
    gray = buildBoardGray(img);
    const found = houghCircles(gray, 3, 1, bc.minDist, bc.param1, cfg.hardParam2, bc.minRadius, bc.maxRadius);
    for (let k = 0; k < found.length; k++) { hard.push({ x: found[k].x, y: found[k].y, r: found[k].radius }); }
    const band = houghCircles(gray, 3, 1, bc.minDist, bc.param1, cfg.bandParam2, bc.minRadius, cfg.bandMaxRadius);
    for (let k = 0; k < band.length; k++) {
      if (band[k].y < bandFrom) { continue; }
      low.push({ x: band[k].x, y: band[k].y, r: band[k].radius, band: true });
    }
    hardKept = gastonBubbleLooks(img, gastonNotButtons(hard));
    lowKept = gastonBubbleLooks(img, gastonNotButtons(low));
    if (board) { gold = gastonGoldCircles(img, board, bandFrom); }
  } finally {
    if (gray != null) { releaseImage(gray); }
    releaseImage(img);
  }
  const out = hardKept.slice();
  for (let k = 0; k < lowKept.length; k++) {
    if (!gastonBubbleNear(lowKept[k], out, bc.minDist)) { out.push(lowKept[k]); }
  }
  for (let k = 0; k < gold.length; k++) {
    if (!gastonBubbleNear(gold[k], out, bc.minDist)) {
      out.push({ x: gold[k].x, y: gold[k].y, r: (bc.minRadius + bc.maxRadius) / 2, gold: true });
    }
  }
  return gastonRememberBubbles(ts, out);
}

/**
 * `circles` less those that don't look like a bubble inside: too much dark or
 * white (`bubbleDarkMax`, `bubbleWhiteMax`) in the disc at 0.7 of the radius.
 */
function gastonBubbleLooks(img: NativeImage, circles: GameBubble[]): GameBubble[] {
  const cfg = GastonConfig;
  const size = getImageSize(img);
  const pts: Point[] = [];
  const per: number[] = [];
  for (let k = 0; k < circles.length; k++) {
    const c = circles[k];
    const r = 0.7 * (c.r || GameBubbleConfig.minRadius);
    let n = 0;
    for (let dx = -r; dx <= r; dx += 2) {
      for (let dy = -r; dy <= r; dy += 2) {
        if (dx * dx + dy * dy > r * r) { continue; }
        const x = Math.round(c.x + dx);
        const y = Math.round(c.y + dy);
        if (x < 0 || y < 0 || x >= size.width || y >= size.height) { continue; }
        pts.push({ x: x, y: y });
        n++;
      }
    }
    per.push(n);
  }
  if (pts.length === 0) { return circles; }
  const colors = getImageColors(img, pts);
  const out: GameBubble[] = [];
  let at = 0;
  for (let k = 0; k < circles.length; k++) {
    let dark = 0;
    let white = 0;
    for (let n = 0; n < per[k]; n++) {
      const c = colors[at + n];
      const hi = Math.max(c.r, c.g, c.b);
      const lo = Math.min(c.r, c.g, c.b);
      if (hi < 64) { dark++; }
      if (hi > 217 && hi - lo < 0.25 * hi) { white++; }
    }
    at += per[k];
    if (per[k] === 0 || (dark <= cfg.bubbleDarkMax * per[k] && white <= cfg.bubbleWhiteMax * per[k])) {
      out.push(circles[k]);
    }
  }
  return out;
}

/** The bubbles a cancel may tap: all but remembered (`soft`) ones. */
function gastonTappableBubbles(bubbles: GameBubble[]): GameBubble[] {
  const out: GameBubble[] = [];
  for (let i = 0; i < bubbles.length; i++) {
    if (!bubbles[i].soft) { out.push(bubbles[i]); }
  }
  return out;
}

/** Whether `b` is within `dist` (play-square units) of any of `list`. */
function gastonBubbleNear(b: Point, list: Point[], dist: number): boolean {
  for (let i = 0; i < list.length; i++) {
    const dx = list[i].x - b.x;
    const dy = list[i].y - b.y;
    if (dx * dx + dy * dy < dist * dist) { return true; }
  }
  return false;
}

/**
 * Merge this read into the round's bubble memory. Returns the read plus every
 * remembered bubble it missed (within `bubbleMatch` widths), marked `soft`.
 * Bubbles unseen for `bubbleMemoryMs` are forgotten; a new round starts empty.
 */
function gastonRememberBubbles(ts: Tsum, read: GameBubble[]): GameBubble[] {
  const cfg = GastonConfig;
  const now = Date.now();
  if (gastonBubbleRound !== ts.roundStartedAt) {
    gastonBubbleMemory = [];
    gastonBubbleRound = ts.roundStartedAt;
  }
  const match = Config.tsumWidth * cfg.bubbleMatch;
  const out = read.slice();
  const next: GameBubble[] = [];
  for (let i = 0; i < read.length; i++) {
    next.push({ x: read[i].x, y: read[i].y, r: read[i].r, lastSeen: now });
  }
  for (let k = 0; k < gastonBubbleMemory.length; k++) {
    const old = gastonBubbleMemory[k];
    if (gastonBubbleNear(old, read, match)) { continue; }
    if (now - (old.lastSeen || 0) > cfg.bubbleMemoryMs) { continue; }
    next.push(old);
    out.push({ x: old.x, y: old.y, r: old.r, soft: true });
  }
  gastonBubbleMemory = next;
  return out;
}

/** A cancel tapped `b`: it is gone, so the memory drops it. */
function gastonForgetBubble(b: Point): void {
  const match = Config.tsumWidth * GastonConfig.bubbleMatch;
  gastonBubbleMemory = gastonBubbleMemory.filter(function(p) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    return dx * dx + dy * dy >= match * match;
  });
}

/**
 * The bubbles less the two round HUD buttons the hem brings into the capture
 * (`hemButtons`), which the Hough reads as bubbles.
 */
function gastonNotButtons(bubbles: GameBubble[]): GameBubble[] {
  const cfg = GastonConfig;
  const avoid = Config.tsumWidth * cfg.hemButtonAvoid;
  const avoidSq = avoid * avoid;
  const out: GameBubble[] = [];
  for (let b = 0; b < bubbles.length; b++) {
    let button = false;
    for (let k = 0; k < cfg.hemButtons.length; k++) {
      const dx = bubbles[b].x - cfg.hemButtons[k].x;
      const dy = bubbles[b].y - cfg.hemButtons[k].y;
      if (dx * dx + dy * dy < avoidSq) { button = true; break; }
    }
    if (!button) { out.push(bubbles[b]); }
  }
  return out;
}

/**
 * Sets each bubble's `near` to the non-Gaston tsums in its blast (radius plus
 * `GameBubbleConfig.blastReach` tsum widths), skipping the HUD band (`hudBand`).
 * `gastonCancelBubble` spends the richest first.
 */
function gastonBubbleWorth(bubbles: GameBubble[], board: BoardPoint[], gastons: BoardPoint[]): void {
  const half = Config.tsumWidth / 2;
  const hud = Config.tsumWidth * GastonConfig.hudBand;
  const blast = GameBubbleConfig.blastReach * Config.tsumWidth;
  for (let b = 0; b < bubbles.length; b++) {
    const reach = bubbles[b].r + blast;
    const reachSq = reach * reach;
    let near = 0;
    for (let i = 0; i < board.length; i++) {
      const cy = board[i].y + half;
      if (cy < hud || gastons.indexOf(board[i]) >= 0) { continue; }
      const dx = board[i].x + half - bubbles[b].x;
      const dy = cy - bubbles[b].y;
      if (dx * dx + dy * dy <= reachSq) { near++; }
    }
    bubbles[b].near = near;
  }
}

/**
 * The board minus what the drag must not touch: tsums on a bubble (crossing one
 * pops it and ends the chain) and circles in the top HUD band, `band` tsum
 * widths deep, where HUD glyphs read as tsums.
 */
function gastonFreeBoard(board: BoardPoint[], bubbles: GameBubble[], band: number): BoardPoint[] {
  const half = Config.tsumWidth / 2;
  const hud = Config.tsumWidth * band;
  const avoid = Config.tsumWidth * GastonConfig.bubbleAvoid;
  const avoidSq = avoid * avoid;
  const out: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    const cx = board[i].x + half;
    const cy = board[i].y + half;
    if (cy < hud) { continue; }
    let clear = true;
    for (let b = 0; b < bubbles.length; b++) {
      const dx = bubbles[b].x - cx;
      const dy = bubbles[b].y - cy;
      if (dx * dx + dy * dy < avoidSq) { clear = false; break; }
    }
    if (clear) { out.push(board[i]); }
  }
  return out;
}

/** The board's leftovers: every point outside the Gaston cluster and the HUD band (`hudBand`). */
function gastonLeftovers(board: BoardPoint[], gastons: BoardPoint[]): BoardPoint[] {
  const hud = Config.tsumWidth * GastonConfig.hudBand - Config.tsumWidth / 2;
  const out: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i].y >= hud && gastons.indexOf(board[i]) < 0) { out.push(board[i]); }
  }
  return out;
}

/** `board` less every point within half a tsum of `avoid` -- the dead start of a replan. */
function gastonWithout(board: BoardPoint[], avoid: Point): BoardPoint[] {
  const near = Config.tsumWidth / 2;
  const nearSq = near * near;
  const out: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    const dx = board[i].x - avoid.x;
    const dy = board[i].y - avoid.y;
    if (dx * dx + dy * dy >= nearSq) { out.push(board[i]); }
  }
  return out;
}

// --- The chain --------------------------------------------------------------

/** Whether the segment `a`-`b` passes within `rSq` (squared) of `p`. */
function gastonSegmentNear(a: Point, b: Point, p: Point, rSq: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const ex = a.x + t * dx - p.x;
  const ey = a.y + t * dy - p.y;
  return ex * ex + ey * ey < rSq;
}

/**
 * The hops the drag may draw over `board`: `buildTsumNeighbors`' reach, less
 * hops passing within `crossAvoid` of a third tsum's centre or inside a bubble,
 * since the game links whatever the line crosses.
 */
function gastonNeighbors(board: BoardPoint[], bubbles: GameBubble[]): number[][] {
  const half = Config.tsumWidth / 2;
  const reachSq = Config.tsumWidth * GastonConfig.hopReach * Config.tsumWidth * GastonConfig.hopReach;
  const cross = Config.tsumWidth * GastonConfig.crossAvoid;
  const crossSq = cross * cross;
  const centres: Point[] = [];
  for (let i = 0; i < board.length; i++) { centres.push({ x: board[i].x + half, y: board[i].y + half }); }
  const neighbors = buildTsumNeighbors(centres, reachSq);
  for (let i = 0; i < neighbors.length; i++) {
    const kept: number[] = [];
    for (let k = 0; k < neighbors[i].length; k++) {
      const j = neighbors[i][k];
      let clean = true;
      for (let o = 0; o < centres.length && clean; o++) {
        if (o !== i && o !== j && gastonSegmentNear(centres[i], centres[j], centres[o], crossSq)) { clean = false; }
      }
      for (let b = 0; b < bubbles.length && clean; b++) {
        if (gastonSegmentNear(centres[i], centres[j], bubbles[b], bubbles[b].r * bubbles[b].r)) { clean = false; }
      }
      if (clean) { kept.push(j); }
    }
    neighbors[i] = kept;
  }
  return neighbors;
}

/**
 * The chain to draw over `board` (the Gastons the drag may touch): the longest
 * path `findLongestTsumPath` finds in any connected component, from any start.
 * Components go biggest first, each searched alone so the search's memo applies
 * (31 tsums or fewer); stops once no remaining component can beat the best.
 */
function gastonChain(board: BoardPoint[], bubbles: GameBubble[]): TsumPath | null {
  const cfg = GastonConfig;
  if (board.length < cfg.minChain) { return null; }
  const neighbors = gastonNeighbors(board, bubbles);
  const comps = findTsumComponents(neighbors);
  comps.sort(function(a, b) { return b.length - a.length; });
  let best: TsumPath = [] as TsumPath;
  for (let c = 0; c < comps.length; c++) {
    const comp = comps[c];
    if (comp.length <= best.length || comp.length < cfg.minChain) { break; }
    // Reuse the whole board's hops, renumbered, so other components' tsums
    // still count as obstacles.
    const points: BoardPoint[] = [];
    const all: number[] = [];
    const local: number[] = [];
    for (let i = 0; i < board.length; i++) { local.push(-1); }
    for (let i = 0; i < comp.length; i++) { points.push(board[comp[i]]); all.push(i); local[comp[i]] = i; }
    const sub: number[][] = [];
    for (let i = 0; i < comp.length; i++) {
      const row: number[] = [];
      const nbrs = neighbors[comp[i]];
      for (let k = 0; k < nbrs.length; k++) { row.push(local[nbrs[k]]); }
      sub.push(row);
    }
    const route = findLongestTsumPath(sub, all, cfg.searchSteps).path;
    if (route.length > best.length) {
      best = [] as TsumPath;
      for (let i = 0; i < route.length; i++) { best.push(points[route[i]]); }
    }
  }
  return best.length >= cfg.minChain ? best : null;
}

/** The longest chain from `head` (the finger is already on it) over `gastons`; null under `minChain`. */
function gastonChainFrom(head: BoardPoint, gastons: BoardPoint[], bubbles: GameBubble[]): TsumPath | null {
  const cfg = GastonConfig;
  const points: BoardPoint[] = [head];
  for (let i = 0; i < gastons.length; i++) {
    if (gastons[i] !== head) { points.push(gastons[i]); }
  }
  if (points.length < cfg.minChain) { return null; }
  const route = findLongestTsumPath(gastonNeighbors(points, bubbles), [0], cfg.searchSteps).path;
  if (route.length < cfg.minChain) { return null; }
  const path: TsumPath = [] as TsumPath;
  for (let i = 0; i < route.length; i++) { path.push(points[route[i]]); }
  return path;
}

/**
 * Pick which end the drag starts from. The bottom of a refilled board is where
 * the scan is least reliable, so start from the higher end; an end touching a
 * leftover (`frontierAvoid`) loses regardless of height.
 */
function gastonOrient(path: TsumPath | null, leftovers: BoardPoint[]): TsumPath | null {
  if (!path || path.length < 2) { return path; }
  if (gastonEndRisk(path[path.length - 1], leftovers) < gastonEndRisk(path[0], leftovers)) {
    path.reverse();
  }
  return path;
}

/** An end's risk as a start: its y, plus the board's height if it touches a leftover. */
function gastonEndRisk(end: BoardPoint, leftovers: BoardPoint[]): number {
  const avoid = Config.tsumWidth * GastonConfig.frontierAvoid;
  const avoidSq = avoid * avoid;
  for (let i = 0; i < leftovers.length; i++) {
    const dx = leftovers[i].x - end.x;
    const dy = leftovers[i].y - end.y;
    if (dx * dx + dy * dy < avoidSq) { return end.y + Config.screenResize; }
  }
  return end.y;
}

/** Tsums in the board's biggest colour cluster, for the log. */
function gastonBiggestCluster(board: BoardPoint[]): number {
  const sizes: { [tsumIdx: string]: number } = {};
  let biggest = 0;
  for (let i = 0; i < board.length; i++) {
    const n = (sizes[board[i].tsumIdx] || 0) + 1;
    sizes[board[i].tsumIdx] = n;
    if (n > biggest) { biggest = n; }
  }
  return biggest;
}

// --- Drawing it -------------------------------------------------------------

/** A board point as the screen coordinate the touch natives want. */
function gastonToScreen(ts: Tsum, p: BoardPoint): Point {
  return {
    x: Math.floor(ts.playOffsetX
      + (p.x + Config.tsumWidth / 2) * ts.playWidth / ts.playResizeWidth),
    y: Math.floor(ts.playOffsetY
      + (p.y + Config.tsumWidth / 2) * ts.playHeight / ts.playResizeHeight),
  };
}

/** What a drag came to: its length, how much of that was the game's, and whether it was held. */
interface GastonDrag {
  /** The route drawn: the plan, or the paint read's plan from its head. Empty when nothing was. */
  path: TsumPath;
  /** Grab to release less the hold, in ms. */
  ms: number;
  /** Time beyond dwells and settles: the native calls themselves. */
  overMs: number;
  /** The finger stayed on the last tsum until the window had closed. */
  held: boolean;
  /** How long it stayed there past the drag, in ms; 0 when released at once. */
  heldMs: number;
  /** Epoch ms of the release, 0 when nothing was drawn. */
  releasedAt: number;
  /** The paint read lifted the finger: the head painted nothing, so it was not Gaston. */
  dead: boolean;
  /** The paint read lifted the finger on a head that painted too few (`strayPaint`). */
  stray: boolean;
  /** Circles the paint read found to be Gaston; null when it did not run. */
  gastons: BoardPoint[] | null;
  /** Median rise over the circles that rose, or over all when none did; null when unread. */
  rise: number | null;
  /** Every circle's rise in `board` order, for the log; null when unread. */
  rises: number[] | null;
  /** Centres the read found not to be Gaston, for `gastonCarry`. Empty without a read. */
  leftovers: Point[];
  /** The game's chain counter, read `settleMs` after the last move with the finger down; null when nothing was drawn. */
  count: ChainCount | null;
  /** The counter again just before a held chain's release; null unless held. */
  countLate: ChainCount | null;
  /** Each rewind as [route index the finger was on, index it walked back to] (see `rewind`). */
  rewinds: number[][];
  /** The game's count at each coin stall (`chainCounterRead`), -1 unread. */
  stallCounts: number[];
  /** Coin stalls the count overruled (`countSlack`). */
  countKept: number;
  /** The last coin check over the route, 'C' or '.' per tsum from `coinFrom`; null when none ran. */
  coins: string | null;
  /** A stopped drag's route before `path` was cut to what it linked; null otherwise. */
  planned: TsumPath | null;
  /** Epoch ms of the grab. */
  startedAt: number;
  /** When the schedule wanted the drag done (`nextPassMs`), and whether it was the closing chain. */
  slotEnd: number;
  closing: boolean;
  /** How long a closing drag paused through the close; 0 when it did not cross it. */
  pausedMs: number;
  /** Tsums cut off the route's end to fit its slot (`nextPassMs`, `closeChainMax`, `closeLeadMs`). */
  trimmed: number;
}

/** A drag's place in the window's schedule: when it should be done, and whether it closes the window. */
interface GastonSlot {
  end: number;
  closing: boolean;
  /** The last cancelled pass: a redraw may run `rewindGraceMs` past `end`. */
  last: boolean;
}

/**
 * The paint read a drag may make with the finger on its head: the scan's
 * circles to classify, and a planner from the head over the Gastons found.
 */
interface GastonOracle {
  board: BoardPoint[];
  plan: (head: BoardPoint, gastons: BoardPoint[]) => TsumPath | null;
  /** A head painting fewer than this (the head included) is lifted as a lookalike (`strayPaint`); 0 never. */
  strayBelow: number;
}

/** The lower median of `values`. */
function gastonMedian(values: number[]): number {
  const sorted = values.slice().sort(function(a, b) { return a - b; });
  return sorted[(sorted.length - 1) >> 1];
}

/**
 * Each circle's floor: the median darkest channel over a grid around its
 * centre, from one play-square capture. The pale paint on a live chain's
 * Gastons lifts it, while the sprite's own colours barely do (`paintRise`).
 */
function gastonFloorRead(ts: Tsum, board: BoardPoint[]): number[] {
  const cfg = GastonConfig;
  const half = Config.tsumWidth / 2;
  const pts: Point[] = [];
  for (let c = 0; c < board.length; c++) {
    for (let i = -cfg.paintGrid; i <= cfg.paintGrid; i++) {
      for (let j = -cfg.paintGrid; j <= cfg.paintGrid; j++) {
        pts.push({
          x: Math.round(board[c].x + half + i * cfg.paintStep),
          y: Math.round(board[c].y + half + j * cfg.paintStep),
        });
      }
    }
  }
  const img = ts.playScreenshotSquare();
  let colors: Color[];
  try {
    colors = getImageColors(img, pts);
  } finally {
    releaseImage(img);
  }
  const per = (2 * cfg.paintGrid + 1) * (2 * cfg.paintGrid + 1);
  const out: number[] = [];
  for (let c = 0; c < board.length; c++) {
    const floors: number[] = [];
    for (let k = 0; k < per; k++) {
      const col = colors[c * per + k];
      floors.push(Math.min(col.r, col.g, col.b));
    }
    out.push(gastonMedian(floors));
  }
  return out;
}

/** Red brightest and over 0.82, saturation over 0.5, hue 36-60: the game's gold. */
function gastonGold(c: { r: number, g: number, b: number }): boolean {
  return c.r >= c.g && c.r > 209 && c.r - c.b > 0.5 * c.r && c.g - c.b > 0.6 * (c.r - c.b);
}

/**
 * Centres of `board`'s circles below `fromY` that read at least `bubbleGold`
 * gold in `img`: bubbles the scan took for tsums.
 */
function gastonGoldCircles(img: NativeImage, board: BoardPoint[], fromY: number): Point[] {
  const cfg = GastonConfig;
  const half = Config.tsumWidth / 2;
  const size = getImageSize(img);
  const pts: Point[] = [];
  const at: Point[] = [];
  for (let k = 0; k < board.length; k++) {
    const cx = board[k].x + half;
    const cy = board[k].y + half;
    if (cy < fromY) { continue; }
    at.push({ x: cx, y: cy });
    for (let i = -cfg.coinGrid; i <= cfg.coinGrid; i++) {
      for (let j = -cfg.coinGrid; j <= cfg.coinGrid; j++) {
        pts.push({
          x: Math.min(size.width - 1, Math.max(0, Math.round(cx + i * cfg.coinStep))),
          y: Math.min(size.height - 1, Math.max(0, Math.round(cy + j * cfg.coinStep))),
        });
      }
    }
  }
  if (at.length === 0) { return []; }
  const colors = getImageColors(img, pts);
  const per = (2 * cfg.coinGrid + 1) * (2 * cfg.coinGrid + 1);
  const out: Point[] = [];
  for (let k = 0; k < at.length; k++) {
    let gold = 0;
    for (let n = 0; n < per; n++) { if (gastonGold(colors[k * per + n])) { gold++; } }
    if (gold >= cfg.bubbleGold * per) { out.push(at[k]); }
  }
  return out;
}

/** Whether each of `path[from..to]` shows the gold coin of a linked tsum in `img` (see `rewind`). */
function gastonCoins(img: NativeImage, path: TsumPath, from: number, to: number): boolean[] {
  const cfg = GastonConfig;
  const half = Config.tsumWidth / 2;
  const size = getImageSize(img);
  const maxX = size.width - 1;
  const maxY = size.height - 1;
  const pts: Point[] = [];
  for (let k = from; k <= to; k++) {
    for (let i = -cfg.coinGrid; i <= cfg.coinGrid; i++) {
      for (let j = -cfg.coinGrid; j <= cfg.coinGrid; j++) {
        pts.push({
          x: Math.min(maxX, Math.max(0, Math.round(path[k].x + half + i * cfg.coinStep))),
          y: Math.min(maxY, Math.max(0, Math.round(path[k].y + half + j * cfg.coinStep))),
        });
      }
    }
  }
  const colors = getImageColors(img, pts);
  const per = (2 * cfg.coinGrid + 1) * (2 * cfg.coinGrid + 1);
  const out: boolean[] = [];
  for (let k = 0; k <= to - from; k++) {
    let gold = 0;
    for (let n = 0; n < per; n++) {
      const c = colors[k * per + n];
      if (gastonGold(c)) { gold++; }
    }
    out.push(gold >= cfg.coinShare * per);
  }
  return out;
}

/**
 * Whether the chain stopped growing behind the finger on `path[at]`. Returns -1
 * when a coin shows on the `checkSpan` tsums ending `coinLag` behind it (or it
 * is too early to tell), else the route index to walk back to: the last coin
 * before the gap, 0 with none. `end` reads up to the finger and fills `drag.coins`.
 */
function gastonStalled(ts: Tsum, path: TsumPath, at: number, end: boolean, drag: GastonDrag): number {
  const cfg = GastonConfig;
  const last = end ? at : at - cfg.coinLag;
  const first = Math.max(cfg.coinFrom, last - cfg.checkSpan + 1);
  if (last - first + 1 < cfg.checkMinSpan) { return -1; }
  const img = ts.playScreenshotSquare();
  try {
    const span = gastonCoins(img, path, first, last);
    let back = -1;
    if (span.indexOf(true) < 0) {
      back = 0;
      const before = first > cfg.coinBackFrom ? gastonCoins(img, path, cfg.coinBackFrom, first - 1) : [];
      for (let k = before.length - 1; k >= 0; k--) {
        if (before[k]) { back = cfg.coinBackFrom + k; break; }
      }
    }
    if (end) {
      const all = gastonCoins(img, path, cfg.coinFrom, last);
      drag.coins = all.map(function(c) { return c ? 'C' : '.'; }).join('');
    }
    return back;
  } finally {
    releaseImage(img);
  }
}

/**
 * Draw the chain, dwelling `dwellMs` on each tsum, and release it: at once, or
 * held until `holdUntil` when `holds(headAt, chain)` says it is the closing one.
 * With `oracle`, `path` is only the head: the game's paint read (`paintRise`)
 * picks the Gastons and the route is planned over them; a head that painted
 * under `minChain - 1` comes up at once (`dead`). The finger always comes up.
 */
function gastonLinkChain(ts: Tsum, path: TsumPath, holds: (headAt: number, chain: number) => boolean,
    holdUntil: number, closeAt: number, slot: (now: number) => GastonSlot, oracle: GastonOracle | null): GastonDrag {
  const drag: GastonDrag = {
    path: [] as TsumPath, ms: 0, overMs: 0, held: false, heldMs: 0, releasedAt: 0,
    dead: false, stray: false, gastons: null, rise: null, rises: null, leftovers: [], count: null, countLate: null,
    rewinds: [], stallCounts: [], countKept: 0, coins: null, trimmed: 0, planned: null, startedAt: 0, slotEnd: 0, closing: false, pausedMs: 0,
  };
  // A stopped run draws no new chain, as in `linkTsums`.
  if (!ts.isRunning || path.length < 1 || (oracle === null && path.length < 2)) { return drag; }
  const cfg = GastonConfig;
  const half = Config.tsumWidth / 2;
  const base = oracle !== null ? gastonFloorRead(ts, oracle.board) : null;
  const from = Date.now();
  drag.startedAt = from;
  const dwellMs = GastonConfig.dwellMs;
  const head = gastonToScreen(ts, path[0]);
  tapDown(head.x, head.y, cfg.grabMs);
  // The host never lifts the finger itself, so a throw must, or it drags on.
  let finger: Point = head;
  let down = true;
  try {
    moveTo(head.x, head.y, dwellMs);
    if (oracle !== null && base !== null) {
      const rest = cfg.paintMs - cfg.grabMs - dwellMs;
      if (rest > 0) { ts.sleep(rest); }
      const now = gastonFloorRead(ts, oracle.board);
      const gastons: BoardPoint[] = [];
      const rises: number[] = [];
      const all: number[] = [];
      for (let k = 0; k < now.length; k++) {
        const rise = now[k] - base[k];
        all.push(rise);
        if (oracle.board[k] === path[0]) { continue; }
        if (rise >= cfg.paintRise) {
          gastons.push(oracle.board[k]);
          rises.push(rise);
        } else {
          drag.leftovers.push({ x: oracle.board[k].x + half, y: oracle.board[k].y + half });
        }
      }
      drag.gastons = gastons;
      drag.rise = gastonMedian(rises.length > 0 ? rises : all);
      drag.rises = all;
      const stray = gastons.length + 1 < oracle.strayBelow;
      const planned = !stray && gastons.length + 1 >= cfg.minChain ? oracle.plan(path[0], gastons) : null;
      if (planned === null) {
        drag.dead = gastons.length + 1 < cfg.minChain;
        drag.stray = stray && !drag.dead;
        // A head that painted nothing said nothing about the rest.
        if (drag.dead) { drag.leftovers = []; }
        drag.releasedAt = Date.now();
        down = false;
        tapUp(head.x, head.y, cfg.releaseMs);
        drag.ms = Date.now() - from;
        return drag;
      }
      path = planned;
    }
    // Cut the closing chain to what fits before the close (less its end read),
    // at least `closeChainMax`. A cancelled chain is cut live, below.
    const perHop = dwellMs + cfg.hopOverMs;
    const sl = slot(Date.now());
    drag.slotEnd = sl.end;
    drag.closing = sl.closing;
    if (sl.closing) {
      const fits = Math.floor((sl.end - Date.now() - cfg.coinSettleMs) / perHop) + 1;
      const keep = Math.max(fits, cfg.closeChainMax);
      if (keep < path.length) {
        drag.trimmed = path.length - keep;
        path = path.slice(0, keep) as TsumPath;
      }
    }
    let until = sl.end;
    // A closing drag that runs into the close stands still on its last tsum
    // through it, and goes on once the antlers leave (`gastonAwaitClose`).
    let pauseAt = sl.closing && sl.end > Date.now() ? sl.end : 0;
    drag.path = path;
    const pts: Point[] = [head];
    for (let i = 1; i < path.length; i++) { pts.push(gastonToScreen(ts, path[i])); }
    let hops = 0;
    let settled = 0;
    const hop = function(b: number): void {
      moveTo(pts[b].x, pts[b].y, dwellMs);
      finger = pts[b];
      hops++;
    };
    // A route on from `path[back]` over the read's Gastons, skipping `path` up
    // to `skip`, whose first hop is short enough to take (`replanFirstHop`).
    const replan = function(back: number, skip: number): TsumPath | null {
      if (oracle === null || drag.gastons === null) { return null; }
      const out: BoardPoint[] = path.slice(0, skip + 1);
      const reach = cfg.replanFirstHop * Config.tsumWidth;
      for (let t = 0; t < 3; t++) {
        const left = drag.gastons.filter(function(g) { return out.indexOf(g) < 0; });
        const next = oracle.plan(path[back], left);
        if (next === null || next.length < 2) { return null; }
        const dx = next[1].x - next[0].x;
        const dy = next[1].y - next[0].y;
        if (dx * dx + dy * dy <= reach * reach) { return next; }
        out.push(next[1]);
      }
      return null;
    };
    let tail = pts.length - 1;
    let lastBack = -1;
    let lastCount: number | null = null;
    const hopsFrom = Date.now();
    let i = 1;
    while (i <= tail) {
      if (pauseAt > 0 && Date.now() + perHop > pauseAt) {
        drag.pausedMs = gastonAwaitClose(ts, closeAt, holdUntil);
        pauseAt = 0;
      }
      // A cancelled chain ends at the hop that would run past `until`, keeping
      // `cancelMinChain`. A chain that will be held is never cut.
      if (!sl.closing && i >= cfg.cancelMinChain && !holds(Date.now(), tail + 1)) {
        const hopMs = Math.max(dwellMs, (Date.now() - hopsFrom) / Math.max(1, hops));
        if (Date.now() + hopMs > until) {
          drag.trimmed += tail - i + 1;
          tail = i - 1;
          path = path.slice(0, i) as TsumPath;
          pts.length = i;
          drag.path = path;
          break;
        }
      }
      hop(i);
      const end = i === tail;
      const spare = drag.rewinds.length < cfg.maxRewinds;
      // Only a held chain's end is checked; a released one goes out as it
      // stands to save slot time. Mid-drag checks only while a rewind is left.
      const quick = end && !drag.closing && !holds(Date.now(), path.length);
      if (cfg.rewind && (end ? !quick : spare && i % cfg.checkEvery === 0)) {
        if (end) {
          ts.sleep(cfg.coinSettleMs);
          settled += cfg.coinSettleMs;
        }
        let back = gastonStalled(ts, path, i, end, drag);
        let count: number | null = null;
        if (back >= 0 && spare) {
          // The game's count beats the coins: within `countSlack` of the
          // finger there is no stall, else walk back no further than it.
          count = chainCounterRead(ts, chainRouteCentres(path.slice(0, i + 1))).value;
          drag.stallCounts.push(count !== null ? count : -1);
          if (count !== null && count >= i + 1 - cfg.countSlack) {
            back = -1;
            drag.countKept++;
          } else if (count !== null && count - 1 > back && count - 1 < i) {
            back = count - 1;
          }
        }
        if (back >= 0 && spare) {
          // Walk back to the tsum before the last coin (a coin linked early
          // leaves its predecessor the real end) and redraw a fresh route,
          // clear of the failing tsum on a repeat, else the old one. A repeat
          // with no route, or a walk back into the close, stops the drag.
          const again = lastBack >= 0 && back <= lastBack + 1;
          lastBack = back;
          const to = back > 0 ? back - 1 : 0;
          const next = to > 0 || again ? replan(to, again ? back + 1 : back) : null;
          const late = Date.now() < closeAt && Date.now() + 2 * (i - to) * perHop > closeAt - cfg.closeLeadMs;
          // A cancelled chain goes out as it stands after one redraw, or at
          // `stopFrom` linked with no room left: the next pass gains more. A
          // closing chain stops when the count has not moved since the last
          // stall (the game is not linking). A count under the last coin is a
          // misread.
          const linked = count !== null ? Math.max(count, back + 1) : back + 1;
          const room = sl.last ? until + cfg.rewindGraceMs - Date.now() >= cfg.lastRewindRoomMs
            : until - Date.now() >= cfg.firstRewindRoomMs;
          const settle = !sl.closing && (drag.rewinds.length > 0 || (linked >= cfg.stopFrom && !room));
          const flat = sl.closing && count !== null && lastCount !== null && count <= lastCount;
          if (count !== null) { lastCount = count; }
          if (late || settle || flat || (again && next === null)) {
            drag.rewinds.push([i, back, 0]);
            // What it linked, for the pop, the hold and the charge.
            drag.planned = path;
            path = path.slice(0, back + 1) as TsumPath;
            drag.path = path;
            break;
          }
          // Stuck at the head: up, and down again on the route's far end.
          if (linked <= cfg.restartBelow && drag.rewinds.length === 0
              && tail - cfg.restartSkip + 1 >= cfg.minChain) {
            drag.rewinds.push([i, -1]);
            down = false;
            tapUp(finger.x, finger.y, cfg.releaseMs);
            path = path.slice(cfg.restartSkip, tail + 1).reverse() as TsumPath;
            pts.length = 0;
            for (let k = 0; k < path.length; k++) { pts.push(gastonToScreen(ts, path[k])); }
            tail = pts.length - 1;
            drag.path = path;
            finger = pts[0];
            tapDown(finger.x, finger.y, cfg.grabMs);
            down = true;
            moveTo(finger.x, finger.y, dwellMs);
            settled += cfg.releaseMs + cfg.grabMs + dwellMs;
            lastBack = -1;
            lastCount = null;
            i = 1;
            continue;
          }
          for (let k = i - 1; k >= to; k--) { hop(k); }
          if (next !== null) {
            drag.rewinds.push([i, to, next.length - 1]);
            path = path.slice(0, to).concat(next) as TsumPath;
            pts.length = to + 1;
            for (let k = 1; k < next.length; k++) { pts.push(gastonToScreen(ts, next[k])); }
            tail = pts.length - 1;
            drag.path = path;
          } else {
            drag.rewinds.push([i, to]);
          }
          // A redraw still ends at the slot; the last cancel gets `rewindGraceMs` more.
          if (!sl.closing && sl.last) { until = sl.end + cfg.rewindGraceMs; }
          i = to + 1;
          continue;
        }
      }
      i++;
    }
    const headAt = Date.now();
    // The game's own chain count, finger still down (chainCounter.ts). Held
    // chains only; a released one goes out at once (see `quick`).
    const route = chainRouteCentres(path);
    if (drag.closing || holds(headAt, path.length)) {
      ts.sleep(ChainCounterConfig.settleMs);
      drag.count = chainCounterRead(ts, route);
      drag.held = true;
      // Hold until the antlers have been gone `antlerReleaseMs`, and no earlier
      // than `antlerEarlyMs` before the close: an early release loses the
      // charge. `holdUntil` caps it, and is the whole hold if none were seen.
      while (ts.isRunning && Date.now() < holdUntil) {
        if (gastonAntlers.onAt > 0) {
          gastonWatchAntlers(ts);
          if (gastonAntlers.up === 0 && Date.now() >= gastonAntlers.offAt + cfg.antlerReleaseMs
              && Date.now() >= closeAt - cfg.antlerEarlyMs) { break; }
        }
        ts.sleep(Math.min(cfg.holdSliceMs, holdUntil - Date.now()));
      }
      drag.countLate = chainCounterRead(ts, route);
      drag.heldMs = Date.now() - headAt;
    }
    // Where the finger is: the route's end, or where a stalled drag stopped.
    drag.releasedAt = Date.now();
    down = false;
    tapUp(finger.x, finger.y, cfg.releaseMs);
    drag.ms = Date.now() - from - drag.heldMs;
    const slept = cfg.grabMs + dwellMs * (hops + 1)
      + cfg.releaseMs + settled
      + (oracle !== null ? Math.max(0, cfg.paintMs - cfg.grabMs - dwellMs) : 0)
      + (drag.count !== null ? ChainCounterConfig.settleMs + drag.count.ms : 0);
    drag.overMs = Math.max(0, drag.ms - slept);
    return drag;
  } catch (e) {
    if (down) { tapUp(finger.x, finger.y, cfg.releaseMs); }
    throw e;
  }
}

/** What a cancel came to. */
interface GastonCancel {
  /** Bubbles tapped, remembered ones included. */
  tapped: number;
  /** Of those, remembered (`soft`) ones. */
  soft: number;
  /** Of those, found by a fresh read after the release. */
  fresh: number;
  /** Whether the count showed the clear go at once; null when unchecked. */
  confirmed: boolean | null;
  /** How far the count fell after the taps; 0 when unchecked. */
  cleared: number;
}

/**
 * Cancel the pop animation by tapping every known bubble but the reserve
 * (`gastonTapBubbles`), then check the tsum count fell by `cancelDrop`. If it
 * did not, tap any new bubbles a fresh read finds, in case the pre-drag read
 * mistook a tsum for one. `check` false taps the first set and trusts it.
 */
function gastonCancelBubble(ts: Tsum, path: TsumPath, all: GameBubble[], check: boolean): GastonCancel {
  const out: GastonCancel = { tapped: 0, soft: 0, fresh: 0, confirmed: null, cleared: 0 };
  if (!ts.isRunning) { return out; }
  const match = Config.tsumWidth * GastonConfig.bubbleMatch;
  const tapped: GameBubble[] = [];
  for (let t = 0; t < 2; t++) {
    let tier: GameBubble[];
    if (t === 0) {
      tier = all;
    } else {
      // Only worth a capture when the count can say whether it took.
      if (!check || !ts.isRunning) { break; }
      tier = gastonTappableBubbles(gastonBubbles(ts)).filter(function(b) {
        return !gastonBubbleNear(b, tapped, match);
      });
    }
    if (tier.length === 0) { continue; }
    // Read right before the taps, so a pop running since cannot pass for them.
    const before = check ? gastonCountTsums(ts) : -1;
    const went = gastonTapBubbles(ts, path, tier);
    for (let k = 0; k < tier.length; k++) { tapped.push(tier[k]); }
    out.tapped += went.length;
    for (let k = 0; k < went.length; k++) { if (went[k].soft) { out.soft++; } }
    if (t === 1) { out.fresh += went.length; }
    if (before < 0) { break; }
    const drop = before - gastonAwaitDrop(ts, before);
    out.cleared = Math.max(out.cleared, drop);
    out.confirmed = drop >= GastonConfig.cancelDrop;
    if (out.confirmed) { break; }
  }
  // The board has moved, so every other position in the list is stale too.
  ts.gameBubbles = [];
  return out;
}

/**
 * The lowest tsum count within `cancelCheckMs`, stopping once it is
 * `cancelDrop` under `before`.
 */
function gastonAwaitDrop(ts: Tsum, before: number): number {
  const cfg = GastonConfig;
  const until = Date.now() + cfg.cancelCheckMs;
  let low = before;
  while (ts.isRunning && Date.now() < until && before - low < cfg.cancelDrop) {
    ts.sleep(cfg.cancelPollMs);
    low = Math.min(low, gastonCountTsums(ts));
  }
  return low;
}

/**
 * Tap `bubbles` except the reserve (`bubbleReserve`, none after a chain of
 * `bubbleEarnChain`) and return the ones tapped. Order: freshly read before
 * remembered, then most leftovers under the blast (`gastonBubbleWorth`), then
 * furthest from the chain, whose own tsums are clearing already. The reserve
 * is the read bubble furthest from the board's middle; a lone one is tapped.
 */
function gastonTapBubbles(ts: Tsum, path: TsumPath, bubbles: GameBubble[]): GameBubble[] {
  const far: { b: GameBubble, d: number }[] = [];
  for (let b = 0; b < bubbles.length; b++) {
    // With no chain, leftovers alone set the order.
    let nearest = path.length > 0 ? Infinity : 0;
    for (let i = 0; i < path.length; i++) {
      const dx = bubbles[b].x - (path[i].x + Config.tsumWidth / 2);
      const dy = bubbles[b].y - (path[i].y + Config.tsumWidth / 2);
      const d = dx * dx + dy * dy;
      if (d < nearest) { nearest = d; }
    }
    far.push({ b: bubbles[b], d: nearest });
  }
  far.sort(function(p, q) {
    return (p.b.soft ? 1 : 0) - (q.b.soft ? 1 : 0) || (q.b.near || 0) - (p.b.near || 0) || q.d - p.d;
  });
  const reserve = path.length >= GastonConfig.bubbleEarnChain ? 0 : GastonConfig.bubbleReserve;
  if (far.length > 1 && reserve > 0) {
    const mx = ts.playResizeWidth / 2;
    const my = ts.playResizeHeight / 2;
    let keep = -1;
    let out = -1;
    for (let i = 0; i < far.length; i++) {
      const dx = far[i].b.x - mx;
      const dy = far[i].b.y - my;
      const d = (far[i].b.soft ? 0 : far[i].b.gold ? 5e8 : 1e9) + dx * dx + dy * dy;
      if (d > out) { out = d; keep = i; }
    }
    far.splice(keep, 1);
  }
  const went: GameBubble[] = [];
  const blast = GameBubbleConfig.blastReach * Config.tsumWidth;
  for (let i = 0; i < far.length; i++) {
    const x = Math.floor(ts.playOffsetX + far[i].b.x * ts.playWidth / ts.playResizeWidth);
    const y = Math.floor(ts.playOffsetY + far[i].b.y * ts.playHeight / ts.playResizeHeight);
    tap(x, y, GastonConfig.cancelTapMs);
    went.push(far[i].b);
    gastonForgetBubble(far[i].b);
    // What the blast clears refills as Gaston, so it is no longer a leftover.
    const reach = far[i].b.r + blast;
    gastonCarry = gastonCarry.filter(function(p) {
      const dx = p.x - far[i].b.x;
      const dy = p.y - far[i].b.y;
      return dx * dx + dy * dy > reach * reach;
    });
  }
  return went;
}

/** What a pass with no Gaston chain cleared instead. */
interface GastonClear {
  /** Each leftover chain drawn. */
  chains: number[];
  /** Tsums in them. */
  tsums: number;
  /** The longest, whose pop the refill waits on when nothing cancelled it. */
  longest: number;
  /** Bubbles tapped. */
  tapped: number;
}

/**
 * For a pass with no Gaston chain: clear leftovers until `until`
 * (`gastonMixedChains`), then tap all bubbles but the reserve, unless bubbles
 * are scarce and the clear was short (`surplusBubbles`, `cancelMinChain`).
 * Spare bubbles go even with nothing drawn, since blasts refill as Gaston.
 */
function gastonClearLeftovers(ts: Tsum, until: number): GastonClear {
  const cfg = GastonConfig;
  const board = ts.scanBoardQuick();
  const bubbles = gastonBubbles(ts, board);
  const gastons = gastonGastons(ts, board);
  gastonBubbleWorth(bubbles, board, gastons);
  const left = gastonLeftovers(board, gastons).length;
  const chains = cfg.mixedChainMs > 0
    ? gastonMixedChains(ts, board, bubbles, [] as TsumPath, gastons, Math.min(until, Date.now() + cfg.mixedChainMs))
    : [];
  let tsums = 0;
  let longest = 0;
  for (let k = 0; k < chains.length; k++) {
    tsums += chains[k];
    longest = Math.max(longest, chains[k]);
  }
  const tapped = bubbles.length >= cfg.surplusBubbles || (bubbles.length > 0 && tsums >= cfg.cancelMinChain)
    ? gastonTapBubbles(ts, [] as TsumPath, bubbles).length : 0;
  ts.gameBubbles = [];
  logInfo(Log.Skill.GastonClear, {
    read: board.length, gaston: gastons.length, leftovers: left, chains: chains, bubbles: bubbles.length,
    tapped: tapped,
  });
  return { chains: chains, tsums: tsums, longest: longest, tapped: tapped };
}

// --- A board of leftovers ---------------------------------------------------

/** Whether any hop of `path` passes inside a bubble (a drag across one pops it and ends). */
function gastonCrossesBubble(path: TsumPath, bubbles: GameBubble[]): boolean {
  const half = Config.tsumWidth / 2;
  for (let i = 1; i < path.length; i++) {
    const a = { x: path[i - 1].x + half, y: path[i - 1].y + half };
    const b = { x: path[i].x + half, y: path[i].y + half };
    for (let k = 0; k < bubbles.length; k++) {
      if (gastonSegmentNear(a, b, bubbles[k], bubbles[k].r * bubbles[k].r)) { return true; }
    }
  }
  return false;
}

/** A plain drag at the window's pace: no paint read, no counter, no hold. */
function gastonDrawPlain(ts: Tsum, path: TsumPath): void {
  const cfg = GastonConfig;
  const dwellMs = GastonConfig.dwellMs;
  let p = gastonToScreen(ts, path[0]);
  tapDown(p.x, p.y, cfg.grabMs);
  moveTo(p.x, p.y, dwellMs);
  for (let i = 1; i < path.length; i++) {
    p = gastonToScreen(ts, path[i]);
    moveTo(p.x, p.y, dwellMs);
  }
  tapUp(p.x, p.y, cfg.releaseMs);
}

/**
 * Draw every other-colour chain off `board` (less `drawn` and `gastons`) that
 * fits before `until`, topmost first so a clear never drops tsums onto a route
 * still to come, skipping any that cross a bubble. Cleared tsums leave the
 * carry, since they refill as Gaston. Returns each chain's length.
 */
function gastonMixedChains(ts: Tsum, board: BoardPoint[], bubbles: GameBubble[], drawn: TsumPath,
    gastons: BoardPoint[], until: number, used?: BoardPoint[]): number[] {
  const cfg = GastonConfig;
  const out: number[] = [];
  const free = gastonFreeBoard(board, bubbles, cfg.hudBand).filter(function(p) {
    return drawn.indexOf(p) < 0 && gastons.indexOf(p) < 0;
  });
  const paths = calculatePaths(free, -1, false, 0);
  // Each path's lowest tsum, the highest on the board first.
  const bottom = function(path: TsumPath): number {
    let y = -Infinity;
    for (let k = 0; k < path.length; k++) { y = Math.max(y, path[k].y); }
    return y;
  };
  paths.sort(function(a, b) { return bottom(a) - bottom(b); });
  const half = Config.tsumWidth / 2;
  const match = Config.tsumWidth * cfg.carryMatch;
  for (let i = 0; i < paths.length; i++) {
    if (!ts.isRunning || Date.now() >= until) { break; }
    const path = paths[i];
    if (Date.now() + gastonDragEstimate(path.length) > until || gastonCrossesBubble(path, bubbles)) { continue; }
    gastonDrawPlain(ts, path);
    out.push(path.length);
    if (used) { for (let k = 0; k < path.length; k++) { used.push(path[k]); } }
    gastonCarry = gastonCarry.filter(function(c) {
      for (let k = 0; k < path.length; k++) {
        const dx = c.x - (path[k].x + half);
        const dy = c.y - (path[k].y + half);
        if (dx * dx + dy * dy < match * match) { return false; }
      }
      return true;
    });
  }
  return out;
}

/**
 * Other-colour chains off the paint read, until `until`: land on the densest
 * leftover, let the game paint its kind, and chain over those (`gastonLinkChain`,
 * released at once). Each head and its painted tsums are then left out. `skip`
 * is what is Gaston or drawn already. Returns each chain's length.
 */
function gastonPaintedLeftovers(ts: Tsum, board: BoardPoint[], bubbles: GameBubble[], skip: BoardPoint[],
    until: number, closeAt: number): number[] {
  const cfg = GastonConfig;
  const out: number[] = [];
  const reach = Config.tsumWidth * cfg.hopReach;
  let left = gastonFreeBoard(board, bubbles, cfg.hudBand).filter(function(p) { return skip.indexOf(p) < 0; });
  const oracle: GastonOracle = {
    board: board,
    plan: function(head, found) {
      return gastonChainFrom(head, gastonFreeBoard(found, bubbles, cfg.paintedHudBand), bubbles);
    },
    strayBelow: 0,
  };
  const slot = function(): GastonSlot { return { end: until, closing: false, last: false }; };
  const never = function(): boolean { return false; };
  for (let t = 0; t < cfg.convertReads && left.length >= cfg.minChain; t++) {
    if (!ts.isRunning || Date.now() + cfg.paintMs + gastonDragEstimate(cfg.minChain) > until) { break; }
    // The densest start: most leftovers within a hop.
    let head: BoardPoint | null = null;
    let best = -1;
    for (let i = 0; i < left.length; i++) {
      let n = 0;
      for (let j = 0; j < left.length; j++) {
        const dx = left[j].x - left[i].x;
        const dy = left[j].y - left[i].y;
        if (i !== j && dx * dx + dy * dy <= reach * reach) { n++; }
      }
      if (n > best || (n === best && head !== null && left[i].y > head.y)) { best = n; head = left[i]; }
    }
    if (head === null || best < cfg.minChain - 1) { break; }
    const drag = gastonLinkChain(ts, [head] as TsumPath, never, 0, closeAt, slot, oracle);
    if (drag.path.length > 0) { out.push(drag.path.length); }
    const gone: BoardPoint[] = [head];
    if (drag.gastons !== null) { for (let k = 0; k < drag.gastons.length; k++) { gone.push(drag.gastons[k]); } }
    left = left.filter(function(p) { return gone.indexOf(p) < 0; });
  }
  return out;
}

/**
 * `board` less every circle within `carryMatch` of a leftover from the
 * window's last paint read (`gastonCarry`), and how many were left out. Used
 * by passes that cannot paint-read; tsums dropped since that read are unknown.
 */
function gastonCarryOut(board: BoardPoint[]): { kept: BoardPoint[], left: number } {
  const half = Config.tsumWidth / 2;
  const match = Config.tsumWidth * GastonConfig.carryMatch;
  const matchSq = match * match;
  const kept: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    const cx = board[i].x + half;
    const cy = board[i].y + half;
    let leftover = false;
    for (let k = 0; k < gastonCarry.length; k++) {
      const dx = gastonCarry[k].x - cx;
      const dy = gastonCarry[k].y - cy;
      if (dx * dx + dy * dy < matchSq) { leftover = true; break; }
    }
    if (!leftover) { kept.push(board[i]); }
  }
  return { kept: kept, left: board.length - kept.length };
}

// --- The window -------------------------------------------------------------

/**
 * Wait for the skill's close: the antlers gone for `antlerReleaseMs`, and no
 * earlier than `antlerEarlyMs` before `closeAt`. Waits until `until` if they
 * were never seen. Returns how long it waited.
 */
function gastonAwaitClose(ts: Tsum, closeAt: number, until: number): number {
  const cfg = GastonConfig;
  const from = Date.now();
  while (ts.isRunning && Date.now() < until) {
    if (gastonAntlers.onAt > 0) {
      gastonWatchAntlers(ts);
      if (gastonAntlers.up === 0 && Date.now() >= gastonAntlers.offAt + cfg.antlerReleaseMs
          && Date.now() >= closeAt - cfg.antlerEarlyMs) { break; }
    }
    ts.sleep(Math.min(cfg.holdSliceMs, until - Date.now()));
  }
  return Date.now() - from;
}

/**
 * Scan, plan the longest chain, draw it, and either cancel it with a bubble or
 * hold it until `holdUntil` as the closing chain (`held`). Each chain is cut
 * to its slot in the window's schedule (`nextPassMs`). Held when no cancelled
 * pass is left, when the head lands inside `noCancelTailMs` of `refillBy` (the
 * earliest close), or when no bubble can stop a pop that would refill past it.
 * A chain released short is followed by other-colour chains
 * (`gastonMixedChains`); the cancel is checked off the tsum count.
 *
 * Checks the board is up first, so no chain is dragged across another screen;
 * with `fullBoard`, a scan that reads well short is retaken (`flashRetryMs`).
 *
 * Before `paintUntil` the head's paint read picks the Gastons (`GastonOracle`);
 * the head starts the longest chain over the carry (`gastonCarryOut`), or over
 * the biggest colour cluster before any read. A head the finger came up from
 * is left out and retried up to `deadRetries` times. A pass whose drags all came up
 * answers `chain` 0 with `dead` counting them, so the window looks again at
 * once rather than waiting out a refill that is not coming.
 */
function gastonPass(ts: Tsum, refillBy: number, passesLeft: number, holdUntil: number, closeAt: number,
    fullBoard: boolean, paintUntil: number, convert: boolean): GastonPass {
  const cfg = GastonConfig;
  const enteredAt = Date.now();
  // Only a round-over page ends the window: the last seconds' flash reads as no page.
  if (gastonRoundOver()) {
    return {
      chain: 0, registered: null, registeredLate: null, cancelled: 0, confirmed: null, extra: 0, popMs: 0,
      held: false, heldMs: 0, releasedAt: 0, headAt: 0, read: 0, biggest: 0, overMs: 0, dead: 0, blank: 0,
      onBoard: false,
    };
  }
  // The closing chain waits for the antlers to leave when its head and paint
  // read cannot fit before the close (`nextPassMs`).
  const late = passesLeft === 0 && Date.now() + cfg.paintMs + gastonDragEstimate(1) > closeAt - cfg.closeLeadMs;
  const closeWaitMs = late ? gastonAwaitClose(ts, closeAt, holdUntil) : 0;
  // The last cancel's release: its refill lands as the antlers go.
  const lastRelease = closeAt + cfg.antlerReleaseMs - gastonCycleMs + cfg.closeSlackMs;
  // This drag's slot: remaining cancelled passes share the time to
  // `lastRelease` evenly, dropping one when a share cannot fit
  // `cancelMinChain`; otherwise it is the closing chain.
  const slot = function(now: number): GastonSlot {
    for (let k = passesLeft; k >= 1; k--) {
      const end = now + (lastRelease - now - (k - 1) * (gastonCycleMs + cfg.paintMs)) / k;
      if (end - now >= cfg.coinSettleMs + gastonDragEstimate(cfg.cancelMinChain)) { return { end: end, closing: false, last: k === 1 }; }
    }
    return { end: late ? 0 : closeAt - cfg.closeLeadMs, closing: true, last: false };
  };
  gastonWatchAntlers(ts);
  // Starts the finger came up from, left out of the next plan.
  const avoid: Point[] = [];
  let lifted = 0;
  let blank = 0;
  for (;;) {
    let board = ts.scanBoardQuick();
    let rescans = 0;
    const retryUntil = Date.now() + cfg.flashRetryMs;
    while (fullBoard && board.length < cfg.enoughTsums - cfg.countNoise && ts.isRunning
           && Date.now() < retryUntil) {
      ts.sleep(cfg.pollMs);
      board = ts.scanBoardQuick();
      rescans++;
    }
    // Own bubble read: the scan's capture cuts the bottom row. See `bubbleHem`.
    const bubbles = gastonBubbles(ts, board);
    const biggest = gastonBiggestCluster(board);
    const gastons = gastonGastons(ts, board);
    gastonBubbleWorth(bubbles, board, gastons);
    // His tsums: the cluster, less what the last read found not to be him
    // (the carry). Past the close, newly dropped tsums are leftovers.
    const carry = gastonCarryRead ? gastonCarryOut(gastons) : null;
    let source = carry !== null ? carry.kept : gastons;
    let origin = carry !== null ? 'carry' : 'cluster';
    let free = gastonFreeBoard(source, bubbles, cfg.hudBand);
    for (let k = 0; k < avoid.length; k++) { free = gastonWithout(free, avoid[k]); }
    let path = gastonOrient(gastonChain(free, bubbles), gastonLeftovers(board, source));
    // A carry that leaves nothing to chain is stale (the clear shifted the
    // board), so fall back to the cluster and drop the carry until the next read.
    let starved = false;
    if (!path && carry !== null) {
      starved = true;
      gastonCarryRead = false;
      source = gastons;
      origin = 'cluster';
      free = gastonFreeBoard(source, bubbles, cfg.hudBand);
      for (let k = 0; k < avoid.length; k++) { free = gastonWithout(free, avoid[k]); }
      path = gastonOrient(gastonChain(free, bubbles), gastonLeftovers(board, source));
    }
    // Bubble centres in play-square scale, for offline replay. `near` is each
    // one's leftovers; `band`/`soft` count band-pass and memory finds.
    const bubbleAt: number[] = [];
    const near: number[] = [];
    let softBubbles = 0;
    let bandBubbles = 0;
    let goldBubbles = 0;
    for (let b = 0; b < bubbles.length; b++) {
      bubbleAt.push(Math.round(bubbles[b].x), Math.round(bubbles[b].y));
      near.push(bubbles[b].near || 0);
      if (bubbles[b].soft) { softBubbles++; }
      if (bubbles[b].band) { bandBubbles++; }
      if (bubbles[b].gold) { goldBubbles++; }
    }
    if (!path) {
      logInfo(Log.Skill.GastonPass, {
        chain: 0, read: board.length, rescans: rescans, gaston: gastons.length,
        source: origin, carried: carry !== null ? carry.left : 0, starved: starved,
        cut: source.length - free.length, bubbles: bubbles.length, band: bandBubbles, gold: goldBubbles,
        soft: softBubbles,
        bubbleAt: bubbleAt, near: near, retry: lifted,
      });
      return {
        chain: 0, registered: null, registeredLate: null, cancelled: 0, confirmed: null, extra: 0, popMs: 0,
        held: false, heldMs: 0, releasedAt: 0, headAt: 0, read: board.length, biggest: biggest, overMs: 0, dead: lifted,
        blank: blank, onBoard: true,
      };
    }
    // A closing chain begun past the close reads too: with the antlers gone,
    // a touched Gaston still paints the rest.
    const oracle: GastonOracle | null = paintUntil > 0 && (Date.now() < paintUntil || late) ? {
      board: board,
      // Painted circles are tsums, so only the glyph rows are cut (`paintedHudBand`).
      plan: function(head, found) {
        return gastonChainFrom(head, gastonFreeBoard(found, bubbles, cfg.paintedHudBand), bubbles);
      },
      // Not on the last try: that one draws what it found.
      strayBelow: lifted < cfg.deadRetries ? Math.min(cfg.strayPaint, Math.floor(gastons.length / 2)) : 0,
    } : null;
    // Whether the chain is the closing one, asked at its head. Without a
    // bubble, it holds if its pop would refill past `refillBy`.
    const holds = function(headAt: number, chain: number): boolean {
      if (passesLeft === 0 || headAt >= refillBy - cfg.noCancelTailMs) { return true; }
      return bubbles.length === 0
        && headAt + chain * cfg.popPerTsumMs + cfg.popTailMs >= refillBy;
    };
    // Own drag, not `linkTsums` or `link`: the paint read and hold are needed,
    // and `link`'s `maybeAutoTapSkill` would re-enter this flow.
    const drag = gastonLinkChain(ts, path, holds, holdUntil, closeAt, slot, oracle);
    // Keep the read's leftovers for the window, unless it was a lookalike.
    if (drag.gastons !== null && !drag.dead && !drag.stray) { gastonCarry = drag.leftovers; gastonCarryRead = true; }
    // A drag that drew nothing cleared nothing, so there is no pop to cut short.
    const released = !drag.held && drag.path.length > 0;
    // A short chain, or a board of leftovers: clear more before the cancel,
    // while its refill still lands before the close (`mixedFrom`).
    // His tsums are the read's where it ran, else the pass's.
    const his = drag.gastons !== null ? drag.gastons : source;
    // Short as planned, not as trimmed, and only inside the slot;
    // a converting window (`convertChainMs`) always, and past the slot.
    const mixed = released && cfg.mixedChainMs > 0 && (convert || drag.path.length + drag.trimmed < cfg.mixedBelow
      || gastonLeftovers(board, his).filter(function(p) { return drag.path.indexOf(p) < 0; }).length >= cfg.mixedFrom);
    const mixedUntil = convert
      ? Math.min(drag.releasedAt + cfg.convertChainMs, refillBy - cfg.noCancelTailMs)
      : Math.min(drag.releasedAt + cfg.mixedChainMs, refillBy - cfg.noCancelTailMs, drag.slotEnd);
    const used: BoardPoint[] = [];
    const extra = mixed ? gastonMixedChains(ts, board, bubbles, drag.path, his, mixedUntil, used) : [];
    // A converting window then reads the leftovers' own kinds, since the
    // scan's colour clusters split and merge them.
    if (convert && released) {
      const more = gastonPaintedLeftovers(ts, board, bubbles, his.concat(drag.path, used), mixedUntil, closeAt);
      for (let k = 0; k < more.length; k++) { extra.push(more[k]); }
    }
    // When the last tsum pops if nothing cancels: extras pop from their own releases.
    const extraAt = Date.now() - drag.releasedAt;
    let popMs = drag.path.length * cfg.popPerTsumMs;
    for (let k = 0; k < extra.length; k++) { popMs = Math.max(popMs, extraAt + extra[k] * cfg.popPerTsumMs); }
    let drawnTsums = drag.path.length;
    for (let k = 0; k < extra.length; k++) { drawnTsums += extra[k]; }
    // A short clear keeps the bubbles for the next long one (`cancelMinChain`),
    // unless there are plenty (`surplusBubbles`).
    const spared = released && drawnTsums < cfg.cancelMinChain
      && bubbles.length < cfg.surplusBubbles;
    const cancel: GastonCancel = released && !spared
      ? gastonCancelBubble(ts, drag.path, bubbles, drawnTsums >= cfg.cancelCheckMin)
      : { tapped: 0, soft: 0, fresh: 0, confirmed: null, cleared: 0 };
    const cancelled = cancel.tapped;
    // The scanned board and route as indexes into it, for offline replay.
    // Logged after the drag and cancel so it costs no window time.
    const flat: number[] = [];
    for (let i = 0; i < board.length; i++) {
      flat.push(Math.round(board[i].x + Config.tsumWidth / 2), Math.round(board[i].y + Config.tsumWidth / 2));
    }
    // The whole route, a stopped drag's included: the stall is in what it cut.
    const route: number[] = [];
    const routed = drag.planned !== null ? drag.planned : drag.path;
    for (let i = 0; i < routed.length; i++) { route.push(board.indexOf(routed[i])); }
    const fields: LogFields = {
      chain: drag.path.length, read: board.length, rescans: rescans, gaston: gastons.length,
      // The game's counter for the drag, vs `chain`; `counter` is the read's
      // detail; `registeredLate` is a held chain's count just before release.
      registered: drag.count !== null ? drag.count.value : null,
      counter: drag.count !== null ? chainCountDetail(drag.count) : null,
      registeredLate: drag.countLate !== null ? drag.countLate.value : null,
      // Head source, circles the carry left out, and whether it was dropped.
      source: origin, carried: carry !== null ? carry.left : 0, starved: starved,
      cut: source.length - free.length, bubbles: bubbles.length, band: bandBubbles, gold: goldBubbles,
        soft: softBubbles,
      held: drag.held, heldMs: drag.heldMs, cancelled: cancelled,
      // Whether the count confirmed the cancel (null: unchecked), how far it
      // fell, and taps on remembered vs fresh bubbles.
      confirmed: cancel.confirmed, cleared: cancel.cleared, softTaps: cancel.soft, freshTaps: cancel.fresh,
      // Released uncancelled: too short to be worth a bubble.
      spared: spared,
      // Other colours' chains drawn after it (`mixedFrom`).
      extra: extra,
      board: flat, route: route, bubbleAt: bubbleAt, near: near,
      // Head index into `board`, and which try this is.
      head: board.indexOf(path[0]), retry: lifted,
      // Paint read: its rise (null: not run), and whether the finger lifted
      // for a non-Gaston head or one that painted too few (`strayPaint`).
      rise: drag.rise, dead: drag.dead, stray: drag.stray,
      // Drag time, and the part spent beyond its sleeps (MOVE acks, read captures).
      dragMs: drag.ms, overMs: drag.overMs,
      // From the window's tap: grab and release; the refill cycle used; and
      // the pass's own time before the grab.
      headMs: drag.startedAt - gastonWindowT0, releaseMs: drag.releasedAt - gastonWindowT0,
      cycleMs: gastonCycleMs, prepMs: drag.startedAt - enteredAt,
      // Slot end from the tap, whether it was the closing chain, whether it
      // was drawn past the close, and how long it waited.
      slotMs: drag.slotEnd > 0 ? drag.slotEnd - gastonWindowT0 : 0, closing: drag.closing, late: late,
      closeWaitMs: closeWaitMs, pausedMs: drag.pausedMs,
      // Each rewind from a stalled chain, and the last check's coins (see `rewind`).
      rewinds: drag.rewinds, stallCounts: drag.stallCounts, countKept: drag.countKept, coins: drag.coins,
      // Route tsums not drawn: past the slot end, or past `closeChainMax`.
      trimmed: drag.trimmed,
    };
    // Which circles the read found painted, as indexes into `board`.
    if (drag.gastons !== null) {
      const painted: number[] = [];
      for (let i = 0; i < drag.gastons.length; i++) { painted.push(board.indexOf(drag.gastons[i])); }
      fields.painted = painted;
    }
    // Every circle's rise, in `board` order.
    if (drag.rises !== null) { fields.rises = drag.rises; }
    logInfo(Log.Skill.GastonPass, fields);
    if (drag.path.length === 0) {
      lifted++;
      if (drag.dead) { blank++; }
      if (lifted <= cfg.deadRetries && ts.isRunning) {
        avoid.push({ x: path[0].x, y: path[0].y });
        // A lookalike's kind is out of the next start too.
        if (drag.stray && drag.gastons !== null) {
          for (let k = 0; k < drag.gastons.length; k++) { avoid.push({ x: drag.gastons[k].x, y: drag.gastons[k].y }); }
        }
        continue;
      }
    }
    return {
      chain: drag.path.length, registered: drag.count !== null ? drag.count.value : null,
      registeredLate: drag.countLate !== null ? drag.countLate.value : null,
      cancelled: cancelled, confirmed: cancel.confirmed, extra: extra.length, popMs: popMs,
      held: drag.held, heldMs: drag.heldMs,
      releasedAt: drag.releasedAt, headAt: drag.startedAt, read: board.length, biggest: biggest,
      overMs: drag.overMs, dead: lifted, blank: blank, onBoard: true,
    };
  }
}

/**
 * One window, from the activation at `t0` to the charge after it: the gate,
 * the passes and the spam that fires the next activation. Returns when that
 * activation went (the read that saw the gauge full), or 0 when the charge
 * never filled it, the held chain was too short, or the round ended.
 * `charged`: opened by the last window's charge, not by the play loop.
 */
function gastonWindow(ts: Tsum, level: number, t0: number, charged: boolean): number {
  const cfg = GastonConfig;
  // The earliest the window can close, for `stillRunning`.
  gastonWindowRound = ts.roundStartedAt;
  gastonWindowUntil = t0 + cfg.openMinMs + cfg.durationMs[level - 1];
  gastonWindowT0 = t0;
  // Opened by the play loop: a board to convert (`convertChainMs`).
  const convert = !charged && cfg.convertChainMs > 0;
  if (gastonCycleRound !== ts.roundStartedAt) {
    gastonCycleRound = ts.roundStartedAt;
    gastonCycleMs = cfg.nextPassMs;
  }
  // The antlers come up during the open gate's polls (see `antlerMs`).
  gastonAntlers.up = 0;
  gastonAntlers.onAt = 0;
  gastonAntlers.offAt = 0;
  // The animation and first fill are one wait. See `openFloorMs`.
  const opened = gastonAwaitBoard(ts, t0 + cfg.openWaitMs, t0 + cfg.openFloorMs);
  const openMs = Date.now() - t0;
  // The clock starts here, not at the tap. See `durationMs`.
  const closesAt = Date.now() + cfg.durationMs[level - 1];
  const holdUntil = closesAt + cfg.holdPastCloseMs;
  // The close, off the antlers coming up, else off the tap. Levels under 6
  // are shorter by their `durationMs`.
  const shorter = cfg.durationMs[5] - cfg.durationMs[level - 1];
  const upMs = gastonAntlers.onAt - t0;
  const closeAt = (upMs >= cfg.antlerUpMs[0] && upMs <= cfg.antlerUpMs[1]
    ? gastonAntlers.onAt + cfg.antlerMs : t0 + cfg.tapToCloseMs) - shorter;
  // What a refill must land before: the earliest possible close
  // (`closesAt` errs late).
  const refillBy = gastonWindowUntil;
  // Reads from the last window don't carry over.
  gastonCarry = [];
  gastonCarryRead = false;
  // The paint read stays clear of the game's own paint at the close, and
  // stops once a pass reads nothing twice. See `paintBlackoutMs`.
  let paintUntil = Math.min(closesAt - cfg.paintBlackoutMs, closeAt - cfg.closeLeadMs);

  // Chain, cancel, wait for the drop, `passesBeforeHold` times; then the
  // closing chain, held through the close (`nextPassMs`), which ends the
  // window and is the charge. The refill gate is not cut at the close: what
  // falls then is Gaston, and the held chain wants it landed.
  let passes = 0;
  let cancels = 0;
  let popped = 0;
  let missed = 0;
  let extra = 0;
  let overMs = 0;
  let dead = 0;
  let onBoard = true;
  let fullBoard = opened.full;
  let passesLeft = cfg.passesBeforeHold;
  // A fast cancel's release, to time the refill cycle by at the next grab.
  let cycleFrom = 0;
  // The held chain, 0 when the window closed without one.
  let clearing = 0;
  // Closing chains drawn after one that stopped short (`gaugeChain`), and
  // the spam through the short one's pop, which may have fired already.
  let retries = 0;
  let early: GastonCharge | null = null;
  let clearingLate: number | null = null;
  let heldMs = 0;
  let releasedAt = 0;
  const drawn: number[] = [];
  const registered: (number | null)[] = [];
  const read: number[] = [];
  const biggest: number[] = [];
  while (ts.isRunning) {
    const closingPass = passesLeft === 0;
    const pass = gastonPass(ts, refillBy, passesLeft, holdUntil, closeAt, fullBoard, paintUntil, convert);
    passes++;
    dead += pass.dead;
    if (!pass.onBoard) { onBoard = false; break; }
    // The refill cycle, from a cancelled release to the next grab; not the
    // closing chain's, which may wait for the close.
    if (cycleFrom > 0 && pass.headAt > 0 && !closingPass) {
      gastonCycleMs = Math.round((gastonCycleMs + pass.headAt - cycleFrom) / 2);
    }
    cycleFrom = 0;
    // Only heads that painted nothing mean the read stopped working; a
    // painted head with no route is the plan's fault.
    if (pass.chain === 0 && pass.blank > cfg.deadRetries) { paintUntil = 0; }
    read.push(pass.read);
    biggest.push(pass.biggest);
    if (pass.chain > 0) {
      drawn.push(pass.chain);
      registered.push(pass.registered);
      cancels += pass.cancelled;
      if (pass.confirmed === false) { missed++; }
      extra += pass.extra;
      overMs += pass.overMs;
      if (pass.held) {
        // Prefer the game's count: a stalled drag's route overstates what linked.
        clearing += pass.registered !== null && pass.registered > 0 ? pass.registered : pass.chain;
        clearingLate = retries === 0 ? pass.registeredLate : null;
        heldMs += pass.heldMs;
        releasedAt = pass.releasedAt;
        // Short of the gauge: tap through the pop, which may fill it, and draw
        // another closing chain only if it did not (`gaugeChain`).
        if (clearing < cfg.gaugeChain && retries < cfg.closeRetries && ts.isRunning) {
          const landed = pass.releasedAt + pass.chain * cfg.popPerTsumMs + cfg.popTailMs;
          early = gastonSpamSkill(ts, landed);
          if (early.ready || !early.onBoard) { break; }
          retries++;
          passesLeft = 0;
          fullBoard = gastonAwaitBoard(ts, Math.max(Date.now(), landed) + cfg.fillWaitMs, landed).full;
          continue;
        }
        break;
      }
      passesLeft--;
      // A cancelled clear is gone at once. An uncancelled one pops tsum by
      // tsum (`popPerTsumMs`), so wait it out before planning over it.
      const fast = pass.cancelled > 0 && pass.confirmed !== false;
      if (fast) { cycleFrom = pass.releasedAt; }
      const notBefore = Math.max(Date.now(),
        pass.releasedAt + (fast ? cfg.fillMinMs : Math.max(cfg.fillMinMs, pass.popMs + cfg.popTailMs)));
      fullBoard = gastonAwaitBoard(ts, notBefore + cfg.fillWaitMs, notBefore).full;
    } else {
      // Nothing to chain well past the close: no more Gaston is coming. A
      // margin, since a pass right at the close may catch a refill landing.
      if (Date.now() >= closesAt + cfg.fillWaitMs) { break; }
      // Clear leftovers and spare bubbles while their refill still lands
      // before the close, then wait for it.
      const lastRefill = refillBy - cfg.noCancelTailMs;
      const clear = Date.now() < lastRefill ? gastonClearLeftovers(ts, lastRefill) : null;
      if (clear !== null && (clear.tsums > 0 || clear.tapped > 0)) {
        popped += clear.tapped;
        extra += clear.chains.length;
        const notBefore = Date.now() + (clear.tapped > 0 ? cfg.fillMinMs
          : Math.max(cfg.fillMinMs, clear.longest * cfg.popPerTsumMs + cfg.popTailMs));
        fullBoard = gastonAwaitBoard(ts, notBefore + cfg.fillWaitMs, notBefore).full;
      } else {
        ts.sleep(cfg.rescanIdleMs);
        fullBoard = false;
      }
    }
  }

  // The charge: the held chain pops past the close, so its Gastons fill the
  // gauge. Spam the button through the clear; the moment it reads full the
  // next window opens. Skipped for a short chain (`chargeMinChain`), and
  // capped at the clear's end (`chargeTailMs`). The late count is preferred.
  const chargeFrom = Date.now();
  let charge: GastonCharge = { taps: 0, ready: false, onBoard: onBoard };
  let spamUntil = chargeFrom;
  if (early !== null && (early.ready || !early.onBoard)) {
    charge = early;
  } else if (onBoard && clearing >= cfg.chargeMinChain) {
    const popping = clearingLate !== null && clearingLate > 0 && clearingLate < clearing ? clearingLate : clearing;
    // At least `chargeMinMs`: a gauge that filled during a retry still wants its tap.
    // A converting window's gauge starts empty, so it spams to `gaugeWaitMs`.
    spamUntil = convert ? chargeFrom + cfg.gaugeWaitMs
      : Math.max(chargeFrom + cfg.chargeMinMs, Math.min(chargeFrom + cfg.gaugeWaitMs,
        releasedAt + popping * cfg.popPerTsumMs + cfg.chargeTailMs));
    charge = gastonSpamSkill(ts, spamUntil);
  }
  const firedAt = charge.ready ? Date.now() : 0;

  logInfo(Log.Skill.GastonDone, {
    skillLevel: level,
    windowMs: cfg.durationMs[level - 1],
    // Open gate time and tsum peak; `openMs` at the `openWaitMs` ceiling with
    // few `openTsums` is a board that never filled.
    openMs: openMs,
    openTsums: opened.peak,
    passes: passes,
    // Every chain drawn, in order, the last being the held chain.
    chains: drawn,
    // The game counter's count per chain (null: unread); well under `chains`
    // means the game did not follow the drag.
    registered: registered,
    // Per pass: tsums scanned, and the biggest colour cluster among them.
    read: read,
    biggest: biggest,
    // Bubbles tapped to cancel the window's clears.
    cancels: cancels,
    // Bubbles tapped on passes with no Gaston chain (`gastonClearLeftovers`).
    popped: popped,
    // Cancels the tsum count did not confirm (`cancelDrop`).
    missed: missed,
    // Other colours' chains, beside or instead of Gaston ones (`mixedFrom`).
    extra: extra,
    // Total drag time spent on MOVE acks beyond dwells.
    overMs: overMs,
    // Drags where the finger lifted at the head (see `skill.gaston.pass`).
    dead: dead,
    // Held chain: time on its last tsum. `releaseLeadMs` is its release
    // past the close (antlers off, else the estimate); under 0 charges nothing.
    // Both 0 with no held chain.
    heldMs: heldMs,
    // Closing chains drawn after one that stopped short of `gaugeChain`.
    closeRetries: retries,
    // Opened by the play loop, so its passes cleared other colours (`convertChainMs`).
    convert: convert,
    releaseLeadMs: clearing > 0 ? releasedAt - (gastonAntlers.offAt > t0 ? gastonAntlers.offAt : closesAt) : 0,
    // Antlers up and off from the tap (0: not seen), and the planned close (`antlerMs`).
    antlersOnMs: gastonAntlers.onAt > t0 ? gastonAntlers.onAt - t0 : 0,
    antlersOffMs: gastonAntlers.offAt > t0 ? gastonAntlers.offAt - t0 : 0,
    closeAtMs: closeAt - t0,
    // Charge taps until full; -1 if never full by `gaugeWaitMs`, 0 if not
    // charged. `ready`: gauge seen full (next window). `chargeMs`: release to
    // full. `onBoard: false`: the round ended under the window.
    spamTaps: charge.ready ? charge.taps : (charge.taps > 0 ? -1 : 0),
    // Spam time allowed: `gaugeWaitMs`, or less once the clear ends (`chargeTailMs`).
    spamBudgetMs: spamUntil - chargeFrom,
    chargeMs: Date.now() - chargeFrom,
    ready: charge.ready,
    onBoard: onBoard && charge.onBoard,
    totalMs: Date.now() - t0,
  });
  return firedAt;
}

registerSkill({
  types: [SkillType.Gaston],
  // Every bubble is a cancel, which fits another pass into the window, so the
  // skill claims them from the first activation to the round's end.
  claimsBubbles: gastonActivated,
  // No `popBubblesAfterChain`: a bubble popped between windows cancels a clear
  // that is filling the gauge. Bubbles go on `gastonCancelBubble` instead.
  //
  // Every colour stays in the board array so Gaston's other clusters are
  // there too; four covers a board of leftovers. `gastonFreeBoard` cuts the
  // HUD glyphs' cluster. This and the two below apply from the first
  // activation only; before it the round is ordinary play.
  extraClusterSlots: function(ts) { return gastonActivated(ts) ? 4 : 0; },
  // Uncapped, because after a window the board is one colour worth a long
  // chain; one per scan, because the rest of a batch is planned on a board
  // the first chain has already cleared.
  chainLimits: function(ts) { return gastonActivated(ts) ? { maxChain: 0, maxChainsPerScan: 1 } : {}; },
  // The play loop's chains between windows read the counter too.
  readsChainCounter: gastonActivated,
  // A full gauge inside a window waits: activating there restarts the
  // animation over the window's remaining time.
  stillRunning: function(ts) {
    return ts.roundStartedAt !== 0 && gastonWindowRound === ts.roundStartedAt
      && Date.now() < gastonWindowUntil;
  },
  afterActivate: function(ts, _board, activatedAt) {
    const cfg = GastonConfig;
    let t0 = activatedAt || Date.now();
    // The first window here was opened by the play loop, not a charge.
    let charged = false;
    // From here to the tally the bubbles are the window's. See `claimsBubbles`.
    gastonClaimRound = ts.roundStartedAt;
    const level = Math.min(Math.max(ts.skillLevel, 1), cfg.durationMs.length);
    // Window after window while each charge fires the next. One more tap makes
    // sure (a no-op on a spent gauge); the window is anchored at the read.
    // Logged like `useSkill`, marked `charged`.
    while (ts.isRunning) {
      const firedAt = gastonWindow(ts, level, t0, charged);
      if (firedAt === 0) { break; }
      charged = true;
      logInfo(Log.Skill.Use, { skill: ts.skillType, skillLevel: ts.skillLevel, settleMs: 0,
        charged: true });
      ts.holdBubblesAfterSkill(firedAt);
      lorcanaNoteSkillFired();
      ts.tap(Button.gameSkill1);
      ts.sleep(30);
      t0 = firedAt;
    }
    // "It fired", which ends the play loop's link batch: its remaining paths
    // were planned on a board this window has since cleared.
    return true;
  }
});
