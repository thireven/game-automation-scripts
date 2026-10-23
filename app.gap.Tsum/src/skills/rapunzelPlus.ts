// ---------------------------------------------------------------------------
// Rapunzel+
//
// Her activation clears nothing by itself: it makes the board colour-blind for
// a moment, so one chain can be drawn through tsums of any colour. How many it
// may take is the skill level -- 9 at level 1 up to 24 at level 6
// (`chainLength`), and that number is the only limit inside the window.
//
// So the choreography is one drag: drop colour from the search (`rapunzelChain`
// treats the whole board as a single group), stop at the level's cap, draw the
// longest path that comes back. The "Maximum Chain Number" and "Chains per
// board scan" settings are not consulted -- they are what the play loop links
// between activations, and have nothing to say about the one chain the skill
// pays out. They are also left alone for that ordinary play: her chains outside
// the window are worth exactly what they clear, so no `chainLimits` here.
//
// What the window has to get right. The aim is her level's cap, drawn as fast
// as possible -- not the whole board, as Gaston's window wants:
//
//   - **every tsum has to be in the board array.** A scan keeps only the
//     `uniqueTsumCount - 1` biggest colour clusters, and a colour without a
//     slot is not in the array at all, so no chain can be planned over it.
//     Ordinarily that is the cheapest colour to drop; for a chain that ignores
//     colour it is a tenth of the board. `extraClusterSlots` buys it back.
//   - **only tsums that can still link.** The window opens on the batch the
//     play loop linked just before activating, still clearing: the cut-in
//     froze those clears, so they finish under her drag. The scan leaves them
//     out (`fluxDrop`, board.ts), and a look whose plan falls short of the cap
//     is retaken a moment later (`rapunzelPlanned`).
//   - **a bubble breaks the drag.** One crossed mid-travel pops and ends the
//     chain there, and this chain crosses the whole board. `beforeActivate`
//     spends the hoard aimed, off the positions the cycle's scan already holds,
//     so it costs no capture.
//   - **the route follows Gaston's rules.** Nothing on the board is inert in
//     the window, so a tsum the drag line merely clips is linked out of order
//     and the rest of the plan leads nowhere. Hops come from `buildClearHops`
//     (no hop passes near a third tsum or through a bubble), and the drag is
//     one MOVE per tsum held `dwellMs`, longer than a display frame.
//   - **a stalled drag is walked back.** About one hop in fifty fails anyway.
//     Every `checkEvery` tsums the game's chain counter
//     is read (`chainCounterRead`); a count well behind the finger walks it
//     back to the chain's real end and replans the rest from there
//     (`rapunzelLinkChain`), as Gaston's coin check does.
//   - **a lantern starts the chain.** One of her skill patches drops lanterns
//     on the board, and a lantern that is linked clears more on its own. The
//     chain is planned from one (`rapunzelLanterns`, found by the lemon-yellow
//     sun at its middle) whenever that costs little length (`lanternKeep`).
// ---------------------------------------------------------------------------

// --- Tuning data -----------------------------------------------------------

