// Magic Wand Change -- Magic Wand Minnie, Daisy and Clarice (Change).
//
// Plays as a burst, with two things of its own to tap.
//
// The heart bubble: every activation's clear leaves one bubble near the middle
// of the board, a white rim round the tsum's heart (pink for Minnie, lavender
// for Daisy). It falls with the refill until tapped, and the Bubble Strategy
// held it like any game bubble, about a second each time. It is popped the
// scan it is first seen instead (`watchBubbles`): the scan's bubble pass
// already finds it, and its colours tell it from the game's bubbles.
//
// The locket, the game's "magical jewel" in the Secret Magical Minnie event:
// once clears have charged it, the game dims the board and holds a winged
// heart in the middle of it, round timer stopped, until it is tapped. One tap
// clears it and sets off the Change.
//
// While it is up the Fan dims with the board, so the board stops
// fingerprinting as `GamePlaying`: the HUD debounce runs out and
// `confirmGameOver` stops playing to wait for a round-over screen that never
// comes. So the locket is looked for in two places, and tapped when seen:
//   - every board scan (`watchScan`);
//   - every `confirmGameOver` poll (`watchHudLost`).
//
// The tell is the HUD, not the locket: Pause lit with the Fan dimmed is the
// locket's state alone mid-round. The locket itself pulses to near white every
// second and its gem is the tsum's own colour, so a read of it misses half the
// time; the HUD holds still. A tap where none was needed lands mid-board and
// does nothing.

// ---- Tuning data ----------------------------------------------------------

// Measured on Daisy's locket (a capture and a recording in the last seconds'
// cyan wash) and Minnie's (a phone recording).
var MagicWandLocket = {
  /** Pause's top edge (`GamePlayingHudProbes`): yellow, or lime under the wash. */
  pause: {x: 901, y: 197} as Point,
  /** The Fan (`GamePlayingHudProbes`): yellow lit, navy to mid blue dimmed. */
  fan: [{x: 918, y: 1567}, {x: 918, y: 1636}, {x: 916, y: 1707}] as Point[],
  /** The locket's centre, mid-board. */
  tap: {x: 540, y: 1005} as Point,
  tapMs: 20,
  /**
   * Least gap between taps. The Fan stays dimmed through the ~2.5s Change
   * cut-in after the locket bursts, so without this every scan taps it.
   */
  retapMs: 1000,
};

/** When the locket was last tapped. */
var gMagicWandTappedAt = 0;

// In play-square px (`Config.screenResize`), read off the scan's own frame.
// Measured on three Minnie and six Daisy activations (emulator and phone
// recordings): the rim sits at radius ~15. A cut-in's face fits the rim and
// the heart, so the ring just past the rim must be mostly not white.
var MagicWandHeart = {
  /** Radii each rim ray samples: spread so a Hough centre 2px off still lands. */
  rimRadii: [13, 14, 15, 16, 17, 18],
  /** Rays round the centre, and how many must meet the rim. */
  rays: 12,
  rimRays: 9,
  /** The rim reads ~250; a tsum's cream face ~218. */
  rimWhite: 230,
  /** Just past the rim: at most `outerMax` of the rays white there. */
  outerRadius: 23,
  outerWhite: 200,
  outerMax: 0.3,
  /** Offsets from the centre where the heart is looked for; any one will do. */
  heartAt: [[0, 1], [-2, 1], [2, 1], [0, -1], [0, 3]],
};

// ---- Reader ---------------------------------------------------------------

/** Whether the locket is up: Pause lit and the Fan dimmed, off one crop of the right edge. */
function magicWandLocketUp(ts: Tsum): boolean {
  const cfg = MagicWandLocket;
  const pts = [cfg.pause].concat(cfg.fan);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const topLeft = ts.toRealXY(minX, minY);
  const bottomRight = ts.toRealXY(maxX, maxY);
  const x = Math.max(0, topLeft.x);
  const y = Math.max(0, topLeft.y);
  const img = getScreenshotModify(x, y, Math.max(1, bottomRight.x - x + 1),
    Math.max(1, bottomRight.y - y + 1), 0, 0, 100);
  try {
    const local = pts.map((p) => {
      const r = ts.toRealXY(p.x, p.y);
      return {x: r.x - x, y: r.y - y};
    });
    const colors = getImageColors(img, local);
    const pause = colors[0];
    if (pause.r < 150 || pause.g < 150 || pause.b > 120) { return false; }
    for (let i = 1; i < colors.length; i++) {
      if (colors[i].b < colors[i].r + 20) { return false; }
    }
    return true;
  } finally {
    releaseImage(img);
  }
}

