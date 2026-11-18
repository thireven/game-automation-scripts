// ---------------------------------------------------------------------------
// Sorcerer Mickey+
//
// His activation puts one hat above the fever bar per drop (2, 2, 3, 3, 4, 4
// by skill level) and that many magic bubbles on the board: dark navy glass
// inside a neon ring. A bubble is dragged and dropped, and each drop sets off a
// blast round *every* spot dropped on so far -- the first spot blasts once per
// drop, the last once. The blast's ring is ~260 logical px in radius at SL6.
//
// So the drops are spread to cover the most board (`spots`): two go to the left
// and right halves, three to the bottom corners and the top middle, four to the
// four quarters. Each drag pairs the bubble and free spot nearest each other,
// which keeps drags short. A blast drops the tsums under the bubbles still
// waiting, so every drag first waits for them to come to rest
// (`sorcererAtRest`).
//
// The bubbles are found by colour, not Hough (`sorcererFind`): glass-coloured
// samples on a grid over the play square, clustered, and a cluster kept only
// when its middle is mostly glass and a bright ring goes round it. On four SL6
// screenshots that found every bubble at rest and nothing else; the nearest
// miss was the pale COMBO counter at the top of the board.
//
// A drag is checked on the next look: a bubble still where it started did not
// move, and after `dragRetries` such drags it is tapped where it sits instead.
// ---------------------------------------------------------------------------

// --- Tuning data -----------------------------------------------------------

var SorcererMickeyConfig = {
  // Drops (hats) by skill level 1-6.
  hats: [2, 2, 3, 3, 4, 4],
  // Drop spots in logical px, by how many drops there are. The play square is
  // y 465-1545; neighbouring spots sit about a blast's width apart and inside
  // the bowl. The four are where the player dropped them on SL6 screenshots.
  spots: {
    2: [{x: 280, y: 990}, {x: 800, y: 990}],
    3: [{x: 280, y: 1230}, {x: 800, y: 1230}, {x: 540, y: 760}],
    4: [{x: 280, y: 750}, {x: 800, y: 750}, {x: 280, y: 1230}, {x: 800, y: 1230}],
  } as { [drops: number]: Point[] },
  // The bubbles appear after the cut-in: looked for this long from the tap.
  appearMs: 4000,
  lookMs: 100,
  // A bubble that moved at most `restPx` (play-square px) between two looks is
  // at rest. At most `restLooks` looks are spent waiting for that.
  restPx: 3,
  restLooks: 6,
  // The drag: held `grabMs`, moved in `stepPx` (logical px) steps of `moveMs`,
  // held `dropHoldMs` on the spot so the game takes it there, then let go.
  grabMs: 60,
  stepPx: 80,
  moveMs: 20,
  dropHoldMs: 150,
  // After a drop, before the next look: the blast going off.
  blastMs: 500,
  // A bubble within `samePx` (play-square px) of where its drag started did
  // not move. After `dragRetries` of those it is tapped instead.
  samePx: 6,
  dragRetries: 2,
  // Stop once no bubble is seen for `goneMs` (before every drop has landed),
  // or `windowMs` after the tap.
  goneMs: 1500,
  windowMs: 15000,
  // Screens saved per run when an activation finds no bubble (diagnostics).
  missShotMax: 3,
};

