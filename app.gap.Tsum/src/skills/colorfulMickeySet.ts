// Colorful Mickey (Set).
//
// Activates like a burst. For a few seconds after it, the game links tsums of
// one kind from most of the board apart, so the play loop plans its chains at
// that reach (`linkReach`) for as long as the window lasts.
//
// The window is timed from the activation tap (`ts.skillActivatedAt`), so it
// closes a little before the game's does: chains planned past the real window
// would be drawn at a reach the game no longer accepts and link nothing.
//
// No `bareTapActivates`: a blind tap does not know whether it fired, so the
// window would have no start. Going through `useSkill` stamps it.

var ColorfulMickeyConfig = {
  // How long the long reach lasts, by skill level 1-6. Player-observed.
  windowMs: [8500, 9800, 11100, 12400, 13700, 15000],
  // The reach while it lasts, as a share of the play square's width.
  reachOfBoard: 0.8,
};

registerSkill({
  types: [SkillType.ColorfulMickeySet],
  linkReach: function(ts) {
    const cfg = ColorfulMickeyConfig;
    if (ts.skillActivatedAt <= 0) { return 0; }
    const level = Math.min(Math.max(ts.skillLevel, 1), cfg.windowMs.length);
    if (Date.now() - ts.skillActivatedAt >= cfg.windowMs[level - 1]) { return 0; }
    return cfg.reachOfBoard * Config.screenResize / tsumSpan();
  },
  afterActivate: function(ts) {
    skillRandomizeAndWait(ts);
  }
});
