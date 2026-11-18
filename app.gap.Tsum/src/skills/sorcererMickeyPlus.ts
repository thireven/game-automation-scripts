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
//   - each scan links one chain, its longest, uncapped (`chainLimits`,
//     `orderPaths`): its bubble is the next hat's, a longer chain makes a
//     bigger blast, and the next scan moves the bubble before another chain
//     can be drawn over it (four chains a scan blasted waiting bubbles in place);
//   - each scan looks for magic bubbles first (`watchScan`) and drags each to
//     the next spot of a layout spread to cover the most board (`spots`): two
//     to the left and right halves, three to the bottom corners and the top
//     middle, four to the four corners. A spot keeps its bubble's ring, so a
//     big bubble goes before any small one;
//   - the Bubble Strategy pops nothing (`claimsBubbles`): a tap blasts one in place;
//   - the hat row is read each scan (`sorcererReadHats`): the count, the layout
//     and the next spot follow it, and the window ends once it is gone.
// The skill is not held meanwhile: it fires as soon as the gauge is full.
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
  // apart and inside the bowl. The four are where the player dropped them on
  // SL6 screenshots. Top spots first: a blast drops whatever is above it into
  // its gap, and the bubbles still waiting sit low (drags started at y
  // 1000-1430), so a top blast leaves them where they are.
  spots: {
    2: [{x: 280, y: 990}, {x: 800, y: 990}],
    3: [{x: 540, y: 760}, {x: 280, y: 1230}, {x: 800, y: 1230}],
    4: [{x: 280, y: 750}, {x: 800, y: 750}, {x: 280, y: 1230}, {x: 800, y: 1230}],
  } as { [hats: number]: Point[] },
  // Disarm when no magic bubble has been seen for this long since the
  // activation or the last drop. Every chain makes one, so this is a skill
  // level set too high or bubbles the reader misses.
  idleMs: 8000,
  // Most one scan spends on drops, in gestures (beyond the hats left) and
  // time; the rest waits for the next scan. Generous: handing back with a
  // bubble still up lets the play loop chain over it.
  extraTriesPerScan: 4,
  scanBudgetMs: 12000,
  // A bubble that moved at most `restPx` (play-square px) between two looks is
  // at rest. At most `restLooks` looks are spent waiting for that.
  lookMs: 80,
  restPx: 3,
  restLooks: 5,
  // Bubbles count as gone only after this many looks in a row find none. The
  // glass is partly see-through (navy over the dark, green over a green tsum,
  // cyan-white as it pulses), so the colour test loses a real bubble for a
  // look or three: on two recordings 36 of its 39 short gaps were 1-3 frames
  // of 100ms. Each such miss had handed the board back to the play loop.
  emptyLooks: 3,
  // The drag: held `grabMs` (times the try), moved by `easeIn` then one of
  // `speeds` (logical px a move, ms a move), held `dropHoldMs` on the spot so
  // the game takes it there, then let go. The short first moves make it a
  // drag, not a tap. A small bubble's drag checks it is under the finger
  // before letting go (`sorcererCarried`), `catchUpMs` into the hold: the game
  // draws it a frame behind the finger. One lost on the way -- gone from where
  // it started and not under the finger -- drops the run a speed; `fasterAfter`
  // carried in a row lifts it one again. Recordings showed it under the finger
  // at 2 and 3px/ms (60px a move, about a bubble's radius); the first is one
  // 80px move a frame, ~5px/ms.
  grabMs: 50,
  easeIn: [8, 24],
  speeds: [{stepPx: 80, moveMs: 16}, {stepPx: 60, moveMs: 20}, {stepPx: 40, moveMs: 20}],
  dropHoldMs: 70,
  catchUpMs: 35,
  fasterAfter: 6,
  // After a drop, the cast (`SorcererCast`) is waited out, then the bubbles,
  // for up to `landLooks` looks: the blast clears the tsums under the spot and
  // the bubbles above fall into the gap, so a look before they land drags
  // from where they were. Their own rest is watched, not the board's: fever
  // sparkle keeps the board's change at 0.02-0.04 a reading, over
  // `BoardSettle.maxDiff`, so `settleBoard` ran to its cap on 26 drops of 30.
  // Then, while fewer bubbles show than were left, the look is taken again
  // for up to `missingWaitMs` -- the blast's score labels hide them for a
  // moment, and the play loop would chain straight over them.
  landLooks: 15,
  missingWaitMs: 500,
  // Right before a grab the bubble is looked for again; one that moved more
  // than `verifyPx` (play-square px) since the look is planned afresh.
  verifyPx: 6,
  // A bubble within `samePx` (play-square px) of where its drag started did
  // not move. After `dragRetries` such drags it is left alone.
  samePx: 6,
  dragRetries: 3,
  // Screens saved per run when an armed window runs out with hats left (diagnostics).
  missShotMax: 3,
};