// `var`, like every other skill's table: a `const` here is lexical, so it is not
// a property of the global object and the offline harness cannot reach it.
var RapunzelPlusConfig = {
  // Tsums one chain may take, by skill level 1-6.
  chainLength: [9, 12, 15, 18, 21, 24],
  // Her activation animation puts a dark veil over the board and holds it there
  // for most of a second. Measured off `rapunzel_debug/rapunzel+_1.mp4`: the
  // board reads mean luminance 138 before the tap, drops to 41 by 0.1s, sits at
  // 41-43 from 0.65s to 1.45s, and comes back at 1.50s. A board scan taken in
  // there finds a handful of tsums and the chain comes out at three, which is
  // exactly what this skill did until that clip was measured -- the plan was
  // short, and no amount of care over the drag was ever going to help.
  //
  // So the animation is not waited out by the clock, it is watched for -- with
  // the clock left underneath as a floor, because the watching can be wrong
  // (`litMinMs`).
  // `rapunzelEdgeLight` reads the play square's left, right and bottom bands --
  // bands and not the whole square because the animation is a *bright* figure
  // over the middle, so the middle cannot say whether the board is back; and
  // each band against its own level from before the tap, because a band with no
  // tsums under it is dark either way.
  //
  // In that clip the board comes back at 1.16 of its own pre-tap level, and no
  // moment of the animation gets all three bands past 0.64 -- the rainbow burst
  // takes the bottom band to 1.5 on its own, and the left to 0.90, but never
  // the right. 0.85 sits in the gap with room on both sides.
  litFraction: 0.85,
  litPollMs: 50,
  // Chain anyway once this is spent. The veil is gone by 1.5s; on a 70s trace
  // half the activations never read the board lit and sat here to 2.5s, about
  // 1s of a ~7s cycle. What that wait bought (a fuller board) the retake below
  // buys only when it is needed.
  litWaitMs: 1800,
  // Nothing leaves the gate before this, whatever the light says --
  // `settleBoard`'s `minMs` for the same reason it has one. Every reading is a
  // ratio against `rapunzelBaseLight`, one sample taken a moment before the
  // tap; sampled over a hole the last clear opened, that baseline reads low,
  // the veil never registers as a darkening, and the gate used to give up at
  // `darkByMs` and scan the middle of it. In the clip the board is back at
  // 1.50s, so a gate that works exits past this anyway and the floor costs it
  // nothing -- what it buys is the gate that cannot see the veil, which now
  // waits the animation out by the clock.
  litMinMs: 1500,
  // The gate waits for the board to darken and then come back, so it cannot be
  // fooled by the frames between the tap and the veil (the veil is down 0.1s
  // after the clip starts, but where the tap sits inside that is not known).
  // Nothing darkened by here is not an exit any more, only the finding that
  // this reading cannot see the animation -- the floor above covers it.
  darkByMs: 700,
  // A plan under `retakeBelow` of her cap waits `settleRetryMs` and looks
  // again (the refill may still be landing), at most `settleMaxWaits` times,
  // keeping the longest plan. Anything nearer the cap goes at once: on a 50s
  // trace, retakes of 21-22 of 24 cost ~0.5s and never found a longer chain.
  retakeBelow: 0.75,
  settleRetryMs: 150,
  settleMaxWaits: 1,
  // A plan short of the cap whose look left tsums out as still clearing waits
  // until `clearedShare` of the ledger's spots are gone, at most
  // `clearedWaitMs`, and looks again: those tsums are the missing links.
  clearedShare: 0.75,
  clearedWaitMs: 600,
  // Gaston's hop rules (`buildClearHops`): longest hop and how close a hop's
  // line may pass to a third tsum's centre, both in tsum widths. The clearance
  // test is what keeps the drag from linking a tsum it was not meant to; the
  // old answer, a short 1.35 reach, still let ~3% of routes clip one.
  hopReach: 1.6,
  crossAvoid: 0.7,
  // Work the board bottom-up, as Coronation Day Elsa's window does -- but for a
  // harder reason than hers. For her it was measured free and argued from the
  // shape of a pile (67.1% against 67.0%); she can also spend a bad chain and
  // draw another. This skill has one drag, and the tsums at the top of the pile
  // are the ones the refill is still dropping in: a first link that grabs air
  // where a tsum used to be loses the whole chain, not one chain of several.
  //
  // Three parts, and it is the third that does the work. `lowFirst` into the
  // search (Elsa's parameter); `fallingBand` held out of the plan; and the
  // finished path drawn from whichever end is lower, which is free because a
  // path links the same tsums drawn either way. It is needed because the search
  // orders its starts by *ascending degree*, and on a pile the loose low-degree
  // tsums are exactly the ones at the top -- so left alone the drag begins
  // precisely where the board is least settled.
  //
  // Over 300 ragged synthetic boards, share of chains whose first link falls in
  // the top 30% of the pile: 80.0% as it was, 64.3% with `lowFirst`, 25.7% also
  // drawing from the low end, 0.3% with the band held out as well. Mean chain
  // length is 24.00 in every one of those, and stays 24.00 at 60% raggedness --
  // only a board eaten to 70% costs anything (22.62), where the fallback below
  // is what is holding it up.
  bottomFirst: true,
  // The top slice of the *occupied* board -- a share of pile height, not of the
  // play square -- held out of planning as the ground the refill is still
  // arriving on. Swept at 0.20/0.30/0.40: all cost nothing and all put the
  // first link out of the top band, so this is the middle of a flat optimum
  // rather than a tuned value.
  fallingBand: 0.25,
  // Total DFS steps the chain search may spend, as `SearchStepBudget` is for
  // `calculatePaths`. Once colour is dropped the board is one component and the
  // cap stops the search in a few dozen steps; this only bounds a board so
  // broken up that no path reaches the cap.
  searchBudget: 3000,
  // The drag, Gaston's shape: one MOVE per tsum. The game links along the line
  // between MOVEs, and `crossAvoid` keeps that line clear, so the old two
  // sweep steps per hop bought nothing and cost two touch events a tsum.
  // `dwellMs` must outlast one display frame (16.7ms) so each centre is some
  // frame's position; 20 does, and the rewind catches the hops that still
  // fail. Gaston holds 30 (10 linked far fewer whole). NOT MEASURED here yet:
  // raise it if the log's `rewinds` fill up.
  grabMs: 10,
  dwellMs: 20,
  releaseMs: 10,
  // --- the rewind (Gaston's `rewind`, off the chain counter) ---
  // From tsum `checkFrom` on, every `checkEvery` tsums, the game's count is
  // read. Not at the end: a stall there costs a few tsums, a read ~100ms. A
  // count more than `countSlack` behind the finger is a stall: the finger
  // walks back to the chain's end and the rest is replanned from there, clear
  // of what is linked (and of the failing tsum on a repeat stall), at most
  // `maxRewinds` times. An unread count is trusted, not a stall.
  checkFrom: 6,
  checkEvery: 8,
  // No read this close to the end: little is left to save.
  checkTail: 4,
  countSlack: 3,
  maxRewinds: 3,
  // --- lanterns ---
  // A patch drops lanterns; each is found by the lemon-yellow sun in its
  // middle. Measured on a 40s recording (81 frames, 540x960): a lantern's sun
  // reads 14-24 px across in a `lanternScan`-wide capture of the play square,
  // a coin 12, and the mask passes R>=225, G>=215, B<=90 on the sun only --
  // Rapunzel's hair keeps blue over 130. 18 of 20 boxes in that size were
  // lanterns; the two misses were flashes inside a clear effect. A lantern
  // glowing white at the top of its pulse breaks the sun up and is missed.
  lanternScan: 270,
  lanternLo: { b: 0, g: 215, r: 225 },
  lanternHi: { b: 90, g: 255, r: 255 },
  lanternMinBox: 14,
  lanternMaxBox: 24,
  lanternMinArea: 40,
  // A scanned circle within this (tsum widths) of a lantern is that lantern;
  // otherwise the lantern goes into the board at the sun's centre.
  lanternSnap: 0.6,
  // A chain from a lantern is drawn when it is at least this share of the
  // longest chain from anywhere: the lantern's own clear makes up the rest.
  lanternKeep: 0.75,
  // Her chain clears in one flash, not a tsum at a time; a lantern in it
  // then clears a column, ~1.5s later (a recording at 106fps). Both go into
  // the clearing ledger (`fluxNoteSpots`) so the play loop resumes at once and
  // plans around them, rather than sleeping. NOT MEASURED past that one clip.
  skillClearMs: 600,
  lanternClearMs: 1800,
};

