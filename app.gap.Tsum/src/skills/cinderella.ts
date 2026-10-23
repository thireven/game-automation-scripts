// Cinderella — for a few seconds any tsums can be linked, whatever their kind.
//
// The window is filled with blind serpentine strokes over the left or right
// half of the play area, then the bubbles left behind are cleared. Each stroke
// is the half and direction that runs longest before a tsum an earlier stroke
// linked and the game is still clearing (`cinderellaPickStroke`, off the
// clearing ledger in board.ts), and stops there. Blind
// on purpose: a scan and a settle per chain cost over a second, and the window
// is 3-4s (`windowMs`). The coordinates are in the playResize space, not
// screen pixels.
//
// Each stroke is drawn with a hold of at least one display frame per point
// (`cinderellaDraw`). At `linkTsums`' 10ms the game reads only every other
// point, the finger skips tsums, and the chain stops growing mid-stroke.
//
// The right half mirrors the left about the square's centre. A point is a
// tsum's top-left corner (half a width is added when drawn), so the mirror of
// x is `screenResize - tsumWidth - x`.

// `var` so the offline harness can reach it, like every other skill's table.
var CinderellaConfig = {
  // How long tsums of any kind link, by skill level 1-6. Player-observed.
  windowMs: [3000, 3200, 3400, 3600, 3800, 4000],
  // From the activation tap to the window opening (the cut-in animation).
  cutInMs: 1500,
  // The drag: `dwellMs` must outlast a 60fps frame (16.7ms) so every point is
  // read. Points are 20 units apart, under a tsum width, so no sweep between.
  grabMs: 30,
  dwellMs: 18,
  releaseMs: 20,
  // Before the bubble sweep, so the last strokes' clears have landed.
  afterWindowMs: 3000,
};

/** One serpentine stroke over the left (`right` false) or right half. */
function cinderellaStroke(right: boolean): Point[] {
  const mirror = Config.screenResize - Config.tsumWidth;
  const col = (x: number) => right ? mirror - x : x;
  const path: Point[] = [];
  let y: number;
  for (y = 170; y >= 70; y -= 20) path.push({x: col(10), y: y});
  for (y = 60; y <= 180; y += 20) path.push({x: col(40), y: y});
  for (y = 180; y >= 60; y -= 20) path.push({x: col(70), y: y});
  for (y = 60; y <= 180; y += 20) path.push({x: col(100), y: y});
  return path;
}

/**
 * The stroke to draw next: whichever half and direction runs longest before
 * a tsum still clearing from an earlier stroke (`fluxFreeRun`), cut there,
 * since the chain stops at that tsum anyway. Ties go to `preferRight`'s half,
 * which keeps the old alternation when nothing is clearing.
 */
function cinderellaPickStroke(preferRight: boolean): { path: Point[], right: boolean, reversed: boolean } {
  let best: { path: Point[], right: boolean, reversed: boolean } | null = null;
  let bestRun = -1;
  const sides = [preferRight, !preferRight];
  for (let s = 0; s < sides.length; s++) {
    for (let r = 0; r < 2; r++) {
      const path = cinderellaStroke(sides[s]);
      if (r === 1) { path.reverse(); }
      const run = fluxFreeRun(path);
      if (run > bestRun) {
        bestRun = run;
        best = { path: path.slice(0, Math.max(run, 3)), right: sides[s], reversed: r === 1 };
      }
    }
  }
  return best!;
}

/** Draw a stroke, holding each point for a frame. False if cut by a pause. */
function cinderellaDraw(ts: Tsum, path: Point[]): boolean {
  const cfg = CinderellaConfig;
  if (!ts.mayTouchBoard()) { return false; }
  const pauses = ts.pauses;
  let x = 0, y = 0;
  for (let i = 0; i < path.length; i++) {
    x = Math.floor(ts.playOffsetX
      + (path[i].x + Config.tsumWidth / 2) * ts.playWidth / ts.playResizeWidth);
    y = Math.floor(ts.playOffsetY
      + (path[i].y + Config.tsumWidth / 2) * ts.playHeight / ts.playResizeHeight);
    if (i === 0) { tapDown(x, y, cfg.grabMs); }
    moveTo(x, y, cfg.dwellMs);
    // Paused mid-drag: let go, as `linkTsums` does.
    if (ts.pauses !== pauses) { break; }
  }
  tapUp(x, y, cfg.releaseMs);
  return ts.pauses === pauses;
}

Tsum.prototype.useCinderellaSkill = function(activatedAt) {
  const cfg = CinderellaConfig;
  const level = Math.min(Math.max(this.skillLevel, 1), cfg.windowMs.length);
  const opensAt = (activatedAt || Date.now()) + cfg.cutInMs;
  const closesAt = opensAt + cfg.windowMs[level - 1];
  const wait = opensAt - Date.now();
  if (wait > 0) { this.sleep(wait); }

  // Only start a stroke that can finish inside the window; the first is
  // estimated, the rest go by how long the last one actually took.
  let strokeMs = 27 * cfg.dwellMs + cfg.grabMs + cfg.releaseMs;
  let lastRight = true;
  for (let i = 0; this.isRunning && Date.now() + strokeMs <= closesAt; i++) {
    const pick = cinderellaPickStroke(!lastRight);
    lastRight = pick.right;
    const from = Date.now();
    const whole = cinderellaDraw(this, pick.path);
    strokeMs = Date.now() - from;
    // What it linked is clearing now; the next stroke steers round it.
    fluxNoteChain(pick.path, Date.now());
    logDebug(Log.Skill.CinderellaStroke, { stroke: i, right: pick.right, reversed: pick.reversed,
      points: pick.path.length, ms: strokeMs, level: level });
    if (!whole) { return; }
  }
  this.sleep(cfg.afterWindowMs);
  this.clearAllBubbles(10, 50, (Button.gameBubblesFrom.y + Button.gameBubblesTo.y) / 2, 200);
}

registerSkill({
  types: [SkillType.Cinderella],
  // useCinderellaSkill ends on clearAllBubbles.
  sweepsBubbles: true,
  beforeActivate: function(ts) {
    // A stroke that crosses a bubble pops it and ends the chain there, and
    // these strokes cross the whole board: spend the hoard before the window.
    ts.popGameBubbles(ts.gameBubbles.length);
  },
  afterActivate: function(ts, _board, activatedAt) {
    ts.useCinderellaSkill(activatedAt);
  }
});