// The hats above the fever bar, in logical px. They sit centred on x 540, 108
// apart (4: 378/486/594/702; 3: 432/540/648; 2: 486/594), each with a flat
// bright blue brim at y 1578-1586 (the next hat to go is drawn larger and its
// brim a little lower). A spent hat stays as a dark silhouette until the last
// goes, when the row goes too. Measured on nine frames (4, 3, 2, 1 and none
// lit) and a 100s recording, where one read dips when a bubble, a tsum or a
// blast passes in front, so decisions take several reads (`windowMs`, `spentMs`).
var SorcererHats = {
  centreX: 540,
  spacing: 108,
  brimY: [1578, 1582, 1586],
  // Points across a slot's brim; `litMin` of them blue at some `brimY` is a
  // lit hat. A tsum's own hat, same blue, lies tilted and never fills a brim.
  brimX: [-30, -20, -10, 0, 10, 20, 30],
  litMin: 6,
  // The count is the most any read in the last `windowMs` saw; the hats are
  // spent once every read for `spentMs` saw none.
  windowMs: 1000,
  spentMs: 700,
};

// Every hat spent (and the activation itself) plays a cast: Sorcerer Mickey
// over the board, which the game dims. Measured off a round's recording (mean
// light of the play square, ~110-130 between casts): an activation takes it
// to 30-50 for ~2s, a drop to 50-80 for ~1.3s. The bubbles cannot be read
// through it, and in the second after one a chain drawn over a waiting bubble
// cost a hat in four windows of six. So both are waited out: until the light
// is back to `backFrac` of what it was just before, no sooner than `minMs`.
var SorcererCast = {
  // The light is read off the play square scaled to `grid` x `grid`.
  grid: 24,
  backFrac: 0.85,
  pollMs: 80,
  dropMinMs: 500,
  dropMaxMs: 1600,
  activateMinMs: 600,
  activateMaxMs: 2600,
};

// The magic bubble on the 200px play square, two kinds in the same near-white
// ring (radius 11-16). A 3-6 chain's ("small"): pale glass, r 60-125, g 90-150,
// b 140-215 (g above r). A 7+ chain's ("big", a bigger blast): deep indigo
// glass, r 0-30, g 4-50, b 100-160, with a bright crescent in the middle.
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
  // A big bubble needs every ray: a blast's white flash behind a score label
  // read as deep glass with a crescent at 15; every real one read 16.
  bigRimRays: 16,
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

/**
 * A big bubble's crescent: bright, pale yellow to near white -- it glows and
 * fades like the hats (249,222,157 on one frame, 254,250,235 on another).
 */
function sorcererCrescent(c: Color): boolean {
  return c.r >= 170 && c.g >= 160;
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
      : deepShare >= cfg.deepShare && crescent >= cfg.crescentMin && rim[c] >= cfg.bigRimRays ? 'big' : null;
    if (kind === null) { continue; }
    out.push({x: centres[c].x, y: centres[c].y, kind: kind, rim: rim[c],
      core: Math.round((kind === 'small' ? paleShare : deepShare) * 100) / 100});
  }
  return out;
}

/**
 * A lit hat's brim: deep blue, green at most 0.62 of blue (a spent one is near
 * black). The bowl's rim in the daytime theme is a cyan blue, green ~0.75 of
 * blue, and runs right through the brim rows once the hats are gone.
 */
function sorcererHatBlue(c: Color): boolean {
  return c.b >= 150 && c.b - c.r >= 90 && c.b - c.g >= 60 && c.g <= 0.62 * c.b && c.r <= 100;
}

/**
 * How many hats are lit above the fever bar, off one crop of the row. Every
 * layout (2, 3 or 4 hats) is tried and the best taken, so a skill level set
 * wrong still reads; slots of the wrong layout fall between the hats.
 */
