// Colorful Mickey (Set).
//
// Activates like a burst. Once its combo skill has played, the game draws a
// timer bar along the bottom rim of the board, and while that bar is up tsums
// of one kind link from most of the board apart. So each scan reads the bar
// (`watchScan`), and while it was seen recently the play loop plans at that
// reach (`linkReach`) with no "Maximum Chain Number" cap (`chainLimits`).
//
// The bar, not a clock: a skill fired while it is up sets off another set
// skill, so the skill level's duration does not say when the window ends.
//
// The bar is a pink-to-white fill from the left over a black track, draining
// to the left. Its right tip is past the fill's reach and reads black the
// whole time, except for the first second or so of its entry animation.
// Without the bar the rim there is bright (the board's glow) or tsums.

// ---- Tuning data ----------------------------------------------------------

// Measured on a 540x960 recording of one window (doubled here): the bar's
// centreline is an arc from y 1476 at its left end down to 1521 mid-board.
var ColorfulMickeyBar = {
  /** Points along the fill, left to right. Lit ones form a run from the left. */
  samples: [
    {x: 140, y: 1476}, {x: 220, y: 1492}, {x: 300, y: 1505}, {x: 380, y: 1513},
    {x: 460, y: 1519}, {x: 540, y: 1521}, {x: 620, y: 1521}, {x: 700, y: 1517},
    {x: 780, y: 1509}, {x: 860, y: 1500}, {x: 940, y: 1485},
  ] as Point[],
  /** The track's right tip, never filled once the entry animation is over. */
  tip: [{x: 1000, y: 1473}, {x: 1020, y: 1468}] as Point[],
  /** Lowest value (max of r, g, b) of the fill. It pulses pink to white: 180+. */
  litValue: 150,
  /** Highest value of the track: 0 mid-board, up to ~55 by the tip. */
  trackValue: 60,
  /**
   * How long the window stays open after the bar was last seen. The skill's
   * own effects hide the bar for up to ~1.2s at a time; past this, the bar
   * is taken to be gone.
   */
  closeAfterMs: 1500,
  /**
   * After a close, one sighting reopens the window for this long; past it,
   * opening takes two scans in a row again. Keeps a slow scan rate from
   * losing the window to those gaps.
   */
  reopenWithinMs: 5000,
  /** The link reach while the bar is up, as a share of the play square's width. */
  reachOfBoard: 0.8,
};

// ---- Reader ---------------------------------------------------------------

/** When the bar was last read on screen, 0 for not this window. */
var gColorfulMickeyBarAt = 0;
/** The last scan saw the bar: opening takes two in a row, so one odd frame cannot. */
var gColorfulMickeyBarPrev = false;
/** When the window last closed, for `reopenWithinMs`. */
var gColorfulMickeyClosedAt = 0;
/** The window as last logged, so the change is logged once each way. */
var gColorfulMickeyLogged = false;

/** Whether the long reach is open now. */
function colorfulMickeyOpen(): boolean {
  return gColorfulMickeyBarAt > 0
    && Date.now() - gColorfulMickeyBarAt < ColorfulMickeyBar.closeAfterMs;
}

/**
 * Whether the bar is on screen, off a native crop of the rim (~2ms, the
 * fever bar's read). Every sample must be fill or track, the fill a run from
 * the left with at least one sample in it, and the tip track.
 */
function colorfulMickeyBarSeen(ts: Tsum): boolean {
  const cfg = ColorfulMickeyBar;
  const pts = cfg.samples.concat(cfg.tip);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x);
    minY = Math.min(minY, pts[i].y); maxY = Math.max(maxY, pts[i].y);
  }
  const topLeft = ts.toRealXY(minX, minY);
  const bottomRight = ts.toRealXY(maxX, maxY);
  const x = Math.max(0, topLeft.x);
  const y = Math.max(0, topLeft.y);
  const img = getScreenshotModify(x, y, Math.max(1, bottomRight.x - x + 1),
    Math.max(1, bottomRight.y - y + 1), 0, 0, 100);
  try {
    const local: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = ts.toRealXY(pts[i].x, pts[i].y);
      local.push({x: p.x - x, y: p.y - y});
    }
    const colors = getImageColors(img, local);
    const n = cfg.samples.length;
    for (let i = n; i < colors.length; i++) {
      if (Math.max(colors[i].r, colors[i].g, colors[i].b) > cfg.trackValue) { return false; }
    }
    let lit = 0;
    for (let i = 0; i < n; i++) {
      const c = colors[i];
      const v = Math.max(c.r, c.g, c.b);
      // Fill is pink to white, so red leads green.
      if (v >= cfg.litValue && c.r >= c.g) {
        if (lit < i) { return false; }  // fill after track
        lit++;
      } else if (v > cfg.trackValue) {
        return false;
      }
    }
    return lit > 0;
  } finally {
    releaseImage(img);
  }
}

registerSkill({
  types: [SkillType.ColorfulMickeySet],
  bareTapActivates: true,
  // Reads the bar once per scan; never acts on the frame.
  watchScan: function(ts) {
    const seen = colorfulMickeyBarSeen(ts);
    const now = Date.now();
    if (seen && (colorfulMickeyOpen() || gColorfulMickeyBarPrev
        || now - gColorfulMickeyClosedAt < ColorfulMickeyBar.reopenWithinMs)) {
      gColorfulMickeyBarAt = now;
    }
    gColorfulMickeyBarPrev = seen;
    const open = colorfulMickeyOpen();
    if (open !== gColorfulMickeyLogged) {
      gColorfulMickeyLogged = open;
      if (!open) { gColorfulMickeyClosedAt = now; }
      logInfo(Log.Skill.ColorfulMickeyReach, { open: open });
    }
    if (!open) { gColorfulMickeyBarAt = 0; }
    return false;
  },
  // Uncapped while the bar is up: the long reach is for long chains.
  chainLimits: function() {
    return colorfulMickeyOpen() ? {maxChain: 0} : {};
  },
  // 0 keeps the "Link reach" setting.
  linkReach: function() {
    return colorfulMickeyOpen()
      ? ColorfulMickeyBar.reachOfBoard * Config.screenResize / tsumSpan() : 0;
  },
  afterActivate: function(ts) {
    skillRandomizeAndWait(ts);
  }
});
