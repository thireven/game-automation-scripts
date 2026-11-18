// ---------------------------------------------------------------------------
// Sorcerer Mickey+
//
// His activation puts hats above the fever bar (2, 2, 3, 3, 4, 4 by skill
// level) and makes nothing else. The hats last until used, and every chain of
// 3+ while they do makes a magic bubble (dark navy glass inside a neon ring),
// with a bigger blast from a 7+ chain. A magic bubble is dragged and dropped,
// which uses a hat and sets off a blast round *every* spot dropped on so far --
// the first spot blasts once per drop, the last once. The blast's ring is ~260
// logical px in radius at SL6.
//
// So the activation only arms the hats for this round (`gSorcerer`). While
// armed:
//   - each scan links only its longest chain, uncapped (`orderPaths`,
//     `chainLimits`), so each hat's bubble comes from the best chain there is;
//   - each scan looks for magic bubbles first (`watchScan`) and drags each to
//     the next spot of a layout spread to cover the most board (`spots`): two
//     to the left and right halves, three to the bottom corners and the top
//     middle, four to the four corners;
//   - the Bubble Strategy pops nothing (`claimsBubbles`): a magic bubble
//     tapped in place loses its spot;
//   - the skill is held (`stillRunning`): an activation with hats left is not
//     known to do anything, so the gauge waits for them to be spent.
//
// The bubbles are found by colour, not Hough (`sorcererFindIn`): glass-coloured
// samples on a grid over the play square, clustered, and a cluster kept only
// when its middle is glass with nothing dark in it (a tsum's eyes) and a bright
// ring goes round it. On four SL6 screenshots that found every waiting bubble
// but one washed out by the dragged bubble's ring, and nothing else; the
// nearest miss was the pale COMBO counter at the top of the board.
//
// A drop is checked straight after: gone from where it was, and not left on
// the spot. A bubble still where its drag started is dragged again, then
// tapped (`dragRetries`); one a tap did not clear either is left alone.
// ---------------------------------------------------------------------------

// --- Tuning data -----------------------------------------------------------

var SorcererMickeyConfig = {
  // Hats (drops) by skill level 1-6.
  hats: [2, 2, 3, 3, 4, 4],
  // Drop spots in logical px, by hat count, in the order they are used. The
  // play square is y 465-1545; neighbouring spots sit about a blast's width
  // apart and inside the bowl. The four are where, and in the order, the
  // player dropped them on SL6 screenshots.
  spots: {
    2: [{x: 280, y: 990}, {x: 800, y: 990}],
    3: [{x: 280, y: 1230}, {x: 800, y: 1230}, {x: 540, y: 760}],
    4: [{x: 280, y: 750}, {x: 800, y: 1230}, {x: 280, y: 1230}, {x: 800, y: 750}],
  } as { [hats: number]: Point[] },
  // Disarm when no magic bubble has been seen for this long since the
  // activation or the last drop. Every chain makes one, so this is a skill
  // level set too high or bubbles the reader misses -- and everything armed
  // holds (one chain a scan, no pops, no skill) waits on it.
  idleMs: 10000,
  // Most one scan spends on drops, in gestures (beyond the hats left) and
  // time; the rest waits for the next scan.
  extraTriesPerScan: 2,
  scanBudgetMs: 6000,
  // A bubble that moved at most `restPx` (play-square px) between two looks is
  // at rest. At most `restLooks` looks are spent waiting for that.
  lookMs: 80,
  restPx: 3,
  restLooks: 4,
  // The drag: held `grabMs`, moved in `stepPx` (logical px) steps of `moveMs`,
  // held `dropHoldMs` on the spot so the game takes it there, then let go.
  grabMs: 60,
  stepPx: 80,
  moveMs: 20,
  dropHoldMs: 150,
  // After a drop, before the look that checks it: the blast going off.
  blastMs: 500,
  // A bubble within `samePx` (play-square px) of where its drag started did
  // not move. After `dragRetries` of those it is tapped instead.
  samePx: 6,
  dragRetries: 2,
  // Screens saved per run when an armed window runs out with hats left (diagnostics).
  missShotMax: 3,
};