function sorcererHatsShown(ts: Tsum): number {
  const cfg = SorcererHats;
  const layouts: number[][] = [2, 3, 4].map((n) =>
    Array.from({length: n}, (_, i) => cfg.centreX + (i - (n - 1) / 2) * cfg.spacing));
  const real: Point[] = [];
  for (const slots of layouts) {
    for (const c of slots) {
      for (const dx of cfg.brimX) {
        for (const y of cfg.brimY) { real.push(ts.toRealXY(c + dx, y)); }
      }
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of real) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const x0 = Math.max(0, minX);
  const y0 = Math.max(0, minY);
  const img = getScreenshotModify(x0, y0, Math.max(1, maxX - x0 + 1), Math.max(1, maxY - y0 + 1), 0, 0, 100);
  let colors: Color[];
  try {
    colors = getImageColors(img, real.map((p) => ({x: p.x - x0, y: p.y - y0})));
  } finally {
    releaseImage(img);
  }
  let best = 0, at = 0;
  for (const slots of layouts) {
    let lit = 0;
    for (let k = 0; k < slots.length; k++) {
      let hits = 0;
      for (let d = 0; d < cfg.brimX.length; d++) {
        let hit = false;
        for (let r = 0; r < cfg.brimY.length; r++) {
          if (sorcererHatBlue(colors[at++])) { hit = true; }
        }
        if (hit) { hits++; }
      }
      if (hits >= cfg.litMin) { lit++; }
    }
    best = Math.max(best, lit);
  }
  return best;
}

/** The play square's mean light (luma), off a small capture. */
function sorcererBoardLight(ts: Tsum): number {
  const n = SorcererCast.grid;
  const img = getScreenshotModify(ts.playOffsetX, ts.playOffsetY, ts.playWidth, ts.playHeight, n, n, 100);
  try {
    const pts: Point[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) { pts.push({x: x, y: y}); }
    }
    let sum = 0;
    for (const c of getImageColors(img, pts)) { sum += 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; }
    return sum / pts.length;
  } finally {
    releaseImage(img);
  }
}

/**
 * Wait out a cast: until the board's light is back to `backFrac` of `before`
 * (read just before the tap or the drop), no sooner than `minMs`, no later
 * than `maxMs`. Returns how long it took.
 */
function sorcererWaitCast(ts: Tsum, before: number, minMs: number, maxMs: number): number {
  const cfg = SorcererCast;
  const start = Date.now();
  ts.sleep(minMs);
  while (Date.now() - start < maxMs && ts.isRunning) {
    if (sorcererBoardLight(ts) >= cfg.backFrac * before) { break; }
    ts.sleep(cfg.pollMs);
  }
  return Date.now() - start;
}

/** The board's light just before the activation tap (`beforeActivate`). */
var gSorcererLightBefore = 0;

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

/** From the look `first`, looks until two in a row agree on every bubble, or `maxLooks` run out. */
function sorcererAtRest(ts: Tsum, first: SorcererBubbleSeen[],
    maxLooks: number = SorcererMickeyConfig.restLooks): SorcererBubbleSeen[] {
  const cfg = SorcererMickeyConfig;
  let last = first;
  // None counts only `emptyLooks` running: a look misses a bubble now and
  // then, and the play loop would chain over it.
  let empty = first.length === 0 ? 1 : 0;
  for (let i = 1; i < maxLooks && empty < cfg.emptyLooks; i++) {
    ts.sleep(cfg.lookMs);
    const next = sorcererUnignored(sorcererFind(ts));
    if (next.length === 0) {
      empty++;
      continue;
    }
    const still = empty === 0 && next.length === last.length
      && next.every((b) => sorcererNearest(last, b) <= cfg.restPx);
    empty = 0;
    last = next;
    if (still) { break; }
  }
  return empty >= cfg.emptyLooks ? [] : last;
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
  armedAt: 0,
  /** Last time a magic bubble was seen or dropped, for `idleMs`. */
  activeAt: 0,
  /** Where a drag left its bubble unmoved, and how many times in a row. */
  stuckAt: null as Point | null,
  stuck: 0,
  /** Bubbles no drag moved: one the game will not let go, or not one at all. */
  ignored: [] as Point[],
  /** Whether the hat row has been read lit since the activation. */
  hatsSeen: false,
  /** Recent hat reads, and since when they have all been none (0: one was lit). */
  hatReads: [] as { t: number; n: number }[],
  zeroSince: 0,
  /** Bubbles the last look saw: a scan whose frame shows none looks again first. */
  lastSeen: 0,
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
    hatsSeen: st.hatsSeen, ignored: st.ignored.length, ms: Date.now() - st.armedAt };
  if (st.drops === 0 && why !== 'spent') {
    logWarn(Log.Skill.SorcererNone, fields);
  } else {
    logInfo(Log.Skill.SorcererDone, fields);
  }
  if (why === 'idle') { sorcererSaveMissFrame(ts); }
  st.round = '';
  st.hats = 0;
}