// --- Waiting out the activation animation -----------------------------------

// Cells per side of the play-square downsample the light probe reads.
const RapunzelLightGrid = 8;

// The board's brightness before the activation tap, as `rapunzelEdgeLight`
// returns it. Sampled in `beforeActivate`, which is the last moment the board
// is certainly not under the veil, and read once by the wait below.
var rapunzelBaseLight: number[] | null = null;

/**
 * Mean brightness of the play square's left, right and bottom bands.
 *
 * One capture of the square at 8x8, so the whole probe is 24 pixels off a
 * 64-pixel image -- about what the cropped gauge read costs, which is what
 * makes it pollable. See `litFraction` for why the bands and not the middle.
 */
function rapunzelEdgeLight(ts: Tsum): number[] {
  const g = RapunzelLightGrid;
  const img = getScreenshotModify(ts.playOffsetX, ts.playOffsetY,
    ts.playWidth, ts.playHeight, g, g, 100);
  try {
    const pts: Point[] = [];
    for (let i = 0; i < g; i++) { pts.push({x: 0, y: i}); }
    for (let i = 0; i < g; i++) { pts.push({x: g - 1, y: i}); }
    for (let i = 0; i < g; i++) { pts.push({x: i, y: g - 1}); }
    const cols = getImageColors(img, pts);
    const bands: number[] = [];
    for (let b = 0; b < 3; b++) {
      let sum = 0;
      for (let i = 0; i < g; i++) {
        const c = cols[b * g + i];
        sum += (c.r + c.g + c.b) / 3;
      }
      bands.push(sum / g);
    }
    return bands;
  } finally {
    releaseImage(img);
  }
}

/**
 * How lit the board is now, as the dimmest band against its own pre-tap level.
 * 1 when there is no baseline to compare against, so a missing sample reads as
 * "get on with it" rather than as a veil that never lifts.
 */
function rapunzelLitRatio(ts: Tsum): number {
  const base = rapunzelBaseLight;
  if (!base) { return 1; }
  const now = rapunzelEdgeLight(ts);
  let dimmest = Infinity;
  for (let i = 0; i < now.length && i < base.length; i++) {
    // A band that was dark before the tap is dark because nothing is under it;
    // its ratio is 1 so it abstains rather than holding the gate shut.
    const ratio = base[i] > 1 ? now[i] / base[i] : 1;
    if (ratio < dimmest) { dimmest = ratio; }
  }
  return dimmest;
}

