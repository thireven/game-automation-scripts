// ---------------------------------------------------------------------------
// Coronation Day Elsa
//
// The activation does not clear anything. It opens a freeze window -- 5s at
// skill level 1 up to 10s at level 6, `durationMs` -- and while it is open every
// chain linked freezes a band of tsums across the board: the line through the
// chain's first and last tsum, extended to both screen edges, one to two tsums
// thick and thicker when the line slants or the chain zigzags off it. Frozen
// tsums stay where they are (the board does not move inside the window), and
// one tap on any of them sets the whole pile off at once.
//
// ## The band thickens with time, and at the end it is the whole board
//
// How much a chain freezes depends on when in the window it is drawn. Read
// off three recordings: at 1-2s in, a band one to two tsums thick
// (`coronation_elsa_2.mp4`, chains A and P); at 5-6s, three to five thick
// (chains C and B, the latter an L-shape that took the left two-thirds); and
// at ~10s -- the play loop's first chains after the choreography handed back
// in `coronation_elsa_3.mp4`, twice -- a single 3-chain froze **every tsum on
// the board** (59, broken for 422,942; 36 for 239,117). Whether that charge
// runs from the activation or from the previous chain is not settled; both
// readings fit every chain seen so far. Either way the window is spent
// waiting, and the chain that matters is the last one.
//
// A frozen tsum that a *second* band runs through counts double at the break,
// with a coin bonus on top (a player's write-up of the skill, and its
// screenshots: overlapped ice is shaded pink). So the choreography draws its
// chains at fixed points of the window (`chainAt`): a mid-window chain whose
// band the final one will overlap, and a final chain as late as the window
// allows, for the whole-board freeze. Then one break, and the bomb it leaves
// is popped. If the charge turns out to run from the activation alone, more
// slots before the last are free doubling; if it runs from the previous
// chain, every extra slot thins the final band -- which is why the slot list
// is a config entry and not a rule.
//
// Each chain is the flattest chain the lowest free row offers
// (`elsaRowChain`): both ends in one row makes the band horizontal, and short
// beats long -- the band reaches the edges whatever the chain's length, and a
// wandering chain only thickens it. Every chain is planned off a capture taken
// right before it (`elsaLook`), so the ice it keeps clear of is read, never
// modelled.
//
// The two earlier versions of this skill, for the record: the first drew
// dozens of quick chains off one capture per pass, bands modelled and chosen
// to avoid each other, and spent the pile mid-window whenever the model ran
// dry; the second swept the board a row at a time with a capture per chain,
// and treated a chain that froze nothing as the window closing -- which on
// `coronation_elsa_3.mp4` fired on the very first chain, drawn under the
// activation animation, and parked the choreography for seven seconds.
//
// ## One tap sets the pile off, so nothing may touch ice until the end
//
// Any contact with a frozen tsum spends the entire pile. Two guards:
//
//   - every chain is planned off a capture taken *after* the previous band
//     formed, so the ice it avoids is read, not modelled;
//   - a candidate whose *drag* would pass within `dragClearance` of read ice or
//     a bubble is not drawn (`elsaPathIsClear`): a bubble touched mid-drag pops
//     and ends the chain there, and ice touched mid-drag is the pile gone.
//
// The premature pops this skill has had, kept for the record: it burst after
// every pass (a reflex, now a decision); a drag landed on ice the model called
// free (the model is gone -- ice is read); the next drag went out before the
// ice had formed (`finalIceMs` now waits for it); a live tsum colour read as
// ice (the `elsaIceAlikes` whitelist); and the ice read too dark for the
// frozen box on a board with dark tsums under it (`frozen.valMin`
// re-measured, see the tuning data).
//
// ## After the break
//
// The break spawns a bomb bubble where the clear count is shown. It is popped
// aimed off one capture once the burst has settled, rather than waited on --
// and leftover ice between windows is kept unless it is pile-sized, because a
// band left standing doubles under the next window's bands (`orderPaths`).
//
// ## Reading the board through the ice
//
// A frozen tsum still detects as a circle and still gets a colour, so it becomes
// an ordinary colour cluster. Every cluster inside the frozen colour box is
// treated as ice -- never planned over, kept clear of by every drag. The box has
// a converse hazard: a live tsum can sit inside it (an event board's pale
// ice-blue fluffy tsum did, and every scan read a dozen-tsum phantom pile). The
// answer is a whitelist read when ice is impossible: until the round's first
// window opens no ice can exist, so any cluster the box matches on those scans
// is a live colour, remembered for the round (`elsaIceAlikes`). The match is
// loose on value and tight on hue and saturation: the same live blue read
// (102, 88, 185) between windows and (99, 84, 208) under the fever tint on
// `coronation_elsa_3.mp4`, and a plain distance of 15 called the second one
// ice -- which cost every window of that run.
//
// The ice also eats colour slots: the board scan keeps its biggest
// `uniqueTsumCount - 1` clusters and each ice shade takes one, so
// `extraClusterSlots` on the declaration makes room for them. See the
// declaration's comment.
// ---------------------------------------------------------------------------