/**
 * Arm an activation's hats. With hats from this round still up the window
 * goes on as it was: the next reads of the hat row say what the game did.
 */
function sorcererArm(ts: Tsum): void {
  const cfg = SorcererMickeyConfig;
  const st = gSorcerer;
  const level = Math.min(Math.max(Math.round(ts.skillLevel) || 1, 1), cfg.hats.length);
  if (sorcererArmed(ts)) {
    st.activeAt = Date.now();
    logDebug(Log.Skill.SorcererArmed, { skillLevel: level, hats: st.hats, again: true });
    return;
  }
  if (st.round !== '') { sorcererDisarm(ts, 'roundOver'); }
  st.round = ts.roundUid;
  st.given = st.hats = cfg.hats[level - 1];
  st.next = st.drops = st.stuck = st.zeroSince = 0;
  st.stuckAt = null;
  st.ignored = [];
  st.hatsSeen = false;
  st.hatReads = [];
  st.lastSeen = 0;
  st.armedAt = st.activeAt = Date.now();
  logDebug(Log.Skill.SorcererArmed, { skillLevel: level, hats: st.hats });
}

/**
 * Read the hat row and bring the count to it. Until the row has shown (the
 * cut-in, or a theme the read does not know) the count is the level's and the
 * drops'. After: the count is the most the last second's reads saw, the layout
 * is at least that big, the next spot is the hats spent so far, and a second
 * of none disarms.
 */
function sorcererReadHats(ts: Tsum): void {
  const cfg = SorcererHats;
  const st = gSorcerer;
  const now = Date.now();
  const n = sorcererHatsShown(ts);
  st.hatReads = st.hatReads.filter((r) => now - r.t <= cfg.windowMs);
  st.hatReads.push({t: now, n: n});
  if (n > 0) {
    st.zeroSince = 0;
    st.hatsSeen = true;
  } else if (st.zeroSince === 0) {
    st.zeroSince = now;
  }
  if (!st.hatsSeen) { return; }
  if (n === 0 && now - st.zeroSince >= cfg.spentMs) {
    st.hats = 0;
    sorcererDisarm(ts, 'spent');
    return;
  }
  let shown = 0;
  for (const r of st.hatReads) { shown = Math.max(shown, r.n); }
  if (shown === 0) { return; }
  if (st.drops === 0) { st.given = Math.min(4, Math.max(st.given, shown)); }
  st.hats = shown;
  st.next = Math.max(0, st.given - shown);
}

// ---- Choreography ---------------------------------------------------------

// A small bubble being carried lights up: a white-hot centre (255) in a
// saturated blue ring (b >= 170, b - r >= 110) 8-12px out on the 540 screen.
// On five drags (A1-A4, C1) that read 255 and 7-8 rays of 8; resting bubbles,
// the moon bubble and tsums read 231 white or 6 rays at the most. A big one
// keeps its dark glass and crescent while carried, and is not checked.
var SorcererCarry = {
  whiteMin: 245,
  // In logical px: the ring's radii, and how far from the finger the lit
  // centre may sit (the grab is rarely dead centre).
  ringRadii: [16, 20, 24],
  rays: 8,
  ringMin: 6,
  reach: 24,
  step: 8,
};

/** The run's drag speed: an index into `SorcererMickeyConfig.speeds`. */
var gSorcererSpeed = 0;
/** Small bubbles carried in a row since the speed last changed. */
var gSorcererCarriedRun = 0;