/**
 * Hold until the activation animation is off the board.
 *
 * Waits for the board to darken and *then* come back, so the bright frames
 * between the tap and the veil cannot be mistaken for the board returning.
 * Never refuses to chain: every way out of here leads to the scan.
 *
 * Two exits, and `litMinMs` is the floor under both. The board reading lit
 * again is one; failing to see the veil at all by `darkByMs` is the other, and
 * that one is a finding about the *reading*, not about the board -- so it waits
 * the animation out by the clock rather than scanning now. A poll that reads
 * dark after the board looked lit takes `lit` back down, so the floor also
 * turns one lucky reading into a sustained one.
 */
function rapunzelWaitForBoard(ts: Tsum, from: number):
    { litMs: number, sawDark: boolean, lit: boolean } {
  const cfg = RapunzelPlusConfig;
  if (!rapunzelBaseLight) { return { litMs: 0, sawDark: false, lit: false }; }
  let sawDark = false;
  let lit = false;
  let blind = false;
  while (ts.isRunning && Date.now() - from < cfg.litWaitMs) {
    const dimmest = rapunzelLitRatio(ts);
    if (dimmest < cfg.litFraction) {
      sawDark = true;
      lit = false;
      // The veil arrived, late: this reading can see the animation after all,
      // so go back to watching for it to lift rather than to the clock.
      blind = false;
    } else if (sawDark) {
      lit = true;
    } else if (Date.now() - from > cfg.darkByMs) {
      blind = true;
    }
    if ((lit || blind) && Date.now() - from >= cfg.litMinMs) {
      break;
    }
    ts.sleep(cfg.litPollMs);
  }
  return { litMs: Date.now() - from, sawDark: sawDark, lit: lit };
}

// --- The chain -------------------------------------------------------------

/**
 * The longest chain of up to `maxLen` tsums over `board`, colour ignored,
 * along `hops` (`buildClearHops` over the whole board, so every tsum stays an
 * obstacle even when a search may not use it). Indices are into `board`. With
 * `heads`, only chains starting on one of those indices are searched.
 *
 * Components are walked because a gap no hop crosses splits the board. The
 * cap is a stopping condition, so a board that offers more costs one short
 * search. `lowFirst` orders the starts bottom-up -- see `bottomFirst`.
 */
function rapunzelSearch(board: BoardPoint[], hops: number[][], maxLen: number,
    heads?: number[]): BoardPoint[] {
  const cfg = RapunzelPlusConfig;
  if (board.length < 3 || maxLen < 3) { return []; }
  let best: number[] = [];
  if (heads) {
    for (let h = 0; h < heads.length && best.length < maxLen; h++) {
      const found = findLongestTsumPath(hops, [heads[h]], cfg.searchBudget, maxLen).path;
      if (found.length > best.length) { best = found; }
    }
  } else {
    const components = findTsumComponents(hops);
    for (let c = 0; c < components.length && best.length < maxLen; c++) {
      const comp = components[c];
      // Nothing here can beat what is already held.
      if (comp.length < 3 || comp.length <= best.length) { continue; }
      const found = findLongestTsumPath(hops, comp, cfg.searchBudget, maxLen,
        cfg.bottomFirst ? board : undefined).path;
      if (found.length > best.length) { best = found; }
    }
  }
  const out: BoardPoint[] = [];
  for (let i = 0; i < best.length; i++) { out.push(board[best[i]]); }
  return out;
}

/**
 * The longest chain on from `from` (the chain's current end) over `board`
 * less `used`, at most `maxLen` tsums with `from` counted; null under 2. The
 * replan after a stall walk-back. Linked tsums are left out of the hop test,
 * as Gaston's replan does: crossing one does not link it again.
 */
function rapunzelChainFrom(from: BoardPoint, board: BoardPoint[], used: BoardPoint[],
    bubbles: GameBubble[], maxLen: number): TsumPath | null {
  const cfg = RapunzelPlusConfig;
  const points: BoardPoint[] = [from];
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== from && used.indexOf(board[i]) < 0) { points.push(board[i]); }
  }
  const hops = buildClearHops(points, bubbles, cfg.hopReach, cfg.crossAvoid);
  const found = rapunzelSearch(points, hops, maxLen, [0]);
  return found.length >= 2 ? found as TsumPath : null;
}