// The magic bubble on the 200px play square: the glass reads r 60-125,
// g 90-150, b 140-215 (g above r); the ring is near white at radius 11-16.
var SorcererBubble = {
  // Grid spacing over the play square, and the fewest glass samples a cluster
  // needs. A bubble gives 9-13 at step 4.
  step: 4,
  minSamples: 4,
  // Middle: samples `coreStep` apart within `coreRadius`; `coreShare` must be
  // glass, and none may have its brightest channel under `coreFloor` (the
  // glass's darkest reads 123; a tsum's eyes and outline 30-50).
  coreRadius: 6,
  coreStep: 2,
  coreShare: 0.72,
  coreFloor: 90,
  // Ring: `rays` rays, each a hit when any radius `rimFrom`-`rimTo` has every
  // channel >= `rimMin`. Bubbles hit all 16; the COMBO counter 13.
  rays: 16,
  rimFrom: 10,
  rimTo: 17,
  rimMin: 165,
  rimRays: 14,
};

// ---- Reader ---------------------------------------------------------------

/** One magic bubble, in play-square px, with the two readings that kept it. */
interface SorcererBubbleSeen extends Point {
  core: number;
  rim: number;
}

/**
 * The glass inside a magic bubble: a muted mid blue. Sorcerer Mickey's own hat
 * is far more saturated (red near 0) and the board's gaps far darker.
 */
function sorcererGlass(c: Color): boolean {
  const hi = Math.max(c.r, c.g, c.b);
  const lo = Math.min(c.r, c.g, c.b);
  return c.b >= 125 && c.r >= 45 && c.g - c.r >= 8 && c.b - c.r >= 35 && c.b - c.g >= 15
    && hi <= 230 && hi - lo <= 0.62 * hi;
}

/** The middle's and the ring's sample offsets, the same for every cluster. */
function sorcererOffsets(): { core: Point[]; rim: Point[] } {
  const cfg = SorcererBubble;
  const core: Point[] = [];
  for (let dy = -cfg.coreRadius; dy <= cfg.coreRadius; dy += cfg.coreStep) {
    for (let dx = -cfg.coreRadius; dx <= cfg.coreRadius; dx += cfg.coreStep) {
      if (dx * dx + dy * dy <= cfg.coreRadius * cfg.coreRadius) { core.push({x: dx, y: dy}); }
    }
  }
  const rim: Point[] = [];
  for (let k = 0; k < cfg.rays; k++) {
    const a = 2 * Math.PI * k / cfg.rays;
    for (let r = cfg.rimFrom; r <= cfg.rimTo; r++) {
      rim.push({x: r * Math.cos(a), y: r * Math.sin(a)});
    }
  }
  return {core: core, rim: rim};
}