// --- Tuning data ---------------------------------------------------------
//
// ## Reading a frozen tsum
//
// A frozen tsum is drawn as pale blue ice over whatever it was: bright, barely
// saturated, blue-ish. `frozen` is that box in the HSV `findTsums` samples and
// `classifyTsums` averages into a cluster centre (hue 0..179, OpenCV's range).
//
// First measured off four phone captures (frozen clusters at (h 103, s 74,
// v 222), (107, 79, 222), (116, 62, 229)), then re-measured off
// `coronation_elsa_1.mp4` (MuMu, a four-colour board with dark tsums) by
// replaying the scan's own Hough and colour path over frames at 2fps: standing
// ice clustered at hue 96-130, saturation 5-98 and value 177-250 -- two big
// piles at value 185-192, under the old floor of 195, which is how they got
// chained over. The board's live blue sat at (h 101-102, s 110-145, v 200-220)
// throughout, so saturation is the margin that holds: 105 clears the palest
// blue by 5 and the most saturated ice by 7.
var CoronationElsaConfig = {
  // How long the freeze window stays open, by skill level 1-6, in ms. On
  // `coronation_elsa_3.mp4` chains drawn 10.0-10.1s after a level-6 tap still
  // froze, so the table is if anything short.
  durationMs: [5000, 6000, 7000, 8000, 9000, 10000],
  // When the chains go out, as fractions of the window, in order. See the
  // header: the band thickens with time and is the whole board at the end, so
  // the last slot is as late as the window allows and the ones before it are
  // bands for the last one to overlap. Two slots until a recording says
  // whether the charge runs from the activation (add slots) or from the
  // previous chain (keep two, or one).
  chainAt: [0.5, 0.95],
  // The activation animation: no look before this. Seen at ~1.4s on
  // `coronation_elsa_3.mp4`, which is why the first slot is not earlier.
  leadInMs: 1500,
  // Waited out after the final chain before the look the burst aims off: the
  // whole-board freeze had settled 300ms after the release on that recording.
  finalIceMs: 600,
  // How far a tsum may sit above the lowest tsum of a row and still be in that
  // row, in the 200px play square (a tsum is 25, rows pitch about 22). A chain
  // whose ends are both inside one row has a band that is horizontal to within
  // this over its span, which is what keeps the band thin and parallel.
  rowTolerance: 14,
  // Longest chain the row search may return. Short and straight is the point:
  // the band reaches both edges whatever the length, and a long chain wanders
  // off its own line and thickens it.
  rowMaxChain: 5,
  // How close a drag may pass to a frozen tsum or a bubble, same units --
  // about one tsum radius. A linkable hop is `tsumWidth * linkReach` = 47.5px,
  // so two free tsums can sit one hop apart with ice between them.
  dragClearance: 13,
  // What a frozen tsum's cluster centre looks like. See the note above.
  frozen: {hueMin: 95, hueMax: 135, satMax: 105, valMin: 170},
  // How far a centre may sit from a remembered ice-alike on each axis and
  // still be that live colour. Hue and saturation re-read within ~5 of
  // themselves scan to scan, and the nearest measured real ice sits 8 in hue
  // and 18 in saturation from a known ice-alike, so 12 and 15 keep it out.
  // Value moves with the fever tint -- one live blue read 185 and 208 in the
  // same round -- so it gets the room it needs.
  iceAlikeMatch: {hue: 12, sat: 15, val: 40},
  // Taps spent on the pile. One is enough to set it off; the rest insure
  // against a position the read had slightly wrong.
  burstTaps: 3,
  burstTapDuring: 10,
  // Waited out after a look pops bubbles, before the board is re-captured:
  // tsums slide into the space a popped bubble leaves.
  bubbleSettleMs: 200,
  // An ice-free look that reads fewer than this fraction of the tsums the
  // board is known to hold is a board mid-fall -- the window opening on the
  // previous batch's refill, a pop's slide, a burst's refill -- and is waited
  // out (`settleRetryMs`, up to `settleMaxWaits` times) rather than chained.
  // Ice-free looks only: an iced board under-reads (frozen clusters eat colour
  // slots) and must never stall the sweep.
  settledFraction: 0.75,
  settleRetryMs: 250,
  settleMaxWaits: 5,
  // Waited out after a burst before anything else works the board: the pile
  // going off is a large clear and the refill scales with it. Base plus
  // per-tsum, capped.
  postBurstSettleMs: 250,
  postBurstSettlePerTsumMs: 6,
  postBurstSettleMaxMs: 900,
  // Waited out when a look offers no chain at all before looking again.
  rescanIdleMs: 300,
  // Leftover ice read between windows this big or bigger is a burst that
  // missed, and is spent (grid and all). Smaller is a band left standing on
  // purpose: it doubles under the next window's bands.
  leftoverBurstMin: 8,
  // The fallback when the closing burst has no ice read to aim at: a blind
  // grid over the play area, in logical px. A tap on an ordinary tsum is not a
  // drag, so the game ignores it.
  blindStep: 220
};