/**
 * `hops` cut to the part of the board below the top slice the refill is still
 * arriving in: a tsum above the line keeps no hops, so no chain uses it, but
 * it still blocked the hops that crossed it.
 */
function rapunzelSettledHops(board: BoardPoint[], hops: number[][], band: number): number[][] {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < board.length; i++) {
    if (board[i].y < minY) { minY = board[i].y; }
    if (board[i].y > maxY) { maxY = board[i].y; }
  }
  // A share of the *occupied* height, not of the play square: the board is a
  // pile whose top is wherever it happens to have run out.
  const line = minY + (maxY - minY) * band;
  const out: number[][] = [];
  for (let i = 0; i < board.length; i++) {
    out.push(board[i].y > line ? hops[i].filter(function(j) { return board[j].y > line; }) : []);
  }
  return out;
}

/**
 * The chain to draw, in the order to draw it. From a lantern when that chain
 * is at least `lanternKeep` of the best free one; otherwise bottom-first, and
 * planned over the settled part of the board wherever that fills it alone.
 */
function rapunzelChain(board: BoardPoint[], bubbles: GameBubble[], maxLen: number,
    lanterns: BoardPoint[]): { path: TsumPath, fromLantern: boolean } | null {
  const cfg = RapunzelPlusConfig;
  if (board.length < 3 || maxLen < 3) { return null; }
  const hops = buildClearHops(board, bubbles, cfg.hopReach, cfg.crossAvoid);
  // The settled part first. If it can fill the chain on its own the top never
  // comes into the plan at all.
  let best = cfg.bottomFirst
    ? rapunzelSearch(board, rapunzelSettledHops(board, hops, cfg.fallingBand), maxLen) : [];
  if (best.length < maxLen) {
    // It could not, so the whole board goes back in: a chain that has to reach
    // up beats a chain that is short.
    const all = rapunzelSearch(board, hops, maxLen);
    if (all.length > best.length) { best = all; }
  }
  if (lanterns.length > 0) {
    const heads: number[] = [];
    for (let i = 0; i < lanterns.length; i++) {
      const at = board.indexOf(lanterns[i]);
      if (at >= 0) { heads.push(at); }
    }
    const lit = rapunzelSearch(board, hops, maxLen, heads);
    if (lit.length >= 3 && lit.length >= cfg.lanternKeep * best.length) {
      return { path: lit as TsumPath, fromLantern: true };
    }
  }
  if (best.length < 3) { return null; }
  const path: TsumPath = best as TsumPath;
  // Draw from whichever end is lower: a path links the same tsums either way,
  // and the search's low-degree starts are the loose tsums at the top of the
  // pile, where the refill is still landing. With `lowFirst` and
  // `fallingBand`, the first link falls in the top 30% of the pile 0.3% of
  // the time, against 80% left alone.
  if (path.length > 1 && path[path.length - 1].y > path[0].y) { path.reverse(); }
  // `tsumIdx` stays unset: the chain has no one colour, which is the point.
  return { path: path, fromLantern: false };
}

// --- Lanterns ----------------------------------------------------------------

/**
 * The lanterns on the board, as board points: a scanned circle within
 * `lanternSnap` of one stands for it, otherwise one is added to `board` at the
 * sun's centre (which is the lantern's middle, so the grab lands on it).
 *
 * One capture of the play square at `lanternScan`, masked to the sun's lemon
 * yellow; each mask shape of a sun's size is a lantern. Two shapes within a
 * tsum of each other are one lantern whose sun the mask split.
 */
function rapunzelLanterns(ts: Tsum, board: BoardPoint[]): BoardPoint[] {
  const cfg = RapunzelPlusConfig;
  const w = cfg.lanternScan;
  const img = getScreenshotModify(ts.playOffsetX, ts.playOffsetY, ts.playWidth, ts.playHeight, w, w, 100);
  if (!(img as unknown as number)) { return []; }
  let boxes: ContourBox[] = [];
  try {
    const lo = cfg.lanternLo;
    const hi = cfg.lanternHi;
    const mask = inRange(img, lo.b, lo.g, lo.r, 0, hi.b, hi.g, hi.r, 255);
    if (mask as unknown as number) {
      try {
        boxes = findContours(mask, cfg.lanternMinArea, 0);
      } finally {
        releaseImage(mask);
      }
    }
  } finally {
    releaseImage(img);
  }
  const scale = ts.playResizeWidth / w;
  const half = Config.tsumWidth / 2;
  const snapSq = (cfg.lanternSnap * Config.tsumWidth) * (cfg.lanternSnap * Config.tsumWidth);
  const found: Point[] = [];
  const out: BoardPoint[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.width < cfg.lanternMinBox || b.width > cfg.lanternMaxBox
        || b.height < cfg.lanternMinBox || b.height > cfg.lanternMaxBox) { continue; }
    // Centre in play-square units, as board centres are.
    const c = { x: (b.x + b.width / 2) * scale, y: (b.y + b.height / 2) * scale };
    let dup = false;
    for (let k = 0; k < found.length && !dup; k++) {
      dup = getDistance(found[k], c) < Config.tsumWidth * Config.tsumWidth;
    }
    if (dup) { continue; }
    found.push(c);
    let snap: BoardPoint | null = null;
    let snapD = snapSq;
    for (let k = 0; k < board.length; k++) {
      const d = getDistance({ x: board[k].x + half, y: board[k].y + half }, c);
      if (d < snapD) { snapD = d; snap = board[k]; }
    }
    if (snap === null) {
      snap = { tsumIdx: 'lantern', x: c.x - half, y: c.y - half };
      board.push(snap);
    }
    out.push(snap);
  }
  return out;
}