/** Whether a carried bubble is lit under the finger at `at` (logical px), off one small crop. */
function sorcererCarried(ts: Tsum, at: Point): boolean {
  const cfg = SorcererCarry;
  const centres: Point[] = [];
  for (let dy = -cfg.reach; dy <= cfg.reach; dy += cfg.step) {
    for (let dx = -cfg.reach; dx <= cfg.reach; dx += cfg.step) { centres.push({x: at.x + dx, y: at.y + dy}); }
  }
  const offs: Point[] = [];
  for (let dy = -4; dy <= 4; dy += 4) {
    for (let dx = -4; dx <= 4; dx += 4) { offs.push({x: dx, y: dy}); }
  }
  for (let k = 0; k < cfg.rays; k++) {
    const a = 2 * Math.PI * k / cfg.rays;
    for (const r of cfg.ringRadii) { offs.push({x: r * Math.cos(a), y: r * Math.sin(a)}); }
  }
  const real: Point[] = [];
  for (const c of centres) {
    for (const o of offs) { real.push(ts.toRealXY(c.x + o.x, c.y + o.y)); }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of real) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const x0 = Math.max(0, minX);
  const y0 = Math.max(0, minY);
  const img = getScreenshotModify(x0, y0, Math.max(1, maxX - x0 + 1), Math.max(1, maxY - y0 + 1), 0, 0, 100);
  let colors: Color[];
  try {
    colors = getImageColors(img, real.map((p) => ({x: p.x - x0, y: p.y - y0})));
  } finally {
    releaseImage(img);
  }
  const radii = cfg.ringRadii.length;
  for (let c = 0; c < centres.length; c++) {
    let at0 = c * offs.length;
    let white = 0;
    for (let i = 0; i < 9; i++) {
      const col = colors[at0++];
      white = Math.max(white, Math.min(col.r, col.g, col.b));
    }
    if (white < cfg.whiteMin) { at0 += cfg.rays * radii; continue; }
    let rays = 0;
    for (let k = 0; k < cfg.rays; k++) {
      let hit = false;
      for (let r = 0; r < radii; r++) {
        const col = colors[at0++];
        if (col.b >= 170 && col.b - col.r >= 110) { hit = true; }
      }
      if (hit) { rays++; }
    }
    if (rays >= cfg.ringMin) { return true; }
  }
  return false;
}

/**
 * Drag a bubble from `from` to `to` (logical px), held `grabMs` first, at the
 * run's speed, and drop it there. Says whether it was under the finger at the
 * end; null for a big bubble, which is not checked.
 */
