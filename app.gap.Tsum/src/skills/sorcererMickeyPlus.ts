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
// armed, play goes on at its usual pace, and:
//   - chains are not capped (`chainLimits`): a longer chain, a bigger blast;
//   - each scan looks for magic bubbles first (`watchScan`) and drags each to
//     the next spot of a layout spread to cover the most board (`spots`): two
//     to the left and right halves, three to the bottom corners and the top
//     middle, four to the four corners. A spot keeps its bubble's ring, so a
//     big bubble goes before any small one;
//   - the Bubble Strategy pops nothing (`claimsBubbles`), and a batch draws
//     last any chain over where an earlier one of it ended (`orderPaths`),
//     since that is where its bubble shows: either would blast it in place.
// The skill is not held meanwhile: it fires as soon as the gauge is full. An
// activation with hats left tops them up and carries on with the same spots.
//
// The bubbles are found by colour, not Hough (`sorcererFindIn`): glass-coloured
// samples on a grid over the play square, clustered, each centre moved to the
// fullest ring near it, and kept only when its middle is a bubble's (pale glass,
// or deep glass with the crescent of a 7+ chain's) with nothing dark in it (a
// tsum's eyes) and a bright ring goes round it. On five screenshots, two
// rosters, that found every waiting bubble of both kinds but one washed out by
// the dragged bubble's ring, and nothing else.
//
// A magic bubble blasts wherever it is let go or touched, and that spends a
// hat whether it moved or not. So nothing taps one: a bubble the drag did not
// move is dragged again with a longer hold (`dragRetries`) and then left alone,
// and the drag starts with short moves, so the game takes it as a drag rather
// than a tap, and goes no faster than the bubble can follow. A drop is checked
// straight after: gone from where it was, and not left on the spot.
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
  // level set too high or bubbles the reader misses.
  idleMs: 8000,
  // Most one scan spends on drops, in gestures (beyond the hats left) and
  // time; the rest waits for the next scan.
  extraTriesPerScan: 2,
  scanBudgetMs: 6000,
  // A bubble that moved at most `restPx` (play-square px) between two looks is
  // at rest. At most `restLooks` looks are spent waiting for that.
  lookMs: 50,
  restPx: 3,
  restLooks: 2,
  // The drag: held `grabMs` (times the try), moved by `easeIn` then `stepPx`
  // (logical px) each `moveMs`, held `dropHoldMs` on the spot so the game
  // takes it there, then let go. The short first moves make it a drag, not a
  // tap; past ~2px/ms the bubble can lose the finger and drop mid-way.
  grabMs: 80,
  easeIn: [8, 16, 32],
  stepPx: 40,
  moveMs: 20,
  dropHoldMs: 120,
  // After a drop, before the look that checks it: the bubble going off.
  blastMs: 200,
  // A chain of a batch goes to the back while armed when its drag line passes
  // within this many tsum widths of where an earlier chain of the batch ended.
  endClear: 0.8,
  // A bubble within `samePx` (play-square px) of where its drag started did
  // not move. After `dragRetries` such drags it is left alone.
  samePx: 6,
  dragRetries: 3,
  // Screens saved per run when an armed window runs out with hats left (diagnostics).
  missShotMax: 3,
};

// The magic bubble on the 200px play square, two kinds in the same near-white
// ring (radius 11-16). A 3-6 chain's ("small"): pale glass, r 60-125, g 90-150,
// b 140-215 (g above r). A 7+ chain's ("big", a bigger blast): deep indigo
// glass, r 0-30, g 4-50, b 100-160, with a pale yellow crescent in the middle.
var SorcererBubble = {
  // Grid spacing over the play square, and the fewest glass samples a cluster
  // needs. A bubble gives 5-13 at step 4.
  step: 4,
  minSamples: 4,
  // Middle: samples `coreStep` apart within `coreRadius`. A small bubble's
  // must be `paleShare` pale glass; a big one's `deepShare` deep glass with
  // `crescentMin` crescent samples. None may have its brightest channel under
  // `coreFloor` (the glass's darkest reads 99; a tsum's eyes and outline 30-50).
  coreRadius: 6,
  coreStep: 2,
  paleShare: 0.72,
  deepShare: 0.3,
  crescentMin: 1,
  coreFloor: 70,
  // Ring: `rays` rays, each a hit when any radius `rimFrom`-`rimTo` has every
  // channel >= `rimMin`; `rimRays` must hit. Bubbles hit all 16; the COMBO
  // counter and the dark sky at most 13.
  rays: 16,
  rimFrom: 10,
  rimTo: 17,
  rimMin: 165,
  rimRays: 15,
  // A cluster's centre is off the bubble's when the crescent or the highlight
  // fills part of the middle, so a centre whose ring hits `refineFrom` rays
  // (at radii `refineRadii`) climbs `refineStep` px at a time toward a fuller
  // ring, at most `refineSteps` times.
  refineRadii: [11, 13, 15, 17],
  refineFrom: 6,
  refineStep: 2,
  refineSteps: 3,
};