// --- Drawing it --------------------------------------------------------------

/** A board point (top-left corner) as the screen coordinate the touch natives want. */
function rapunzelToScreen(ts: Tsum, p: BoardPoint): Point {
  return {
    x: Math.floor(ts.playOffsetX + (p.x + Config.tsumWidth / 2) * ts.playWidth / ts.playResizeWidth),
    y: Math.floor(ts.playOffsetY + (p.y + Config.tsumWidth / 2) * ts.playHeight / ts.playResizeHeight),
  };
}

/** What the drag came to. */
interface RapunzelDrag {
  /** The route as finally drawn, replans included. */
  path: TsumPath;
  moves: number;
  /** Each walk-back as [route index the finger was on, index it went back to, tsums replanned]. */
  rewinds: number[][];
  /** The game's count at the last read, null when unread or never read. */
  count: number | null;
  /** Time spent reading the counter, in ms: the price of the stall checks. */
  countMs: number;
}

/**
 * Draw the chain: one MOVE per tsum, each held `dwellMs`, checked against the
 * game's chain counter as it goes (see `checkEvery`). A stall walks the finger
 * back to the chain's end -- moving back over linked tsums unlinks them -- and
 * the rest is replanned from there by `replan`. A repeat stall at the same
 * place also skips the tsum that failed; one with no route left releases.
 *
 * Its own drag, not `linkTsums` and not `link`: `link`'s `maybeAutoTapSkill`
 * would re-enter this choreography the moment the clear refilled the gauge.
 */
function rapunzelLinkChain(ts: Tsum, path: TsumPath,
    replan: (from: BoardPoint, used: BoardPoint[], maxLen: number) => TsumPath | null): RapunzelDrag {
  const drag: RapunzelDrag = { path: path, moves: 0, rewinds: [], count: null, countMs: 0 };
  // A stopped run draws no new chain -- the same rule as `linkTsums`.
  if (!ts.mayTouchBoard() || path.length < 2) { return drag; }
  const cfg = RapunzelPlusConfig;
  const cap = path.length;
  const pts: Point[] = [];
  for (let i = 0; i < path.length; i++) { pts.push(rapunzelToScreen(ts, path[i])); }
  let finger = pts[0];
  tapDown(finger.x, finger.y, cfg.grabMs);
  try {
    const hop = function(k: number): void {
      moveTo(pts[k].x, pts[k].y, cfg.dwellMs);
      finger = pts[k];
      drag.moves++;
    };
    hop(0);
    let lastBack = -1;
    let i = 1;
    while (i < path.length) {
      hop(i);
      const end = i === path.length - 1;
      if (drag.rewinds.length < cfg.maxRewinds && i + 1 >= cfg.checkFrom
          && !end && (i + 1 - cfg.checkFrom) % cfg.checkEvery === 0
          && path.length - 1 - i > cfg.checkTail) {
        const read = chainCounterRead(ts, chainRouteCentres(path.slice(0, i + 1)));
        const count = read.value;
        drag.count = count;
        drag.countMs += read.ms;
        if (count !== null && count < i + 1 - cfg.countSlack) {
          // The chain ends at path[back]; walk back to it.
          const back = Math.max(0, Math.min(i, count) - 1);
          const again = lastBack >= 0 && back <= lastBack + 1;
          lastBack = back;
          for (let k = i - 1; k >= back; k--) { hop(k); }
          const used = path.slice(0, back + 1);
          if (again && back + 1 < path.length) { used.push(path[back + 1]); }
          const next = replan(path[back], used, cap - back);
          drag.rewinds.push([i, back, next !== null ? next.length - 1 : 0]);
          if (next === null) {
            if (again) {
              drag.path = path.slice(0, back + 1) as TsumPath;
              break;
            }
            // No better route: redraw the old one from the chain's end.
          } else {
            path = path.slice(0, back).concat(next) as TsumPath;
            pts.length = back + 1;
            for (let k = 1; k < next.length; k++) { pts.push(rapunzelToScreen(ts, next[k])); }
            drag.path = path;
          }
          i = back + 1;
          continue;
        }
      }
      i++;
    }
  } finally {
    // The host never lifts the finger itself, so a throw must, or it drags on.
    tapUp(finger.x, finger.y, cfg.releaseMs);
  }
  return drag;
}