function sorcererDrag(ts: Tsum, from: Point, to: Point, grabMs: number, big: boolean): boolean | null {
  const cfg = SorcererMickeyConfig;
  const speed = cfg.speeds[Math.min(gSorcererSpeed, cfg.speeds.length - 1)];
  ts.tapDown(from, 20);
  ts.sleep(grabMs);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  let d = 0;
  for (let i = 0; d < len; i++) {
    d = Math.min(len, d + (i < cfg.easeIn.length ? cfg.easeIn[i] : speed.stepPx));
    ts.moveTo({x: Math.round(from.x + dx * d / len), y: Math.round(from.y + dy * d / len)}, speed.moveMs);
  }
  const holdFrom = Date.now();
  ts.sleep(cfg.catchUpMs);
  const carried = big ? null : sorcererCarried(ts, to);
  const left = cfg.dropHoldMs - (Date.now() - holdFrom);
  if (left > 0) { ts.sleep(left); }
  ts.tapUp(to, 20);
  return carried;
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
  sorcererReadHats(ts);
  if (!sorcererArmed(ts)) { return false; }
  if (Date.now() - st.activeAt > cfg.idleMs) {
    sorcererDisarm(ts, 'idle');
    return false;
  }
  let bubbles = sorcererUnignored(sorcererFindIn(img));
  if (!ts.mayTouchBoard()) { return false; }
  if (bubbles.length === 0) {
    if (st.lastSeen === 0) { return false; }
    // Some were up a moment ago: one frame may just have missed them.
    bubbles = sorcererAtRest(ts, []);
    st.lastSeen = bubbles.length;
    if (bubbles.length === 0) { return true; }
  }
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
    // Still where it was? The board may have moved since the look; a grab at
    // a stale spot lands on a tsum, and the drag that follows is a chain
    // drawn over whatever bubble is in its way.
    const fresh = sorcererUnignored(sorcererFind(ts));
    const moved = sorcererNearest(fresh, b) > cfg.verifyPx;
    if (moved) {
      logDebug(Log.Skill.SorcererDrop, { moved: true, from: from, kind: b.kind,
        bubbles: bubbles.length, now: fresh.length, hats: st.hats });
      bubbles = fresh;
      continue;
    }
    const grabMs = cfg.grabMs * (1 + st.stuck);
    const light = sorcererBoardLight(ts);
    const before = bubbles.length;
    const speedUsed = gSorcererSpeed;
    const carried = sorcererDrag(ts, from, to, grabMs, b.kind === 'big');
    const castMs = sorcererWaitCast(ts, light, SorcererCast.dropMinMs, SorcererCast.dropMaxMs);
    // The bubbles above the blast fall into the gap it left: let them land.
    const settleFrom = Date.now();
    bubbles = sorcererAtRest(ts, sorcererUnignored(sorcererFind(ts)), cfg.landLooks);
    const settleMs = Date.now() - settleFrom;
    // The others are still there; give a look that misses them another go.
    const looked = Date.now();
    while (bubbles.length < before - 1 && Date.now() - looked < cfg.missingWaitMs && ts.isRunning) {
      ts.sleep(cfg.lookMs);
      bubbles = sorcererUnignored(sorcererFind(ts));
    }
    logDebug(Log.Skill.SorcererDrop, { from: from, to: to, grabMs: grabMs, kind: b.kind,
      carried: carried, speed: speedUsed, bubbles: before, after: bubbles.length, castMs: castMs,
      settleMs: settleMs, core: b.core, rim: b.rim, hats: st.hats });

    // Gone from where it was, and not sitting on the spot (carried there
    // without a drop): it took. A count would miss a drop whenever another
    // bubble shows up between the looks; the grab was on a bubble at rest.
    const stayed = sorcererNearest(bubbles, b) <= cfg.samePx;
    // Not under the finger at the end, and gone from where it started: it
    // was picked up and lost on the way, so the drags go slower from here.
    // (Still where it started is a grab that missed, which speed does not cause.)
    if (carried === false && !stayed && gSorcererSpeed < cfg.speeds.length - 1) {
      gSorcererSpeed++;
      gSorcererCarriedRun = 0;
      logInfo(Log.Skill.SorcererSlower, { speed: gSorcererSpeed,
        stepPx: cfg.speeds[gSorcererSpeed].stepPx, moveMs: cfg.speeds[gSorcererSpeed].moveMs });
    } else if (carried === true && ++gSorcererCarriedRun >= cfg.fasterAfter && gSorcererSpeed > 0) {
      gSorcererSpeed--;
      gSorcererCarriedRun = 0;
      logInfo(Log.Skill.SorcererSlower, { speed: gSorcererSpeed, faster: true,
        stepPx: cfg.speeds[gSorcererSpeed].stepPx, moveMs: cfg.speeds[gSorcererSpeed].moveMs });
    }
    const k = 1080 / ts.playResizeWidth;
    const onSpot = sorcererNearest(bubbles, {x: to.x / k, y: (to.y - PlayAreaTopY) / k}) <= cfg.samePx * 2;
    if (!stayed && !onSpot) {
      st.hats--;
      st.drops++;
      st.next++;
      // Reads from before the drop would put the hat back; the next ones
      // correct a drop counted wrong either way.
      st.hatReads = [];
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
  st.lastSeen = bubbles.length;
  if (st.hats <= 0) { sorcererDisarm(ts, 'done'); }
  // It has slept and captured since `img`, so the scan captures again.
  return true;
}

registerSkill({
  types: [SkillType.SorcererMickeyPlus],
  // The activation only arms the hats; the bubbles come from the chains after
  // it. Its cast is waited out first: chains drawn under it are refused, or
  // make bubbles no read can see. Then the "Skill Waiting time" settle.
  beforeActivate: function(ts) {
    gSorcererLightBefore = sorcererBoardLight(ts);
  },
  afterActivate: function(ts) {
    sorcererArm(ts);
    const castMs = sorcererWaitCast(ts, gSorcererLightBefore,
      SorcererCast.activateMinMs, SorcererCast.activateMaxMs);
    logDebug(Log.Skill.SorcererArmed, { cast: true, castMs: castMs });
    if (ts.skillInterval > 0) {
      ts.settleBoard(ts.skillInterval);
    }
  },
  watchScan: sorcererWatch,
  // A magic bubble the strategy taps would blast in place, off its spot.
  claimsBubbles: sorcererArmed,
  // While armed, one chain a scan, the longest, uncapped: its bubble is the
  // next hat's and a longer chain a bigger blast, and the next scan moves it
  // before another chain can be drawn over it. Four chains a scan drew over
  // the bubbles still waiting and blasted them in place.
  chainLimits: function(ts) {
    return sorcererArmed(ts) ? { maxChain: 0, maxChainsPerScan: 1 } : {};
  },
  orderPaths: function(ts, paths) {
    return sorcererArmed(ts) ? paths.slice().sort((a, b) => b.length - a.length) : paths;
  },
});