// Live colours seen inside the frozen box on scans where ice was impossible,
// in cluster HSV (`b`/`g`/`r` = hue/saturation/value). Per round: the colour
// lineup changes between rounds. `elsaWindowRound` is the last round a freeze
// window ran in -- while it differs from the current round, no ice can exist,
// which is what makes a scan safe to learn from.
var elsaIceAlikes: Color[] = [];
var elsaIceAlikeRound = 0;
var elsaWindowRound = 0;

/**
 * Whether a cluster centre matches a colour known to be alive, not ice: within
 * `iceAlikeMatch` of a remembered one on every axis. Per axis and not a
 * distance, because value drifts far more than hue or saturation do.
 */
function elsaIsIceAlike(c: Color): boolean {
  const m = CoronationElsaConfig.iceAlikeMatch;
  for (let i = 0; i < elsaIceAlikes.length; i++) {
    const a = elsaIceAlikes[i];
    if (Math.abs(a.b - c.b) <= m.hue && Math.abs(a.g - c.g) <= m.sat
        && Math.abs(a.r - c.r) <= m.val) {
      return true;
    }
  }
  return false;
}

/**
 * Learn this round's ice-alikes off a scan that cannot be looking at ice:
 * called from `orderPaths`, and a no-op once the round's first window has
 * opened. Any cluster the frozen box matches before then is a live colour.
 */
function elsaNoteIceAlikes(ts: Tsum): void {
  if (elsaIceAlikeRound !== gLogRoundId) {
    elsaIceAlikes = [];
    elsaIceAlikeRound = gLogRoundId;
  }
  if (elsaWindowRound === gLogRoundId) { return; }
  const box = CoronationElsaConfig.frozen;
  const clusters = ts.boardClusters;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    if (c.b >= box.hueMin && c.b <= box.hueMax
        && c.g <= box.satMax && c.r >= box.valMin && !elsaIsIceAlike(c)) {
      elsaIceAlikes.push({b: c.b, g: c.g, r: c.r});
      logDebug(Log.Skill.ElsaIceAlike, {hue: c.b, sat: c.g, val: c.r});
    }
  }
}

/**
 * Which of the last scan's colour clusters read as ice, flagged by cluster
 * index. Read off `ts.boardClusters` (`b`/`g`/`r` = hue/saturation/value).
 *
 * All matches, not the best one: a board part-way through freezing carries ice
 * at more than one shade. The one exception is a cluster matching a remembered
 * ice-alike: a live colour, however icy it reads.
 */
function elsaFrozenClusters(ts: Tsum): boolean[] {
  const box = CoronationElsaConfig.frozen;
  const clusters = ts.boardClusters;
  const frozen: boolean[] = [];
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    frozen.push(c.b >= box.hueMin && c.b <= box.hueMax
      && c.g <= box.satMax && c.r >= box.valMin && !elsaIsIceAlike(c));
  }
  return frozen;
}