/** The magic bubbles on a play-square image (`playScreenshotSquare`). */
function sorcererFindIn(img: NativeImage): SorcererBubbleSeen[] {
  const cfg = SorcererBubble;
  const size = getImageSize(img);
  const cols = Math.ceil((size.width - 1) / cfg.step);
  const rows = Math.ceil((size.height - 1) / cfg.step);
  const grid: Point[] = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      grid.push({x: 1 + gx * cfg.step, y: 1 + gy * cfg.step});
    }
  }
  const glass = getImageColors(img, grid).map(sorcererGlass);

  // Clusters of touching glass samples (8-connected), as centroids.
  const centres: Point[] = [];
  const seen = new Uint8Array(glass.length);
  for (let i = 0; i < glass.length; i++) {
    if (!glass[i] || seen[i]) { continue; }
    seen[i] = 1;
    const stack = [i];
    let n = 0, sx = 0, sy = 0;
    while (stack.length > 0) {
      const k = stack.pop() as number;
      n++;
      sx += grid[k].x;
      sy += grid[k].y;
      const gx = k % cols;
      const gy = (k - gx) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) { continue; }
          const j = ny * cols + nx;
          if (glass[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (n >= cfg.minSamples) { centres.push({x: sx / n, y: sy / n}); }
  }
  if (centres.length === 0) { return []; }

  // Each cluster's middle and ring, in one read.
  const off = sorcererOffsets();
  const clamp = (v: number, max: number) => Math.min(Math.max(Math.round(v), 0), max - 1);
  const pts: Point[] = [];
  for (const c of centres) {
    for (const o of off.core) { pts.push({x: clamp(c.x + o.x, size.width), y: clamp(c.y + o.y, size.height)}); }
    for (const o of off.rim) { pts.push({x: clamp(c.x + o.x, size.width), y: clamp(c.y + o.y, size.height)}); }
  }
  const colors = getImageColors(img, pts);
  const radii = cfg.rimTo - cfg.rimFrom + 1;
  const out: SorcererBubbleSeen[] = [];
  let at = 0;
  for (const c of centres) {
    let core = 0, dark = 0;
    for (let k = 0; k < off.core.length; k++) {
      const col = colors[at++];
      if (sorcererGlass(col)) { core++; }
      if (Math.max(col.r, col.g, col.b) < cfg.coreFloor) { dark++; }
    }
    let rim = 0;
    for (let k = 0; k < cfg.rays; k++) {
      let hit = false;
      for (let r = 0; r < radii; r++) {
        const col = colors[at++];
        if (Math.min(col.r, col.g, col.b) >= cfg.rimMin) { hit = true; }
      }
      if (hit) { rim++; }
    }
    const share = core / off.core.length;
    if (share >= cfg.coreShare && dark === 0 && rim >= cfg.rimRays) {
      out.push({x: c.x, y: c.y, core: Math.round(share * 100) / 100, rim: rim});
    }
  }
  return out;
}

/** The magic bubbles on a fresh capture. */
function sorcererFind(ts: Tsum): SorcererBubbleSeen[] {
  const img = ts.playScreenshotSquare();
  try {
    return sorcererFindIn(img);
  } finally {
    releaseImage(img);
  }
}

/** Distance from `p` to the nearest of `list` (Infinity when empty). */
function sorcererNearest(list: Point[], p: Point): number {
  let best = Infinity;
  for (const q of list) { best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y)); }
  return best;
}

/** From the look `first`, looks until two in a row agree on every bubble, or `restLooks` run out. */
function sorcererAtRest(ts: Tsum, first: SorcererBubbleSeen[]): SorcererBubbleSeen[] {
  const cfg = SorcererMickeyConfig;
  let last = first;
  for (let i = 1; i < cfg.restLooks && last.length > 0; i++) {
    ts.sleep(cfg.lookMs);
    const next = sorcererUnignored(sorcererFind(ts));
    const still = next.length === last.length
      && next.every((b) => sorcererNearest(last, b) <= cfg.restPx);
    last = next;
    if (still) { break; }
  }
  return last;
}

/** A play-square point in logical px (the play square is the game's full 1080 width). */
function sorcererLogical(ts: Tsum, p: Point): Point {
  const k = 1080 / ts.playResizeWidth;
  return {x: Math.round(p.x * k), y: Math.round(PlayAreaTopY + p.y * k)};
}

// ---- State ------------------------------------------------------------------

/** One activation's hats: what is left of them, and how the drops went. */
var gSorcerer = {
  /**
   * `ts.roundUid` of the round armed in; '' when not armed. Not
   * `roundStartedAt`, which a pause or the game going away moves on.
   */
  round: '',
  hats: 0,
  /** Hats the activation gave: picks the layout. */
  given: 0,
  /** Index of the next spot in the layout. */
  next: 0,
  drops: 0,
  taps: 0,
  armedAt: 0,
  /** Last time a magic bubble was seen or dropped, for `idleMs`. */
  activeAt: 0,
  /** Where a drag left its bubble unmoved, and how many times in a row. */
  stuckAt: null as Point | null,
  stuck: 0,
  /** Where a tap failed too: a bubble the game will not let go, or not one at all. */
  ignored: [] as Point[],
};

/** The look's bubbles less those set aside this window. */
function sorcererUnignored(bubbles: SorcererBubbleSeen[]): SorcererBubbleSeen[] {
  const cfg = SorcererMickeyConfig;
  return gSorcerer.ignored.length === 0 ? bubbles
    : bubbles.filter((b) => sorcererNearest(gSorcerer.ignored, b) > cfg.samePx);
}

/** Whether hats from an activation this round are left. */
function sorcererArmed(ts: Tsum): boolean {
  return gSorcerer.round !== '' && gSorcerer.round === ts.roundUid
    && ts.roundStartedAt !== 0 && gSorcerer.hats > 0;
}