// ---- Reader ---------------------------------------------------------------

/** One magic bubble, in play-square px, with the readings that kept it. */
interface SorcererBubbleSeen extends Point {
  /** 'big' from a 7+ chain (bigger blast), 'small' otherwise. */
  kind: 'small' | 'big';
  core: number;
  rim: number;
}

/**
 * A small bubble's glass: a muted mid blue. Sorcerer Mickey's own hat is far
 * more saturated (red near 0) and the board's gaps far darker.
 */
function sorcererPale(c: Color): boolean {
  const hi = Math.max(c.r, c.g, c.b);
  const lo = Math.min(c.r, c.g, c.b);
  return c.b >= 125 && c.r >= 45 && c.g - c.r >= 8 && c.b - c.r >= 35 && c.b - c.g >= 15
    && hi <= 230 && hi - lo <= 0.62 * hi;
}

/** A big bubble's glass: deep indigo. The board's sky is as deep; the ring tells them apart. */
function sorcererDeep(c: Color): boolean {
  return c.b >= 95 && c.b <= 185 && c.r <= 40 && c.g <= 55 && c.b - c.g >= 60;
}

/** A big bubble's crescent: pale yellow. */
function sorcererCrescent(c: Color): boolean {
  return c.r >= 180 && c.g >= 150 && c.b >= 130 && c.b <= 180 && c.r - c.b >= 40;
}

/** Ring offsets at `radii`, ray by ray. */
function sorcererRing(radii: number[]): Point[] {
  const rays = SorcererBubble.rays;
  const out: Point[] = [];
  for (let k = 0; k < rays; k++) {
    const a = 2 * Math.PI * k / rays;
    for (const r of radii) { out.push({x: r * Math.cos(a), y: r * Math.sin(a)}); }
  }
  return out;
}

/** The middle's sample offsets. */
function sorcererCore(): Point[] {
  const cfg = SorcererBubble;
  const out: Point[] = [];
  for (let dy = -cfg.coreRadius; dy <= cfg.coreRadius; dy += cfg.coreStep) {
    for (let dx = -cfg.coreRadius; dx <= cfg.coreRadius; dx += cfg.coreStep) {
      if (dx * dx + dy * dy <= cfg.coreRadius * cfg.coreRadius) { out.push({x: dx, y: dy}); }
    }
  }
  return out;
}

/** `centres` shifted by each of `offsets`, clamped to the image, centre by centre. */
function sorcererSamples(size: { width: number; height: number }, centres: Point[], offsets: Point[]): Point[] {
  const pts: Point[] = [];
  for (const c of centres) {
    for (const o of offsets) {
      pts.push({x: Math.min(Math.max(Math.round(c.x + o.x), 0), size.width - 1),
        y: Math.min(Math.max(Math.round(c.y + o.y), 0), size.height - 1)});
    }
  }
  return pts;
}