/** The paths that are not over ice. */
function elsaLiveChains(paths: TsumPath[], frozen: boolean[]): TsumPath[] {
  const out: TsumPath[] = [];
  for (let i = 0; i < paths.length; i++) {
    const idx = paths[i].tsumIdx;
    if (idx === undefined || !frozen[idx]) { out.push(paths[i]); }
  }
  return out;
}

/**
 * What a drag has to keep away from: a frozen tsum, or a bubble still on the
 * board. `pad` is the obstacle's own size beyond a tsum's -- a bubble's read
 * radius over a tsum radius. Board points carry no pad.
 */
interface ElsaObstacle {
  x: number;
  y: number;
  pad?: number;
}

/**
 * Whether every drag segment of `path` keeps `clearance` (plus each obstacle's
 * own `pad`) away from all of `obstacles`. A blocked path is simply not drawn
 * this look; the next capture, or a pop, may free its surroundings.
 */
function elsaPathIsClear(path: TsumPath, obstacles: ElsaObstacle[], clearance: number): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    for (let j = 0; j < obstacles.length; j++) {
      const p = obstacles[j];
      const keep = clearance + (p.pad || 0);
      // Nearest point of the segment to p, by clamped projection.
      let t = lenSq > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const ex = a.x + t * dx - p.x, ey = a.y + t * dy - p.y;
      if (ex * ex + ey * ey <= keep * keep) { return false; }
    }
  }
  return true;
}

/**
 * The free tsums as rows, lowest row first: each row is its lowest member and
 * everything within `rowTolerance` above it. Board points are top-left corners,
 * so larger y is lower on the screen.
 */
function elsaRows(free: BoardPoint[]): BoardPoint[][] {
  const tol = CoronationElsaConfig.rowTolerance;
  const sorted = free.slice().sort(function(a, b) { return b.y - a.y; });
  const rows: BoardPoint[][] = [];
  const taken: boolean[] = [];
  for (let i = 0; i < sorted.length; i++) { taken.push(false); }
  for (let i = 0; i < sorted.length; i++) {
    if (taken[i]) { continue; }
    const row = [sorted[i]];
    taken[i] = true;
    for (let j = i + 1; j < sorted.length; j++) {
      if (!taken[j] && sorted[i].y - sorted[j].y <= tol) {
        row.push(sorted[j]);
        taken[j] = true;
      }
    }
    rows.push(row);
  }
  return rows;
}

/** How far a chain's end line leans off horizontal: |dy| per unit of |dx|. */
function elsaSlant(path: TsumPath): number {
  const a = path[0], b = path[path.length - 1];
  return Math.abs(b.y - a.y) / Math.max(Math.abs(b.x - a.x), 1);
}

/**
 * The next chain of the sweep: the flattest chain the lowest chainable row
 * offers, with the rows above it as fallbacks.
 *
 * A row is tried alone first. If it has no trio of its own, it is tried joined
 * to the row above, keeping only chains whose two *ends* still sit within one
 * row of each other -- the end line is the band, and the tsums between the
 * ends only thicken it. `obstacles` is the read ice plus any bubbles, and a
 * chain whose drag would touch one is not a candidate.
 *
 * Returns the chain and the index of the row it stands on, or null when no
 * row can be chained -- the board is played out.
 */
function elsaRowChain(ts: Tsum, free: BoardPoint[], obstacles: ElsaObstacle[]):
    { path: TsumPath, row: number } | null {
  const cfg = CoronationElsaConfig;
  const rows = elsaRows(free);
  for (let r = 0; r < rows.length; r++) {
    for (let join = 0; join < 2 && r + join < rows.length; join++) {
      const strip = join === 0 ? rows[r] : rows[r].concat(rows[r + 1]);
      if (strip.length < 3) { continue; }
      const paths = calculatePaths(strip, ts.myTsumIdx, skillMyTsumPriority(ts), cfg.rowMaxChain);
      let best: TsumPath | null = null;
      let bestSlant = Infinity;
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (Math.abs(p[0].y - p[p.length - 1].y) > cfg.rowTolerance) { continue; }
        if (!elsaPathIsClear(p, obstacles, cfg.dragClearance)) { continue; }
        const slant = elsaSlant(p);
        // Flattest wins; between equals, the shorter chain wanders less.
        if (best === null || slant < bestSlant || (slant === bestSlant && p.length < best.length)) {
          best = p;
          bestSlant = slant;
        }
      }
      if (best !== null) { return {path: best, row: r}; }
    }
  }
  return null;
}