/** Tap the locket if it is up. True if it tapped. */
function magicWandTapLocket(ts: Tsum, from: string): boolean {
  if (Date.now() - gMagicWandTappedAt < MagicWandLocket.retapMs) { return false; }
  if (!magicWandLocketUp(ts)) { return false; }
  gMagicWandTappedAt = Date.now();
  ts.tap(MagicWandLocket.tap, MagicWandLocket.tapMs);
  logInfo(Log.Skill.MagicWandLocket, { from: from });
  return true;
}

/** The heart's pink or lavender: saturated, blue well over green (coins are gold). */
function magicWandHeartColor(c: Color): boolean {
  const hi = Math.max(c.r, c.g, c.b);
  const lo = Math.min(c.r, c.g, c.b);
  return c.r >= 180 && c.b >= 170 && c.g <= 205 && c.b - c.g >= 20 && hi - lo >= 50;
}

/** One bubble's samples, in the order `magicWandIsHeart` reads them. */
function magicWandHeartPoints(x: number, y: number): Point[] {
  const cfg = MagicWandHeart;
  const pts: Point[] = [];
  for (const d of cfg.heartAt) { pts.push({x: Math.round(x + d[0]), y: Math.round(y + d[1])}); }
  for (let k = 0; k < cfg.rays; k++) {
    const a = 2 * Math.PI * k / cfg.rays;
    const ux = Math.cos(a), uy = Math.sin(a);
    for (const r of cfg.rimRadii) { pts.push({x: Math.round(x + r * ux), y: Math.round(y + r * uy)}); }
    pts.push({x: Math.round(x + cfg.outerRadius * ux), y: Math.round(y + cfg.outerRadius * uy)});
  }
  return pts;
}

/** Whether the samples from `at` show the heart bubble. */
function magicWandIsHeart(colors: Color[], at: number): boolean {
  const cfg = MagicWandHeart;
  let i = at;
  let heart = false;
  for (let k = 0; k < cfg.heartAt.length; k++) {
    if (magicWandHeartColor(colors[i++])) { heart = true; }
  }
  let rim = 0, outer = 0;
  for (let k = 0; k < cfg.rays; k++) {
    let hit = false;
    for (let j = 0; j < cfg.rimRadii.length; j++) {
      const c = colors[i++];
      if (Math.min(c.r, c.g, c.b) >= cfg.rimWhite) { hit = true; }
    }
    if (hit) { rim++; }
    const o = colors[i++];
    if (Math.min(o.r, o.g, o.b) >= cfg.outerWhite) { outer++; }
  }
  return heart && rim >= cfg.rimRays && outer <= cfg.outerMax * cfg.rays;
}

/** Tap the heart bubble if the scan found it; the rest go back to the strategy. */
function magicWandPopHeart(ts: Tsum, img: NativeImage, bubbles: GameBubble[]): GameBubble[] {
  if (!ts.mayTouchBoard()) { return bubbles; }
  const pts: Point[] = [];
  for (const b of bubbles) { pts.push(...magicWandHeartPoints(b.x, b.y)); }
  const colors = getImageColors(img, pts);
  const per = pts.length / bubbles.length;
  const rest: GameBubble[] = [];
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    if (!magicWandIsHeart(colors, i * per)) { rest.push(b); continue; }
    tapGameBubble(ts, b);
    logInfo(Log.Skill.MagicWandHeart, { x: Math.round(b.x), y: Math.round(b.y), near: b.near || 0 });
  }
  return rest;
}

registerSkill({
  types: [SkillType.MagicWandChange],
  bareTapActivates: true,
  watchBubbles: magicWandPopHeart,
  watchScan: function(ts) {
    return magicWandTapLocket(ts, 'scan');
  },
  watchHudLost: function(ts) {
    magicWandTapLocket(ts, 'hudLost');
  }
});
