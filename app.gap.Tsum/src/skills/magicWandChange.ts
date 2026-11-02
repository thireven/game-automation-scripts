// Magic Wand Change -- Magic Wand Minnie, Daisy and Clarice (Change).
//
// Plays as a burst. What these tsums add is the locket, the game's "magical
// jewel" in the Secret Magical Minnie event: once clears have charged it, the
// game dims the board and holds a winged heart in the middle of it, round
// timer stopped, until it is tapped. One tap clears it and sets off the Change.
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

registerSkill({
  types: [SkillType.MagicWandChange],
  bareTapActivates: true,
  watchScan: function(ts) {
    return magicWandTapLocket(ts, 'scan');
  },
  watchHudLost: function(ts) {
    magicWandTapLocket(ts, 'hudLost');
  }
});