/**
 * How long to keep the board after a burst of `pile` tsums. The refill scales
 * with the clear, so a flat wait cannot serve both a 16-tsum pop and a
 * whole-board one. Capped, because the wait comes out of the window.
 */
function elsaPostBurstSettleMs(pile: number): number {
  const cfg = CoronationElsaConfig;
  return Math.min(cfg.postBurstSettleMaxMs,
    cfg.postBurstSettleMs + pile * cfg.postBurstSettlePerTsumMs);
}

/**
 * Set off the pile, and say how many tsums it was aimed at.
 *
 * Aimed taps first, top of the board down and spread evenly down the pile, so
 * a pile the read has slightly wrong is still covered. Then, only when `grid`
 * says so, the blind sweep: the closing burst gets it, because after the
 * window a missed pile is lost for good and the ~25 taps cost round time only.
 * A mid-window burst does not -- its pile came off a fresh capture, and a grid
 * inside the window taps ice the read never claimed.
 *
 * A tap is not a drag, so one that lands on an ordinary tsum links nothing and
 * the game ignores it.
 */
Tsum.prototype.elsaBurstFrozen = function(frozen, grid) {
  // Raw taps below bypass `ts.tap`, so the stopped-run rule is applied here.
  if (!this.isRunning) { return 0; }
  const cfg = CoronationElsaConfig;
  // Highest ice first, working down: a tap spends the group of ice it lands
  // in, clearing a group drops everything above it, and nothing below a tap
  // moves -- so top-down keeps each position true as it lands. A copy -- the
  // caller's list is its own.
  const pile = frozen.slice().sort(function(a, b) { return a.y - b.y; });
  const taps = Math.min(cfg.burstTaps, pile.length);
  const step = taps > 0 ? Math.max(1, Math.floor(pile.length / taps)) : 1;
  for (let i = 0; i < taps; i++) {
    const p = pile[i * step];
    // Board points are the tsum's top-left corner in the 200px play square, the
    // shape `linkTsums` converts from -- so the half-width goes back on here too.
    const x = Math.floor(this.playOffsetX
      + (p.x + Config.tsumWidth / 2) * this.playWidth / this.playResizeWidth);
    const y = Math.floor(this.playOffsetY
      + (p.y + Config.tsumWidth / 2) * this.playHeight / this.playResizeHeight);
    tap(x, y, cfg.burstTapDuring);
  }
  // Rows top-down as well, for the same reason.
  if (grid) {
    for (let y = Button.gameBubblesFrom.y; y <= Button.gameBubblesTo.y; y += cfg.blindStep) {
      for (let x = Button.gameBubblesFrom.x; x <= Button.gameBubblesTo.x; x += cfg.blindStep) {
        this.tap({x: x, y: y}, cfg.burstTapDuring);
      }
    }
  }
  logDebug(Log.Skill.ElsaBurst, { aimedAt: taps, read: frozen.length, grid: grid });
  return taps;
};

/**
 * One settled look at the board: capture, split the tsums into free and ice,
 * and hand back what a drag must keep away from.
 *
 * Two things send it back for another capture, each a bounded number of
 * times, and only ever on an ice-free read:
 *
 *   - **a board mid-fall.** The board moves at exactly three moments -- the
 *     window opening on the previous batch's refill, a pop's slide, a burst's
 *     refill -- and every one of them leaves the board ice-free, so an
 *     ice-free look that reads clearly fewer tsums than the board is known to
 *     hold (`expected`) is a fall in flight. Chaining it drags at air.
 *   - **bubbles.** A bubble holes every band drawn through it and pops under
 *     any drag across it, and the break's bomb is a bubble too. The capture
 *     already knows where they are, so they are popped aimed and the board
 *     looked at again after the fall.
 *
 * Ice-free only, both: a tap is what sets a pile off, so while ice stands the
 * bubbles stay and become drag obstacles instead.
 */