/** End the window, saying why and how it went. */
function sorcererDisarm(ts: Tsum, why: string): void {
  const st = gSorcerer;
  if (st.round === '') { return; }
  const fields = { why: why, given: st.given, drops: st.drops, taps: st.taps, left: st.hats,
    ignored: st.ignored.length, ms: Date.now() - st.armedAt };
  if (st.hats > 0 && st.drops === 0 && st.taps === 0) {
    logWarn(Log.Skill.SorcererNone, fields);
  } else {
    logInfo(Log.Skill.SorcererDone, fields);
  }
  if (why === 'idle') { sorcererSaveMissFrame(ts); }
  st.round = '';
  st.hats = 0;
}

/** Arm a new activation's hats, closing what was left of the last one. */
function sorcererArm(ts: Tsum): void {
  const cfg = SorcererMickeyConfig;
  const st = gSorcerer;
  if (st.round !== '') {
    sorcererDisarm(ts, st.round === ts.roundUid ? 'reactivated' : 'roundOver');
  }
  const level = Math.min(Math.max(Math.round(ts.skillLevel) || 1, 1), cfg.hats.length);
  st.round = ts.roundUid;
  st.given = st.hats = cfg.hats[level - 1];
  st.next = st.drops = st.taps = st.stuck = 0;
  st.stuckAt = null;
  st.ignored = [];
  st.armedAt = st.activeAt = Date.now();
  logDebug(Log.Skill.SorcererArmed, { skillLevel: level, hats: st.hats });
}

// ---- Choreography ---------------------------------------------------------

/** Drag a bubble from `from` to `to` (logical px) and drop it there. */
function sorcererDrag(ts: Tsum, from: Point, to: Point): void {
  const cfg = SorcererMickeyConfig;
  ts.tapDown(from, 20);
  ts.sleep(cfg.grabMs);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / cfg.stepPx));
  for (let i = 1; i <= steps; i++) {
    ts.moveTo({x: Math.round(from.x + dx * i / steps), y: Math.round(from.y + dy * i / steps)}, cfg.moveMs);
  }
  ts.sleep(cfg.dropHoldMs);
  ts.tapUp(to, 20);
}

/** Screens saved this run when a window ran out with hats left. */
var gSorcererMissShots = 0;

/** Save the screen at an idle disarm, so the reader can be tuned against it. */
function sorcererSaveMissFrame(ts: Tsum): void {
  if (gSorcererMissShots >= SorcererMickeyConfig.missShotMax) { return; }
  gSorcererMissShots++;
  const path = ts.devicePath + '/tmp/sorcerer-idle_' + Date.now() + '.png';
  const img = ts.dialogScreenshot(ts.originScreenWidth, ts.originScreenHeight);
  try {
    saveImage(img, path);
    logInfo(Log.Skill.SorcererMissShot, { path: path });
  } catch (e) {
    logWarn(Log.Dialog.ScreenSaveFailed, 'Could not save the debug screenshot',
      { path: path, errorText: '' + e });
  } finally {
    releaseImage(img);
  }
}

/**
 * The scan's look while hats are left: every magic bubble on `img` goes to the
 * next spot, one drag at a time, each checked by a look after its blast. True
 * once it found one, so the scan captures again.
 */