/** Ring rays hit round each of `centres` (`ring` from `sorcererRing`), off one read. */
function sorcererRayHits(img: NativeImage, size: { width: number; height: number }, centres: Point[], ring: Point[]): number[] {
  const perRay = ring.length / SorcererBubble.rays;
  const colors = getImageColors(img, sorcererSamples(size, centres, ring));
  const min = SorcererBubble.rimMin;
  const out: number[] = [];
  let at = 0;
  for (let c = 0; c < centres.length; c++) {
    let hits = 0;
    for (let k = 0; k < SorcererBubble.rays; k++) {
      let hit = false;
      for (let r = 0; r < perRay; r++) {
        const col = colors[at++];
        if (Math.min(col.r, col.g, col.b) >= min) { hit = true; }
      }
      if (hit) { hits++; }
    }
    out.push(hits);
  }
  return out;
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
  const glass = getImageColors(img, grid).map((c) => sorcererPale(c) || sorcererDeep(c));

  // Clusters of touching glass samples (8-connected), as centroids.
  let centres: Point[] = [];
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

  // Each centre climbs toward the fullest ring: all eight neighbours of every
  // centre still moving in one read a step.
  const coarse = sorcererRing(cfg.refineRadii);
  let hits = sorcererRayHits(img, size, centres, coarse);
  centres = centres.filter((_, i) => hits[i] >= cfg.refineFrom);
  hits = hits.filter((h) => h >= cfg.refineFrom);
  if (centres.length === 0) { return []; }
  const s = cfg.refineStep;
  const around: Point[] = [{x: -s, y: -s}, {x: 0, y: -s}, {x: s, y: -s}, {x: -s, y: 0},
    {x: s, y: 0}, {x: -s, y: s}, {x: 0, y: s}, {x: s, y: s}];
  let moving = centres.map((_, i) => i);
  for (let step = 0; step < cfg.refineSteps && moving.length > 0; step++) {
    const probes: Point[] = [];
    for (const i of moving) {
      for (const o of around) { probes.push({x: centres[i].x + o.x, y: centres[i].y + o.y}); }
    }
    const ph = sorcererRayHits(img, size, probes, coarse);
    const still: number[] = [];
    moving.forEach((i, m) => {
      let best = -1;
      for (let k = 0; k < around.length; k++) {
        if (ph[m * around.length + k] > hits[i] && (best < 0 || ph[m * around.length + k] > ph[m * around.length + best])) { best = k; }
      }
      if (best >= 0) {
        centres[i] = probes[m * around.length + best];
        hits[i] = ph[m * around.length + best];
        still.push(i);
      }
    });
    moving = still;
  }

  // The full ring and the middle, in one read each.
  const rim = sorcererRayHits(img, size, centres, sorcererRing(
    Array.from({length: cfg.rimTo - cfg.rimFrom + 1}, (_, k) => cfg.rimFrom + k)));
  const core = sorcererCore();
  const colors = getImageColors(img, sorcererSamples(size, centres, core));
  const out: SorcererBubbleSeen[] = [];
  for (let c = 0; c < centres.length; c++) {
    let pale = 0, deep = 0, crescent = 0, dark = 0;
    for (let k = 0; k < core.length; k++) {
      const col = colors[c * core.length + k];
      if (sorcererPale(col)) { pale++; }
      if (sorcererDeep(col)) { deep++; }
      if (sorcererCrescent(col)) { crescent++; }
      if (Math.max(col.r, col.g, col.b) < cfg.coreFloor) { dark++; }
    }
    if (dark > 0 || rim[c] < cfg.rimRays) { continue; }
    const paleShare = pale / core.length;
    const deepShare = deep / core.length;
    const kind = paleShare >= cfg.paleShare ? 'small'
      : deepShare >= cfg.deepShare && crescent >= cfg.crescentMin ? 'big' : null;
    if (kind === null) { continue; }
    out.push({x: centres[c].x, y: centres[c].y, kind: kind, rim: rim[c],
      core: Math.round((kind === 'small' ? paleShare : deepShare) * 100) / 100});
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

/** Distance from `p` to the segment `a`-`b`. */
function sorcererToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The play loop's chains with any whose drag passes over where an earlier one
 * ended moved to the back: a chain leaves its magic bubble at its last tsum,
 * and a later chain of the same batch drawn through it would blast it in
 * place. Moved rather than dropped, so the batch still fills and the barren
 * check (`foundPaths` in `taskPlayGameQuick`) counts what the board offers.
 */
function sorcererClearOfEnds(paths: TsumPath[]): TsumPath[] {
  const reach = SorcererMickeyConfig.endClear * Config.tsumWidth;
  const ends: Point[] = [];
  const out: TsumPath[] = [];
  const crossing: TsumPath[] = [];
  for (const path of paths) {
    let crosses = false;
    for (let i = 0; i < path.length && !crosses; i++) {
      const a = path[i], b = path[Math.min(i + 1, path.length - 1)];
      for (const e of ends) {
        if (sorcererToSegment(e, a, b) <= reach) { crosses = true; break; }
      }
    }
    if (crosses) {
      crossing.push(path);
      continue;
    }
    out.push(path);
    ends.push(path[path.length - 1]);
  }
  return out.concat(crossing);
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
  armedAt: 0,
  /** Last time a magic bubble was seen or dropped, for `idleMs`. */
  activeAt: 0,
  /** Where a drag left its bubble unmoved, and how many times in a row. */
  stuckAt: null as Point | null,
  stuck: 0,
  /** Bubbles no drag moved: one the game will not let go, or not one at all. */
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
  const fields = { why: why, given: st.given, drops: st.drops, left: st.hats,
    ignored: st.ignored.length, ms: Date.now() - st.armedAt };
  if (st.hats > 0 && st.drops === 0) {
    logWarn(Log.Skill.SorcererNone, fields);
  } else {
    logInfo(Log.Skill.SorcererDone, fields);
  }
  if (why === 'idle') { sorcererSaveMissFrame(ts); }
  st.round = '';
  st.hats = 0;
}

/**
 * Arm a new activation's hats. With hats from this round still left, they are
 * topped up to the level's count and the spots carry on where they were.
 */
function sorcererArm(ts: Tsum): void {
  const cfg = SorcererMickeyConfig;
  const st = gSorcerer;
  const level = Math.min(Math.max(Math.round(ts.skillLevel) || 1, 1), cfg.hats.length);
  if (sorcererArmed(ts)) {
    st.hats = Math.max(st.hats, cfg.hats[level - 1]);
    st.activeAt = Date.now();
    logDebug(Log.Skill.SorcererArmed, { skillLevel: level, hats: st.hats, toppedUp: true });
    return;
  }
  if (st.round !== '') { sorcererDisarm(ts, 'roundOver'); }
  st.round = ts.roundUid;
  st.given = st.hats = cfg.hats[level - 1];
  st.next = st.drops = st.stuck = 0;
  st.stuckAt = null;
  st.ignored = [];
  st.armedAt = st.activeAt = Date.now();
  logDebug(Log.Skill.SorcererArmed, { skillLevel: level, hats: st.hats });
}

// ---- Choreography ---------------------------------------------------------

/** Drag a bubble from `from` to `to` (logical px), held `grabMs` first, and drop it there. */
function sorcererDrag(ts: Tsum, from: Point, to: Point, grabMs: number): void {
  const cfg = SorcererMickeyConfig;
  ts.tapDown(from, 20);
  ts.sleep(grabMs);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  let d = 0;
  for (let i = 0; d < len; i++) {
    d = Math.min(len, d + (i < cfg.easeIn.length ? cfg.easeIn[i] : cfg.stepPx));
    ts.moveTo({x: Math.round(from.x + dx * d / len), y: Math.round(from.y + dy * d / len)}, cfg.moveMs);
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

    // The bubble a drag left unmoved, again; otherwise a big one before any
    // small, nearest the next spot. A spot keeps its bubble's ring, and the
    // earlier the spot the more it blasts.
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
      const big = bubbles.some((x) => x.kind === 'big');
      for (let i = 0; i < bubbles.length; i++) {
        if (big && bubbles[i].kind !== 'big') { continue; }
        const at = sorcererLogical(ts, bubbles[i]);
        const d = Math.hypot(to.x - at.x, to.y - at.y);
        if (d < best) { best = d; bi = i; }
      }
    }
    const b = bubbles[bi];
    const from = sorcererLogical(ts, b);
    if (st.stuckAt !== null && st.stuck >= cfg.dragRetries) {
      // No drag moved it: leave it be, since a tap would blast it in place.
      st.ignored.push({x: b.x, y: b.y});
      bubbles = sorcererUnignored(bubbles);
      st.stuckAt = null;
      st.stuck = 0;
      logDebug(Log.Skill.SorcererDrop, { setAside: true, from: from, kind: b.kind,
        bubbles: bubbles.length + 1, core: b.core, rim: b.rim, hats: st.hats });
      continue;
    }
    const grabMs = cfg.grabMs * (1 + st.stuck);
    sorcererDrag(ts, from, to, grabMs);
    logDebug(Log.Skill.SorcererDrop, { from: from, to: to, grabMs: grabMs, kind: b.kind,
      bubbles: bubbles.length, core: b.core, rim: b.rim, hats: st.hats });
    ts.sleep(cfg.blastMs);

    // Gone from where it was, and not sitting on the spot (carried there
    // without a drop): it took. A count would miss a drop whenever another
    // bubble shows up between the looks; the grab was on a bubble at rest.
    bubbles = sorcererUnignored(sorcererFind(ts));
    const stayed = sorcererNearest(bubbles, b) <= cfg.samePx;
    const k = 1080 / ts.playResizeWidth;
    const onSpot = sorcererNearest(bubbles, {x: to.x / k, y: (to.y - PlayAreaTopY) / k}) <= cfg.samePx * 2;
    if (!stayed && !onSpot) {
      st.hats--;
      st.drops++;
      st.next++;
      st.stuckAt = null;
      st.stuck = 0;
      st.activeAt = Date.now();
      // The blasts just emptied the board round the spots: no strategy pop
      // into those holes for a while (`holdBubblesAfterSkill`).
      ts.holdBubblesAfterSkill(Date.now());
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
  // While armed, chains are not capped: a longer chain makes a bigger blast.
  chainLimits: function(ts) {
    return sorcererArmed(ts) ? { maxChain: 0 } : {};
  },
  orderPaths: function(ts, paths) {
    return sorcererArmed(ts) ? sorcererClearOfEnds(paths) : paths;
  },
});