Tsum.prototype.elsaLook = function(closesAt, expected) {
  const cfg = CoronationElsaConfig;
  const expect = expected || 0;
  let free: BoardPoint[] = [];
  let iced: BoardPoint[] = [];
  let waits = 0;
  let pops = 0;
  for (;;) {
    const board = this.scanBoardQuick();
    const frozenCluster = elsaFrozenClusters(this);
    free = [];
    iced = [];
    for (let i = 0; i < board.length; i++) {
      if (frozenCluster[+board[i].tsumIdx]) { iced.push(board[i]); } else { free.push(board[i]); }
    }
    if (iced.length === 0) {
      if (waits < cfg.settleMaxWaits && free.length < cfg.settledFraction * expect
          && Date.now() + cfg.settleRetryMs < closesAt) {
        waits++;
        this.sleep(cfg.settleRetryMs);
        continue;
      }
      if (pops < 2 && this.gameBubbles.length > 0
          && Date.now() + cfg.bubbleSettleMs < closesAt) {
        pops++;
        this.popGameBubbles(this.gameBubbles.length);
        this.sleep(cfg.bubbleSettleMs);
        continue;
      }
    }
    break;
  }
  const obstacles: ElsaObstacle[] = iced.slice();
  for (let i = 0; i < this.gameBubbles.length; i++) {
    const b = this.gameBubbles[i];
    obstacles.push({
      x: b.x - Config.tsumWidth / 2,
      y: b.y - Config.tsumWidth / 2,
      pad: Math.max(0, b.r - Config.tsumWidth / 2),
    });
  }
  return { free: free, iced: iced, obstacles: obstacles, waits: waits, pops: pops };
};

/**
 * Play the freeze window: a chain at each of `chainAt`, the last as late as
 * the window allows, then one break and the bomb it leaves popped.
 *
 * Anchored to `activatedAt` rather than to when this was entered, so the window
 * is the game's and not the script's. `expectTsums` is the population of the
 * board the play loop scanned before activating, for the settle gate.
 */
Tsum.prototype.useCoronationElsaSkill = function(activatedAt, expectTsums) {
  const cfg = CoronationElsaConfig;
  const t0 = activatedAt || Date.now();
  const level = Math.min(Math.max(this.skillLevel, 1), cfg.durationMs.length);
  const windowMs = cfg.durationMs[level - 1];
  const closesAt = t0 + windowMs;

  // How many tsums the board is believed to hold: seeded from the play loop's
  // scan and raised to the best count any look reads.
  let expected = expectTsums || 0;
  let looks = 0;
  let chains = 0;
  let missed = 0;
  let aimedTaps = 0;
  // The last read that saw ice: what the break aims at.
  let iced: BoardPoint[] = [];
  for (let s = 0; s < cfg.chainAt.length && this.isRunning; s++) {
    const slotAt = t0 + Math.max(cfg.leadInMs, cfg.chainAt[s] * windowMs);
    // A slot keeps looking until it has drawn its chain or the next slot is
    // due; the last one has until the window closes.
    const slotEnds = s + 1 < cfg.chainAt.length
      ? t0 + cfg.chainAt[s + 1] * windowMs : closesAt;
    this.sleepUntil(slotAt);
    let drawn = false;
    while (this.isRunning && !drawn) {
      const look = this.elsaLook(slotEnds, expected);
      looks++;
      const read = look.free.length + look.iced.length;
      if (read > expected) { expected = read; }
      if (look.iced.length > 0) { iced = look.iced; }
      const pick = elsaRowChain(this, look.free, look.obstacles);
      logDebug(Log.Skill.ElsaPass, {
        slot: s,
        atMs: Date.now() - t0,
        free: look.free.length,
        iced: look.iced.length,
        waits: look.waits,
        pops: look.pops,
        row: pick === null ? -1 : pick.row,
        chainLen: pick === null ? 0 : pick.path.length,
      });
      if (pick !== null) {
        // `linkTsums` and not `link`: its bubble pop and its skill check both
        // belong to the play loop, and the second would nest a window in
        // this one.
        this.linkTsums(pick.path);
        chains++;
        drawn = true;
        break;
      }
      if (Date.now() + cfg.rescanIdleMs >= slotEnds) { break; }
      this.sleep(cfg.rescanIdleMs);
    }
    if (!drawn) { missed++; }
  }
  if (this.isRunning) {
    // Let the last band form, read the pile once more, and break it. The look
    // is bounded to now, so it neither waits on a fall nor pops anything.
    this.sleep(cfg.finalIceMs);
    const last = this.elsaLook(Date.now(), expected);
    looks++;
    if (last.iced.length > 0) { iced = last.iced; }
    aimedTaps += this.elsaBurstFrozen(iced, true);
    // The break is a large clear; let it settle, then one look for the bomb it
    // spawned (where the clear count was shown) and pop it aimed. The play
    // loop's own scan follows the moment this hands back.
    this.sleep(elsaPostBurstSettleMs(iced.length));
    this.scanBoardQuick();
    this.popGameBubbles(this.gameBubbles.length);
    this.sleepUntil(closesAt);
  }

  logInfo(Log.Skill.ElsaDone, {
    skillLevel: level,
    windowMs: windowMs,
    looks: looks,
    chains: chains,
    // Slots that found no chain to draw before their time ran out.
    missed: missed,
    // The pile as last read going into the break. Near zero with the chains
    // drawn means something touched ice, or the final chain froze nothing.
    icedLast: iced.length,
    aimedTaps: aimedTaps,
    totalMs: Date.now() - t0,
  });
};