function sorcererWatch(ts: Tsum, img: NativeImage): boolean {
  const cfg = SorcererMickeyConfig;
  const st = gSorcerer;
  if (st.round !== '' && st.round !== ts.roundUid) { sorcererDisarm(ts, 'roundOver'); }
  if (!sorcererArmed(ts)) { return false; }
  if (Date.now() - st.activeAt > cfg.idleMs) {
    sorcererDisarm(ts, 'idle');
    return false;
  }
  let bubbles = sorcererUnignored(sorcererFindIn(img));
  if (bubbles.length === 0 || !ts.mayTouchBoard()) { return false; }
  st.activeAt = Date.now();
  const spots = cfg.spots[st.given];
  const from0 = Date.now();
  // Bounded: each pass drops, retries or sets a bubble aside.
  for (let tries = st.hats + cfg.extraTriesPerScan; tries > 0; tries--) {
    if (st.hats <= 0 || !ts.mayTouchBoard() || Date.now() - from0 > cfg.scanBudgetMs) { break; }
    bubbles = sorcererAtRest(ts, bubbles);
    if (bubbles.length === 0) { break; }

    // The bubble a drag left unmoved, again; otherwise the one nearest the
    // next spot.
    const to = spots[st.next % spots.length];
    let bi = -1, best = Infinity;
    if (st.stuckAt !== null) {
      for (let i = 0; i < bubbles.length; i++) {
        const d = Math.hypot(bubbles[i].x - st.stuckAt.x, bubbles[i].y - st.stuckAt.y);
        if (d <= cfg.samePx && d < best) { best = d; bi = i; }
      }
      if (bi < 0) { st.stuckAt = null; st.stuck = 0; }
    }
    if (bi < 0) {
      for (let i = 0; i < bubbles.length; i++) {
        const at = sorcererLogical(ts, bubbles[i]);
        const d = Math.hypot(to.x - at.x, to.y - at.y);
        if (d < best) { best = d; bi = i; }
      }
    }
    const b = bubbles[bi];
    const from = sorcererLogical(ts, b);
    const tapped = st.stuckAt !== null && st.stuck >= cfg.dragRetries;
    if (tapped) {
      ts.tap(from, 30);
    } else {
      sorcererDrag(ts, from, to);
    }
    logDebug(Log.Skill.SorcererDrop, { tap: tapped, from: from, to: tapped ? undefined : to,
      bubbles: bubbles.length, core: b.core, rim: b.rim, hats: st.hats });
    ts.sleep(cfg.blastMs);

    // Gone from where it was, and not sitting on the spot (carried there
    // without a drop): it took. A count would miss a drop whenever another
    // bubble shows up between the looks; the grab was on a bubble at rest.
    bubbles = sorcererUnignored(sorcererFind(ts));
    const stayed = sorcererNearest(bubbles, b) <= cfg.samePx;
    const k = 1080 / ts.playResizeWidth;
    const onSpot = !tapped
      && sorcererNearest(bubbles, {x: to.x / k, y: (to.y - PlayAreaTopY) / k}) <= cfg.samePx * 2;
    if (!stayed && !onSpot) {
      st.hats--;
      if (tapped) { st.taps++; } else { st.drops++; st.next++; }
      st.stuckAt = null;
      st.stuck = 0;
      st.activeAt = Date.now();
      // The blasts just emptied the board round the spots: no strategy pop
      // into those holes for a while (`holdBubblesAfterSkill`).
      ts.holdBubblesAfterSkill(Date.now());
    } else if (stayed && tapped) {
      st.ignored.push({x: b.x, y: b.y});
      bubbles = sorcererUnignored(bubbles);
      st.stuckAt = null;
      st.stuck = 0;
    } else if (stayed) {
      st.stuckAt = {x: b.x, y: b.y};
      st.stuck++;
    }
    // Carried to the spot without a drop: plan afresh, the spot is still next.
  }
  if (st.hats <= 0) { sorcererDisarm(ts, 'done'); }
  // It has slept and captured since `img`, so the scan captures again.
  return true;
}

registerSkill({
  types: [SkillType.SorcererMickeyPlus],
  // The activation only arms the hats; the bubbles come from the chains after
  // it. The "Skill Waiting time" settle covers the cut-in, as for a burst.
  afterActivate: function(ts) {
    sorcererArm(ts);
    if (ts.skillInterval > 0) {
      ts.settleBoard(ts.skillInterval);
    }
  },
  watchScan: sorcererWatch,
  // A magic bubble the strategy taps would blast in place, off its spot.
  claimsBubbles: sorcererArmed,
  // The gauge waits for the hats to be spent.
  stillRunning: sorcererArmed,
  // While armed, one chain a scan, the longest, uncapped: its bubble is the
  // next hat's, and a longer chain makes a bigger blast.
  chainLimits: function(ts) {
    return sorcererArmed(ts) ? { maxChain: 0, maxChainsPerScan: 1 } : {};
  },
  orderPaths: function(ts, paths) {
    return sorcererArmed(ts) ? paths.slice().sort((a, b) => b.length - a.length) : paths;
  },
});