/** One look at the board and the chain planned on it. */
interface RapunzelLook {
  board: BoardPoint[];
  /** Tsums the scan read, before any lantern was added. */
  read: number;
  bubbles: GameBubble[];
  lanterns: BoardPoint[];
  plan: { path: TsumPath, fromLantern: boolean } | null;
  looks: number;
  /** Tsums this look left out as still clearing. */
  clearing: number;
}

/**
 * Scan and plan; a plan under `retakeBelow` of `cap`, or short of it with
 * tsums left out as clearing, looks again (`settleMaxWaits` more times),
 * keeping the longest.
 */
function rapunzelPlanned(ts: Tsum, cap: number): RapunzelLook {
  const cfg = RapunzelPlusConfig;
  let best: RapunzelLook | null = null;
  for (let look = 0; look <= cfg.settleMaxWaits && ts.isRunning; look++) {
    if (look > 0) {
      ts.sleep(best !== null && best.clearing > 0
        ? Math.max(cfg.settleRetryMs, Math.min(cfg.clearedWaitMs, fluxClearedInMs(cfg.clearedShare)))
        : cfg.settleRetryMs);
    }
    ts.fluxFilter = true;
    let board: BoardPoint[];
    try {
      board = ts.scanBoardQuick();
    } finally {
      ts.fluxFilter = false;
    }
    // The scan reads bubbles off its own frame; `beforeActivate` spent the
    // hoard, so this is whatever has appeared since.
    const bubbles = ts.gameBubbles.slice();
    const read = board.length;
    // May add lanterns the circle pass missed to `board`.
    const lanterns = rapunzelLanterns(ts, board);
    const plan = rapunzelChain(board, bubbles, cap, lanterns);
    const len = plan ? plan.path.length : 0;
    const clearing = ts.boardClearing.length;
    if (best === null || len > (best.plan ? best.plan.path.length : 0)) {
      best = { board: board, read: read, bubbles: bubbles, lanterns: lanterns, plan: plan, looks: look + 1, clearing: clearing };
    } else {
      best.looks = look + 1;
    }
    // Good enough: at the cap, or near it with nothing left out to wait for.
    if (len >= cap || (len >= cfg.retakeBelow * cap && clearing === 0)) { break; }
  }
  return best || { board: [], read: 0, bubbles: [], lanterns: [], plan: null, looks: 0, clearing: 0 };
}

/**
 * Put her chain's clear into the board's clearing ledger: the chain itself
 * goes in one flash, and each lantern linked in it clears its column later.
 */
function rapunzelNoteClear(path: TsumPath, lanterns: BoardPoint[], releasedAt: number): void {
  const cfg = RapunzelPlusConfig;
  const half = Config.tsumWidth / 2;
  fluxNoteSpots(chainRouteCentres(path), releasedAt + cfg.skillClearMs);
  for (let i = 0; i < lanterns.length; i++) {
    if (path.indexOf(lanterns[i]) < 0) { continue; }
    const column: Point[] = [];
    for (let y = half; y < Config.screenResize; y += half) {
      column.push({ x: lanterns[i].x + half, y: y });
    }
    fluxNoteSpots(column, releasedAt + cfg.lanternClearMs);
  }
}