// The magic bubble on the 200px play square: the glass reads r 60-125,
// g 90-150, b 140-215 (g above r); the ring is near white at radius 11-16.
var SorcererBubble = {
  // Grid spacing over the play square, and the fewest glass samples a cluster needs.
  step: 3,
  minSamples: 4,
  // Middle: samples `coreStep` apart within `coreRadius`; `coreShare` must be glass.
  coreRadius: 6,
  coreStep: 2,
  coreShare: 0.72,
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

/** The magic bubbles on one play-square capture. */
function sorcererFind(ts: Tsum): SorcererBubbleSeen[] {
  const cfg = SorcererBubble;
  const img = ts.playScreenshotSquare();
  try {
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
      let core = 0;
      for (let k = 0; k < off.core.length; k++) {
        if (sorcererGlass(colors[at++])) { core++; }
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
      if (share >= cfg.coreShare && rim >= cfg.rimRays) {
        out.push({x: c.x, y: c.y, core: Math.round(share * 100) / 100, rim: rim});
      }
    }
    return out;
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

/** Looks until two looks in a row agree on every bubble, or `restLooks` run out. */
function sorcererAtRest(ts: Tsum): SorcererBubbleSeen[] {
  const cfg = SorcererMickeyConfig;
  let last = sorcererFind(ts);
  for (let i = 1; i < cfg.restLooks && last.length > 0; i++) {
    ts.sleep(cfg.lookMs);
    const next = sorcererFind(ts);
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

/** Screens saved this run when an activation found no bubble. */
var gSorcererMissShots = 0;

/** Save the screen when no bubble was found, so the reader can be tuned against it. */
function sorcererSaveMissFrame(ts: Tsum): void {
  if (gSorcererMissShots >= SorcererMickeyConfig.missShotMax) { return; }
  gSorcererMissShots++;
  const path = ts.devicePath + '/tmp/sorcerer-none_' + Date.now() + '.png';
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

function sorcererPlay(ts: Tsum): void {
  const cfg = SorcererMickeyConfig;
  const start = Date.now();
  const level = Math.min(Math.max(Math.round(ts.skillLevel) || 1, 1), cfg.hats.length);
  const hats = cfg.hats[level - 1];
  // The layout is set at the first look: a skill level set too low still
  // spreads every bubble the game gave.
  let drops = 0;
  let free: Point[] = [];
  let placed = 0, drags = 0, taps = 0, most = 0, left = 0;
  let seenAt = 0;
  // The last drag or tap, checked on the next look (play-square px). A tap
  // takes no spot.
  let pending: { from: Point; spot: Point | null } | null = null;
  // Where a drag left its bubble unmoved, and how many times in a row.
  let stuckAt: Point | null = null;
  let stuck = 0;
  const maxTries = (hats + 2) * 2;
  for (let tries = 0; tries < maxTries && ts.mayTouchBoard(); ) {
    const now = Date.now();
    if (now - start > cfg.windowMs) { break; }
    if (seenAt === 0 ? now - start > cfg.appearMs : now - seenAt > cfg.goneMs) { break; }
    const bubbles = sorcererAtRest(ts);
    left = bubbles.length;
    if (pending !== null) {
      const spot = pending.spot;
      if (sorcererNearest(bubbles, pending.from) > cfg.samePx) {
        placed++;
        free = free.filter((s) => s !== spot);
        stuckAt = null;
        stuck = 0;
      } else {
        stuckAt = pending.from;
        stuck++;
      }
      pending = null;
    }
    if (bubbles.length === 0) {
      if (drops > 0 && placed >= drops) { break; }
      ts.sleep(cfg.lookMs);
      continue;
    }
    seenAt = Date.now();
    most = Math.max(most, bubbles.length);
    if (drops === 0) {
      drops = Math.min(Math.max(hats, bubbles.length), 4);
      free = cfg.spots[drops].slice();
    }
    // More bubbles than spots (a level set too low, or a drop that missed):
    // go round the layout again.
    if (free.length === 0) { free = cfg.spots[drops].slice(); }

    // A bubble a drag left unmoved goes again; otherwise the bubble and free
    // spot nearest each other.
    let bi = -1, si = 0, best = Infinity;
    if (stuckAt !== null) {
      for (let i = 0; i < bubbles.length; i++) {
        const d = Math.hypot(bubbles[i].x - stuckAt.x, bubbles[i].y - stuckAt.y);
        if (d <= cfg.samePx && d < best) { best = d; bi = i; }
      }
      if (bi < 0) { stuckAt = null; stuck = 0; }
    }
    const forced = bi;
    best = Infinity;
    for (let i = 0; i < bubbles.length; i++) {
      if (forced >= 0 && i !== forced) { continue; }
      const at = sorcererLogical(ts, bubbles[i]);
      for (let j = 0; j < free.length; j++) {
        const d = Math.hypot(free[j].x - at.x, free[j].y - at.y);
        if (d < best) { best = d; bi = i; si = j; }
      }
    }
    const b = bubbles[bi];
    const from = sorcererLogical(ts, b);
    tries++;
    if (stuckAt !== null && stuck >= cfg.dragRetries) {
      // Dragged and never moved: tap it where it sits.
      ts.tap(from, 30);
      taps++;
      pending = {from: {x: b.x, y: b.y}, spot: null};
      stuckAt = null;
      stuck = 0;
      logDebug(Log.Skill.SorcererDrop, { tap: true, from: from, bubbles: bubbles.length,
        core: b.core, rim: b.rim });
    } else {
      const to = free[si];
      sorcererDrag(ts, from, to);
      drags++;
      pending = {from: {x: b.x, y: b.y}, spot: to};
      logDebug(Log.Skill.SorcererDrop, { from: from, to: to, bubbles: bubbles.length,
        core: b.core, rim: b.rim });
    }
    ts.sleep(cfg.blastMs);
  }

  if (most === 0) {
    logWarn(Log.Skill.SorcererNone, { skillLevel: level, ms: Date.now() - start });
    sorcererSaveMissFrame(ts);
    return;
  }
  logInfo(Log.Skill.SorcererDone, { skillLevel: level, drops: drops, placed: placed,
    drags: drags, taps: taps, most: most, left: left, ms: Date.now() - start });
  // The last blast has only just gone off: hold the Bubble Strategy's pops
  // from here, as `useSkill` did from the tap.
  ts.holdBubblesAfterSkill(Date.now());
  if (ts.skillInterval > 0) {
    ts.settleBoard(ts.skillInterval);
  }
}

registerSkill({
  types: [SkillType.SorcererMickeyPlus],
  afterActivate: function(ts) {
    sorcererPlay(ts);
  },
});