registerSkill({
  types: [SkillType.CoronationElsa],
  // She spends every bubble she sees, and the declaration is what says so --
  // aimed on the way in (`beforeActivate`), inside each look and after the
  // break, whatever the Bubble Strategy setting says. The consequence is the
  // one the flag exists for: an activation that emptied the board must not
  // count towards the play loop's own sweep.
  //
  // Uncapped-ish chains in ordinary play, whatever "Maximum Chain Number"
  // says: between windows the only job is refilling the gauge, which counts
  // tsums cleared, and three ten-chains fill it far faster than three
  // three-chains for the same scan gap.
  chainLimits: { maxChain: 5 },
  // Room for her own ice on top of the board's colours. Every shade the ice
  // reads at is an ordinary cluster to the scan and takes one of the
  // `uniqueTsumCount - 1` slots it keeps; ice has been measured at three
  // shades on one part-frozen board, and a colour without a slot is not in
  // the board array for any look to plan over. Four: three for the measured
  // shades and one for the colour the ordinary cut drops.
  extraClusterSlots: 4,
  sweepsBubbles: true,
  orderPaths: function(ts, paths, board) {
    // Before the round's first window, a cluster the frozen box matches is a
    // live colour -- learn it now, or it plays as a phantom pile all round.
    elsaNoteIceAlikes(ts);
    const frozen = elsaFrozenClusters(ts);
    // Ice read here is *leftover*. A pile-sized leftover is a closing burst
    // that missed, and is spent, grid and all -- out here there is no fresh
    // pile for a stray tap to cost. A smaller one is a band left standing on
    // purpose: it doubles under the next window's bands, so it is kept and
    // only chained around.
    const leftover: BoardPoint[] = [];
    for (let i = 0; i < board.length; i++) {
      if (frozen[+board[i].tsumIdx]) { leftover.push(board[i]); }
    }
    if (leftover.length >= CoronationElsaConfig.leftoverBurstMin) {
      ts.elsaBurstFrozen(leftover, true);
    }
    // Beyond that, only ever a filter: the ordering `calculatePaths` produced
    // is already longest-first, which is what this skill wants too.
    return elsaLiveChains(paths, frozen);
  },
  beforeActivate: function(ts) {
    // Spend whatever bubbles the cycle's own scan still holds, aimed, before
    // the window opens: a bubble holes every band drawn through it and breaks
    // any chain dragged over it, and there is no chain in the window worth
    // saving one for.
    ts.popGameBubbles(ts.gameBubbles.length);
  },
  afterActivate: function(ts, board, activatedAt) {
    // Ice exists in this round from here on, so the ice-alike learning stops.
    elsaWindowRound = gLogRoundId;
    // The board is the play loop's scan from before its last batch linked, so
    // its length is a full board's population -- the settle gate's seed.
    ts.useCoronationElsaSkill(activatedAt, board ? board.length : 0);
    // Always "did not fire". The gauge reads Active through the freeze window's
    // own animation, so a `true` here buys the whole choreography again on a
    // skill that is not actually ready.
    return false;
  }
});