registerSkill({
  types: [SkillType.RapunzelPlus],
  // No `chainLimits`, deliberately, and it is worth saying why since this skill
  // is the one whose chain most obviously outgrows "Maximum Chain Number".
  //
  // That declaration overrides the setting for the chains the *play loop* links
  // between activations, and those are ordinary chains worth exactly what they
  // clear -- the setting's usual answer is the right one for them. Her own
  // chain never consults the setting in the first place (see `cap` in
  // `afterActivate`), so there is nothing here that needs to buy it out.
  // Room for the colour the ordinary `uniqueTsumCount - 1` cut drops. Every
  // colour is chainable inside the window, so one missing from the board array
  // is tsums the chain cannot reach -- see the header.
  extraClusterSlots: 1,
  beforeActivate: function(ts) {
    // The last look at the board before the activation veil comes down, which
    // is what every reading after the tap is measured against. Before the pops
    // below, not after: they are a burst of taps and a bubble's pop is a bright
    // flash, so a baseline taken on the far side of them measures the flash
    // rather than the board. The bubbles themselves are a few cells of an 8x8
    // downsample; the flash is the whole band.
    rapunzelBaseLight = rapunzelEdgeLight(ts);
    // Spend the hoarded bubbles aimed, before the window opens: a bubble the
    // drag crosses pops mid-travel and ends the chain there, and the chain this
    // skill draws crosses the board. Under All Bubbles ASAP the list is already
    // spent and this is zero taps. The light gate below covers the fall.
    ts.popGameBubbles(ts.gameBubbles.length);
  },
  afterActivate: function(ts, board, activatedAt) {
    const cfg = RapunzelPlusConfig;
    const t0 = activatedAt || Date.now();
    const level = Math.min(Math.max(ts.skillLevel, 1), cfg.chainLength.length);
    // Her level's own cap, and the only one in force here. NOT `skillMaxChain`
    // and never `Config.maxChain`: "Maximum Chain Number" defaults to 3 and is
    // routinely set around 12, both of them far under what she can take, and it
    // caps chains that are worth what they clear -- which this one is not.
    // Structurally so, not just by choice: `rapunzelSearch` calls
    // `findLongestTsumPath` itself, and `calculatePaths` -- the one place the
    // setting is ever consulted -- is not on this path at all. Verified by
    // pinning the setting to 1 and getting all six level caps back unchanged.
    const cap = cfg.chainLength[level - 1];
    // Not a fixed wait: the animation holds the board for most of a second and
    // a scan taken under it is what made this skill chain three. See
    // `litFraction`.
    const light = rapunzelWaitForBoard(ts, t0);

    const look = rapunzelPlanned(ts, cap);
    const path = look.plan ? look.plan.path : null;
    let drag: RapunzelDrag | null = null;
    let dragMs = 0;
    if (path) {
      const dragAt = Date.now();
      drag = rapunzelLinkChain(ts, path, function(from, used, maxLen) {
        return rapunzelChainFrom(from, look.board, used, look.bubbles, maxLen);
      });
      dragMs = Date.now() - dragAt;
      // No settle: the play loop goes on at once, planning around the clear.
      rapunzelNoteClear(drag.path, look.lanterns, Date.now());
    }

    logInfo(Log.Skill.RapunzelDone, {
      skillLevel: level,
      // Named for her level and not `maxChain`, which is the *setting*'s name:
      // reading a log where the two shared one word invited exactly the
      // question of whether the setting was clipping her. It is not, and cannot.
      levelCap: cap,
      // The field to read first when the chain looks short on screen. `chain`
      // is what was *planned*: at `levelCap` with a short chain showing in the
      // game, the plan was fine and the drag lost links -- `moves` and `dragMs`
      // are then the pacing. Well under `levelCap` with a small `read` is the
      // opposite problem, a board scan that put too few tsums in the array.
      chain: path ? path.length : 0,
      read: look.read,
      // Scans taken to reach the cap; tsums the last left out as clearing.
      looks: look.looks,
      clearing: look.clearing,
      // Her own tsums in the chain: does clearing them charge the next gauge?
      myTsums: path ? path.filter(function(p) { return +p.tsumIdx === ts.myTsumIdx; }).length : 0,
      myTsumIdx: ts.myTsumIdx,
      moves: drag ? drag.moves : 0,
      dragMs: dragMs,
      // Lanterns found, and whether the chain started on one.
      lanterns: look.lanterns.length,
      fromLantern: look.plan ? look.plan.fromLantern : false,
      // The drag's stall checks: what it ended up drawing, each walk-back as
      // [finger index, back to, replanned], and the game's last count. A
      // `drawn` under `chain` is a repeat stall that released early.
      drawn: drag ? drag.path.length : 0,
      rewinds: drag ? drag.rewinds : [],
      registered: drag ? drag.count : null,
      countMs: drag ? drag.countMs : 0,
      // How long the activation animation held the board, and whether it was
      // really seen to lift. Three shapes: `lit: true` is the gate working;
      // `sawDark: false` with `litMs` near `litMinMs` is the veil never seen at
      // all, so the baseline is suspect and the wait fell back to the clock;
      // `lit: false` with `litMs` near `litWaitMs` is the board never coming
      // back to its own pre-tap brightness, and everything after it was planned
      // off a veiled board.
      litMs: light.litMs,
      sawDark: light.sawDark,
      lit: light.lit,
      totalMs: Date.now() - t0,
    });
    return true;
  }
});
