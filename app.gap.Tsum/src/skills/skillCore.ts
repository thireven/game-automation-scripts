// ---------------------------------------------------------------------------
// Skill dispatch
//
// Every playable skill lives in its own file under src/skills/ and registers a
// handler here. useSkill owns the parts that are the same for all of them --
// checking the gauge, the fever hold-off, the activation tap(s) -- and hands the
// skill-specific choreography to the registered handler.
//
// Files are concatenated in tsconfig order, so this file must come before the
// individual skill files: their registerSkill calls run at load time.
// ---------------------------------------------------------------------------

/** The play loop's chain limits for one skill. See `SkillHandler.chainLimits`. */
interface SkillChainLimits {
  maxChain?: number;
  maxChainsPerScan?: number;
}

interface SkillHandler {
  // skillType keys (from the Skill Type dropdown in settings) this handler drives.
  types: SkillType[];
  // A bare tap on the skill button is a complete activation: no aiming, no
  // follow-up, and a tap while the gauge is still filling is a no-op the game
  // ignores. Lets the play loop fire these blind instead of paying for a gauge
  // check (see Tsum.link and maybeAutoTapSkill) -- unless "Wait for Settle" is
  // set, which needs to know the gauge is full before it watches the board.
  bareTapActivates?: boolean;
  // The skill has two halves on two buttons (Pair Tsum): gameSkill2 counts
  // towards readiness and gets its own activation tap.
  usesSecondButton?: boolean;
  // EXPERIMENTAL. The skill is choreographed but its choreography is anchored
  // to the activation instant rather than to its own entry, so it survives
  // being fired mid-chain for the overload. Opts the skill into the cheap
  // probe path in maybeAutoTapSkill/useSkill; only consulted when the
  // "Auto-tap skill when ready" setting is on. See the note above
  // checkSkillReadinessFast for why this became possible.
  overloadProbe?: boolean;
  // What the play loop's chain limits are for this skill, overriding the
  // "Maximum Chain Number" and "Chains per board scan" settings.
  //
  // For a skill whose chains are worth something other than what they clear.
  // The settings are tuned for ordinary play -- many short chains keep the
  // combo alive -- and a skill that pays out on something else (a gauge, a
  // freeze window, a mode) can want the opposite badly enough that leaving it
  // to the player to notice is a worse default than saying so here.
  //
  // Applied where the limits are read, never written into the settings: the
  // Quick Bar goes on showing what the player chose, a skill change takes
  // effect on the next scan with nothing to restore, and a choreography that
  // throws cannot leave the run capped at something it set. `maxChain` is
  // `calculatePaths`' cap, where 0 means uncapped; `maxChainsPerScan` is how
  // many of what it finds get linked per scan. Either may be left out to keep
  // the setting for that one.
  //
  // A function is asked once per scan, so a skill whose board changes shape
  // mid-round can answer differently: Formal Suit Beast's mode leaves two
  // colours on the board, where short chains throw away the components that
  // makes, and the setting is right again the moment the mode ends. It is read
  // just before `orderPaths` runs, so a mode read off the board is one scan
  // stale -- which a mode measured in seconds does not notice.
  chainLimits?: SkillChainLimits | ((ts: Tsum) => SkillChainLimits);
  // Extra colour-cluster slots this skill's board scans keep, on top of the
  // `uniqueTsumCount - 1` every scan keeps by default.
  //
  // A frozen tsum is an ordinary colour cluster to the scan, so a skill that
  // freezes the board spends slots on its own ice -- and a live colour pushed
  // out of the last slot is not merely left unchained, it is not in the board
  // array at all and no pass can plan over it. Declared rather than set for the
  // duration of a choreography so every scan of the round agrees: the scans
  // between windows are the ones the ice-alike whitelist learns from, and a
  // colour it never saw there is a colour it cannot exonerate later. A
  // function is asked once per scan, for a skill that wants them only part of
  // the round.
  extraClusterSlots?: number | ((ts: Tsum) => number);
  // The choreography clears bubbles itself, with `clearAllBubbles`.
  //
  // That call is the deliberate override of the Bubble Strategy setting: the
  // skill turns tsums *into* bubbles, or ends on a board covered in them, so
  // hoarding them for a chain that will not come is not an option. This flag is
  // how the play loop knows without reading the choreography, and it does two
  // things with it: it does not count the activation towards its own periodic
  // sweep (which would sweep a board the skill just emptied), and it leaves the
  // skill's taps alone whatever the strategy says.
  sweepsBubbles?: boolean;
  // Bubbles on the board are this skill's to spend, not the Bubble Strategy's.
  //
  // For a skill that links bubbles into a chain of their own, where every bubble
  // the strategy pops on its way past is a link taken out of that chain. While
  // this answers true the play loop pops none at all (`Tsum#bubbleTapBudget`);
  // what the skill wants spent anyway it asks for through
  // `popBubblesAfterChain`.
  //
  // A function rather than a flag because it can be true for only part of a
  // round: Lorcana Aurora bursts bubbles before her transformation and chains
  // them after it.
  claimsBubbles?: (ts: Tsum) => boolean;
  // A chain just landed: how many of the scan's bubbles to tap into its clear.
  //
  // For a skill that claims the bubbles -- `bubbleTapBudget` is 0 while a claim
  // stands -- but still wants a few spent on its own terms. Aurora hoards them
  // for the next activation's chain, which is worth far more than any single
  // pop, but a board that only ever clears by chaining tsums is a slow board:
  // one bubble every couple of long chains keeps it moving and costs the chain
  // one link.
  //
  // Called once per chain linked, with that chain's length, so a skill can count
  // chains as well as read the board; `ts.gameBubbles` is what there is to tap.
  // Every other skill declares nothing here and leaves it to the Bubble
  // Strategy.
  popBubblesAfterChain?: (ts: Tsum, chainLength: number) => number;
  // The play loop's chain order is this skill's to change.
  //
  // Called once per board scan with everything `calculatePaths` found, in the
  // order it would otherwise be linked, and returns the list to link instead --
  // reordered, shortened or unchanged. It runs *before* the batch is cut to
  // `maxChainsPerScan`, so a skill choosing between colours can reach past the
  // longest chains to the ones it wants; dropping a path is allowed and means
  // "not this scan", since the next scan sees the board again.
  //
  // The only hook that runs while the skill is not activating, and it sits
  // between the scan and the first drag of the batch -- so whatever it does
  // comes out of combo time and has to stay cheap.
  orderPaths?: (ts: Tsum, paths: TsumPath[], board: BoardPoint[]) => TsumPath[];
  // The play loop's chains read the game's chain counter after each drag and
  // log it (`board.chainDrawn`, chainCounter.ts): what the game linked against
  // what was planned. For a skill whose own drags are being measured the
  // same way, so the two can be compared on the same boards; it costs each
  // chain a capture and `ChainCounterConfig.settleMs`, which is why not every
  // skill. A function is asked once per chain.
  readsChainCounter?: boolean | ((ts: Tsum) => boolean);
  // The skill changes how big the tsums are, so each scan reads their size
  // and scales the board read to it (`updateBoardScale`, `Config.boardScale`).
  // Costs a Hough pass per scan, which is why not every skill.
  scalesBoard?: boolean;
  // Width of the box blur a tsum's colour is sampled through, in play-square
  // px at scale 1 (default `TsumColorBlur`). Narrower keeps a packed
  // neighbour's colour out of the sample, for a roster whose tsums blur
  // together at the default.
  colorBlur?: number;
  // Highest saturation a tsum's colour sample counts with (default: no cap).
  // On a board of dark, vivid tsums the saturation swings more than the hue,
  // so capping it lets hue decide the clusters.
  chromaCap?: number;
  // How far apart two same-colour tsums may be and still be planned as one
  // chain, in tsum widths, for this scan -- or 0 to keep the "Link reach"
  // setting. For a skill that lets the game link farther than usual for a
  // while (Colorful Mickey Set). Asked once per scan.
  linkReach?: (ts: Tsum) => number;
  // The last activation is still in effect, so a tap now would waste the
  // gauge: Gaston's window is a timed mode, and an activation inside it only
  // restarts the animation over the seconds it had left. While this answers
  // true the play loop neither reads the gauge nor taps; the choreography that
  // knows the window's clock is the one to answer.
  stillRunning?: (ts: Tsum) => boolean;
  // Sees each board scan's capture before anything is planned or tapped, and
  // returns true if it acted on it (the scan then captures again). For a skill
  // whose activation can set off a follow-up the play loop must not touch
  // through: NBC Set's Oogie Boogie, whose dice any touch rerolls. Runs on
  // every scan, so it has to stay cheap.
  watchScan?: (ts: Tsum, img: NativeImage) => boolean;
  // Runs after the gauge check but before the activation tap -- settle waits and
  // pre-taps that have to land while the skill is not yet running.
  beforeActivate?: (ts: Tsum) => void;
  // The choreography, run straight after the activation tap. Returning false
  // reports "did not fire" to the caller even though the skill went off.
  // Without one, a bare-tap skill gets only the "Skill Waiting time" settle
  // after its tap, and any other skill `skillRandomizeAndWait`.
  // `activatedAt` is when the activation tap went out. Handlers whose timings
  // are absolute can ignore it; an overloadProbe handler must not.
  afterActivate?: (ts: Tsum, board?: BoardPoint[], activatedAt?: number) => boolean | void;
}

// Keyed loosely, valued as possibly-absent: a miss is normal (SkillType.NoSkill has no
// handler, and a stale setting from an older build still has to play). What is
// checked is *registration* -- registerSkill takes SkillType[], so a handler
// cannot be filed under an id the dropdown does not offer, which is the
// direction typos actually go.
var SkillHandlers: { [type: string]: SkillHandler | undefined } = {};

function registerSkill(handler: SkillHandler) {
  for (let i = 0; i < handler.types.length; i++) {
    SkillHandlers[handler.types[i]] = handler;
  }
}

// Skills with no choreography of their own: tap randomize (tsums that support it
// reshuffle) and wait for the clear to land. Also what an unregistered skillType
// falls back to, so a stale setting still plays. A bare-tap skill with no
// `afterActivate` skips it (`useSkill`).
//
// The "Skill Waiting time" setting is the budget, not the wait: `settleBoard`
// returns as soon as the tsums have stopped falling, and only a board still
// moving at the deadline spends the whole of it.
function skillRandomizeAndWait(ts: Tsum) {
  ts.tap(Button.fan, 100);
  ts.settleBoard(ts.skillInterval - 100);
}

function skillBareTapActivates(skillType: SkillType): boolean {
  const handler = SkillHandlers[skillType];
  return !!(handler && handler.bareTapActivates);
}

// Whether this skill ends its own choreography by clearing bubbles. See
// `SkillHandler.sweepsBubbles`; an unregistered skillType sweeps nothing.
function skillSweepsBubbles(skillType: SkillType): boolean {
  const handler = SkillHandlers[skillType];
  return !!(handler && handler.sweepsBubbles);
}

// Whether the skill's last activation is still running, so a tap would be
// wasted. See `SkillHandler.stillRunning`; every other skill is never running.
// The "Delay Skill ReActivation" setting holds any skill the same way for that
// long after `useSkill`'s last tap.
function skillStillRunning(ts: Tsum): boolean {
  if (ts.skillReactivationMs > 0 && ts.skillActivatedAt > 0
      && Date.now() - ts.skillActivatedAt < ts.skillReactivationMs) {
    return true;
  }
  const handler = SkillHandlers[ts.skillType];
  if (handler && handler.bareTapActivates && !handler.afterActivate
      && ts.skillActivatedAt > 0 && Date.now() - ts.skillActivatedAt < SkillTapHoldMs) {
    return true;
  }
  return !!(handler && handler.stillRunning && handler.stillRunning(ts));
}

/**
 * How long a bare-tap skill with no `afterActivate` counts as running after
 * `useSkill`'s tap. Its gauge still reads full that soon, and with no tail
 * after the tap Burst re-fired 56-70ms later on 8% of activations.
 */
const SkillTapHoldMs = 300;

// Whether the play loop reads the chain counter after each of its drags. See
// `SkillHandler.readsChainCounter`; every other skill's drags go unmeasured.
function skillReadsChainCounter(ts: Tsum): boolean {
  const handler = SkillHandlers[ts.skillType];
  const reads = handler && handler.readsChainCounter;
  return typeof reads === 'function' ? reads(ts) : !!reads;
}

// Whether each scan reads the tsums' size. See `SkillHandler.scalesBoard`;
// every other skill plays at `Config.boardScale` 1.
function skillScalesBoard(ts: Tsum): boolean {
  const handler = SkillHandlers[ts.skillType];
  return !!(handler && handler.scalesBoard);
}

// Whether the skill acted on this scan's capture. See `SkillHandler.watchScan`.
function skillWatchScan(ts: Tsum, img: NativeImage): boolean {
  const handler = SkillHandlers[ts.skillType];
  return !!(handler && handler.watchScan && handler.watchScan(ts, img));
}

// The colour sample's blur width. See `SkillHandler.colorBlur`.
function skillColorBlur(ts: Tsum): number {
  const handler = SkillHandlers[ts.skillType];
  return handler && handler.colorBlur ? handler.colorBlur : TsumColorBlur;
}

// The colour sample's saturation cap. See `SkillHandler.chromaCap`.
function skillChromaCap(ts: Tsum): number {
  const handler = SkillHandlers[ts.skillType];
  return handler && handler.chromaCap ? handler.chromaCap : Infinity;
}

// The play loop's link reach in tsum widths. See `SkillHandler.linkReach`;
// every other skill plays at the "Link reach" setting (`Config.linkReach`).
function skillLinkReach(ts: Tsum): number {
  const handler = SkillHandlers[ts.skillType];
  const reach = handler && handler.linkReach ? handler.linkReach(ts) : 0;
  return reach > 0 ? reach : Config.linkReach;
}

// Whether bubbles on the board belong to the skill rather than to the Bubble
// Strategy. See `SkillHandler.claimsBubbles`; every other skill claims nothing.
//
// Asked from `bubbleTapBudget`, which `link` reaches once per chain, so it stays
// a lookup and a call.
function skillClaimsBubbles(ts: Tsum): boolean {
  const handler = SkillHandlers[ts.skillType];
  return !!(handler && handler.claimsBubbles && handler.claimsBubbles(ts));
}

// How many of the scan's bubbles this skill wants tapped into the clear of a
// chain that just landed. See `SkillHandler.popBubblesAfterChain`; every other
// skill wants none and leaves the Bubble Strategy to it.
//
// Asked once per chain linked, so it stays a lookup and a call.
function skillPopBubblesAfterChain(ts: Tsum, chainLength: number): number {
  const handler = SkillHandlers[ts.skillType];
  return handler && handler.popBubblesAfterChain
    ? handler.popBubblesAfterChain(ts, chainLength) : 0;
}

// The chain length cap to search to, and how many chains to link per scan --
// this skill's `chainLimits` where it declares one, the player's setting
// everywhere else. See `SkillHandler.chainLimits`.
//
// `Config.maxChain` and `ts.maxChainsPerScan` are the settings, and stay
// exactly what the player set: an override belongs to the skill, not to them.

// This skill's limits for this scan, resolving a handler that answers with a
// function. Asked twice per scan, so it stays a lookup and a call.
function skillChainLimits(ts: Tsum): SkillChainLimits | undefined {
  const handler = SkillHandlers[ts.skillType];
  const limits = handler && handler.chainLimits;
  return typeof limits === 'function' ? limits(ts) : limits;
}

// Whether this scan links MyTsum chains first: the "Link MyTsum first"
// setting, unless the skill is holding it off. See `Tsum#setMyTsumPriority`.
function skillMyTsumPriority(ts: Tsum): boolean {
  return ts.prioritizeMyTsum && !ts.myTsumPriorityHeld;
}

// A skill's hold on the "Link MyTsum first" setting: `setMyTsumPriority(false)`
// stops the play loop linking MyTsum chains first, `setMyTsumPriority(true)`
// lifts the hold. For a skill whose board makes the priority useless -- Formal
// Suit Beast's mode leaves two colours to keep *level*, so putting one of them
// first would only fight that.
//
// A hold, not a write, for the same reasons `chainLimits` never touches the
// settings: the pages keep showing what the player chose, lifting the hold
// restores exactly that, and `setMyTsumPriority(true)` cannot switch the
// priority on for a player who has it off. A new run starts with no hold, and
// the Quick Bar lifts it on a skill change, so a skill that never lifts its own
// cannot outlive itself.
Tsum.prototype.setMyTsumPriority = function(enabled) {
  const held = !enabled;
  if (this.myTsumPriorityHeld === held) { return; }
  this.myTsumPriorityHeld = held;
  logDebug(Log.Skill.MyTsumPriorityHold, { held: held });
};

function skillMaxChain(ts: Tsum): number {
  const limits = skillChainLimits(ts);
  return limits && typeof limits.maxChain === 'number' ? limits.maxChain : Config.maxChain;
}

// How many colour clusters a board scan keeps for this skill. See
// `SkillHandler.extraClusterSlots`; every other skill keeps the
// `uniqueTsumCount - 1` it always did.
//
// Plus whatever the Lorcana ink stones need. That one is not a skill's
// declaration because it is not a skill's board: every Lorcana tsum plays on a
// board with stones on it, including the ones set to a plain Burst, so it is
// claimed off the setting instead (`lorcanaExtraClusterSlots`, src/lorcana.ts).
function skillClusterSlots(ts: Tsum): number {
  const handler = SkillHandlers[ts.skillType];
  const slots = handler && handler.extraClusterSlots;
  const extra = typeof slots === 'function' ? slots(ts) : slots;
  return ts.uniqueTsumCount - 1 + (typeof extra === 'number' ? extra : 0)
    + lorcanaExtraClusterSlots(ts);
}

function skillMaxChainsPerScan(ts: Tsum): number {
  const limits = skillChainLimits(ts);
  return limits && typeof limits.maxChainsPerScan === 'number'
    ? limits.maxChainsPerScan : ts.maxChainsPerScan;
}

// The chains this skill wants linked out of the ones the scan found, for a
// skill that has an opinion. See `SkillHandler.orderPaths`; every other skill,
// and an unregistered skillType, gets the list back untouched.
function skillOrderPaths(ts: Tsum, paths: TsumPath[], board: BoardPoint[]): TsumPath[] {
  const handler = SkillHandlers[ts.skillType];
  if (!handler || !handler.orderPaths) { return paths; }
  return handler.orderPaths(ts, paths, board);
}

/** The lower median of `values`. */
function skillMedian(values: number[]): number {
  const sorted = values.slice().sort(function(a, b) { return a - b; });
  return sorted[(sorted.length - 1) >> 1];
}

/**
 * Each circle's floor: the median darkest channel over a (2*grid+1)^2 grid
 * `step` px apart round its centre, from one play-square capture. With a
 * finger on a tsum the game paints the other tsums of its kind pale, which
 * lifts their floor; a read before the grab and one after gives the rise.
 */
function skillFloorRead(ts: Tsum, board: BoardPoint[], grid: number, step: number): number[] {
  const half = Config.tsumWidth / 2;
  const pts: Point[] = [];
  for (let c = 0; c < board.length; c++) {
    for (let i = -grid; i <= grid; i++) {
      for (let j = -grid; j <= grid; j++) {
        pts.push({
          x: Math.round(board[c].x + half + i * step),
          y: Math.round(board[c].y + half + j * step),
        });
      }
    }
  }
  const img = ts.playScreenshotSquare();
  let colors: Color[];
  try {
    colors = getImageColors(img, pts);
  } finally {
    releaseImage(img);
  }
  const per = (2 * grid + 1) * (2 * grid + 1);
  const out: number[] = [];
  for (let c = 0; c < board.length; c++) {
    const floors: number[] = [];
    for (let k = 0; k < per; k++) {
      const col = colors[c * per + k];
      floors.push(Math.min(col.r, col.g, col.b));
    }
    out.push(skillMedian(floors));
  }
  return out;
}

// The skill button reads one of these colors while the gauge is not yet full.
// Don't know the reason why these are checked instead of the "active skill"
// colors, but hopefully for a good reason.
var SkillNotActiveColors = [
  {"a": 0, "b": 157, "g": 112, "r": 85},
  {"a": 0, "b": 181, "g": 139, "r": 72},
  {"a": 0, "b": 128, "g": 73, "r": 16},
  {"a": 0, "b": 178, "g": 153, "r": 3},
  {"a": 0, "b": 255, "g": 215, "r": 33}
];

// Tiered gauge read against SkillNotActiveColors, at two thresholds: tight (25)
// means firmly empty; loose (60) is the plain not-active match. Returns
// 'active', 'almost', or 'far'.
//
// Note the sense: Active is *not matching* any not-active colour, so anything
// unexpected over the button -- including the skill's own animation -- reads
// Active. Callers that fire on Active need something else to stop them firing
// again while the skill runs.
function classifySkillGauge(c: Color): SkillReadiness {
  let matchesTight = false, matchesLoose = false;
  for (let i = 0; i < SkillNotActiveColors.length; i++) {
    const nc = SkillNotActiveColors[i];
    if (isSameColor(nc, c, 25)) { matchesTight = true; }
    if (isSameColor(nc, c, 60)) { matchesLoose = true; }
  }
  if (!matchesLoose) { return SkillReadiness.Active; }
  if (!matchesTight) { return SkillReadiness.Almost; }
  return SkillReadiness.Far;
}

// The bottom chrome, either side of the fever bar. Disney Villains (Set) paints
// the whole screen in smoke while its skill runs -- bright green, later purple
// -- which reads Active at the button, so the play loop re-fired it every
// ~300ms and drew no chains for the whole window. Normal chrome is cyan
// (0,202,232) and fever chrome dark teal (0,44,54).
//
// The Quick Bar's translucent grey strip covers the bottom pair (its top is
// ~y 1734), so the side margins beside the skill and fan buttons back them up.
// The smoke there is patchier, hence the looser test.
const SkillSmokeProbes: Coord[] = [
  {x: 300, y: 1885}, {x: 780, y: 1885},  // bottom chrome
  {x: 30, y: 1700}, {x: 1050, y: 1700}   // side margins, above the Quick Bar
];

function isSkillSmoke(c: Color): boolean {
  const green = c.g >= 150 && c.r <= 60 && c.b <= 100;   // ~(0,220,0)
  const purple = c.g <= 40 && c.r >= 100 && c.b >= 150;  // ~(160,0,220)
  return green || purple;
}

function isSkillSmokeLoose(c: Color): boolean {
  const green = c.g >= 110 && c.g - c.r >= 70 && c.g - c.b >= 50;
  const purple = c.g <= 50 && c.r >= 60 && c.b >= 110 && c.b - c.g >= 90;
  return green || purple;
}

Tsum.prototype.checkSkillReadiness = function(img, skillButton) {
  const smoke = this.getColors(img, SkillSmokeProbes);
  if ((isSkillSmoke(smoke[0]) && isSkillSmoke(smoke[1]))
      || (isSkillSmokeLoose(smoke[2]) && isSkillSmokeLoose(smoke[3]))) {
    return SkillReadiness.Far;
  }
  return classifySkillGauge(this.getColor(img, skillButton));
};

// Half-width of the gauge crop, in logical px, scaled to capture space the way
// sampleMyTsumColor scales its own. Only has to contain the single probe point.
const SkillGaugeCropRadius = 24;

// The same reading off a crop around the skill button instead of a whole-screen
// capture downscaled to 360px wide to sample one pixel.
//
// This is what makes firing ASAP compatible with a choreography. Per the host's
// own stage timings (the platform app's README, "capture timings"), the grab is
// ~2.35ms warm and the region+convert is ~1.83ms at 360x640 but ~0.29ms at
// 200x200 -- so a full screenshot() is ~4.2ms and this is ~2.4ms, against a
// tap's >=10ms (the host holds the touch for `during`). Measured on MuMu: the
// crop ~3-8ms against a blind tap's ~21ms, and 95% of blind taps landing on a
// gauge not yet full -- so `maybeAutoTapSkill` reads before it taps.
//
// No resize is requested, so the probe coordinate stays crop-local and cannot
// drift with resizeRatio the way getColor's toResizeXYs mapping would.
Tsum.prototype.checkSkillReadinessFast = function() {
  const center = this.toRealXY(Button.gameSkill1.x, Button.gameSkill1.y);
  const r = Math.max(4, Math.floor(SkillGaugeCropRadius * this.captureGameRatio));
  const x = Math.max(0, center.x - r);
  const y = Math.max(0, center.y - r);
  const img = getScreenshotModify(x, y, r * 2, r * 2, 0, 0, 100);
  try {
    return classifySkillGauge(getImageColor(img, center.x - x, center.y - y));
  } finally {
    releaseImage(img);
  }
};

// Whether firing the fan now would be a waste: the tsums it shuffles are about
// to be cleared by a skill that is ready or nearly so. It also leaves the board
// churning right as the skill activates, which matters for skills that read the
// board on activation (Tiara Minnie+ blows up whatever is under her pick).
// Costs one screenshot, so only call it where a fan tap is actually pending.
Tsum.prototype.fanWouldBeWasted = function() {
  const img = this.screenshot();
  try {
    return this.checkSkillReadiness(img, Button.gameSkill1) !== SkillReadiness.Far;
  } finally {
    releaseImage(img);
  }
};

// When skillAutoTap is on, fire the skill the moment it's ready instead of
// waiting for the next useSkill at the end of the board-scan cycle. The gauge
// can fill and sit ready for seconds while we scan, calculate and link; this is
// called often (e.g. between chains) but only does a real screenshot/check once
// per skillAutoTapInterval ms, so the timestamp guard keeps frequent calls cheap.
// Routes through useSkill so every skill type's activation (and choreography) is
// handled exactly as the normal end-of-cycle path.
// EXPERIMENTAL, overload path only. How often the cropped probe may run, and
// how long after an activation the probe loop stays quiet.
//
// The probe interval is deliberately below one drag: link() calls this after
// every chain, and the point of the exercise is to fire within the window where
// a long chain's erased MyTsums are still counting into the gauge. At ~2.4ms a
// probe, six chains cost ~15ms against a batch whose drags alone are >=30ms
// each -- so this is bounded by the game's animation, not by us.
const SkillOverloadProbeIntervalMs = 40;
const SkillOverloadCooldownMs = 1500;

// Answers whether a *choreographed* activation ran, so a caller holding a plan
// made before it knows that plan is stale: a choreography is seconds of taps,
// drags and waits, and the board it hands back is not the one it was given.
// `Tsum.link` ends its batch on it. A bare-tap skill's tap answers false: its
// batch carries on, as it did when the tap was blind.
Tsum.prototype.maybeAutoTapSkill = function(board) {
  if (!this.skillAutoTap) { return false; }
  // Before the interval stamp, so the first probe after the window closes is
  // not put off by one more interval.
  if (skillStillRunning(this)) { return false; }
  const now = Date.now();
  const handler = SkillHandlers[this.skillType];
  const overload = !!(handler && handler.overloadProbe);
  if (overload && now < this._skillCooldownUntil) { return false; }
  const interval = overload ? SkillOverloadProbeIntervalMs : this.skillAutoTapInterval;
  if (now - this._lastSkillAutoTap < interval) { return false; }
  this._lastSkillAutoTap = now;
  // A bare tap is a complete activation for burst skills. It used to go out
  // blind -- the game ignores it until the gauge is full -- but a crop read is
  // cheaper than the tap, and 95% of blind taps landed on a gauge not yet full,
  // so the read decides. A gauge that fills between the read and the next one
  // is caught then, or by `useSkill` at the end of the turn. Not with a "Wait
  // for Settle" set: this tap cannot wait for the board, so those skills take
  // the gauge read and `useSkill` below instead, where the settle wait sits
  // before the tap. Same for "Delay Skill ReActivation": the delay runs from a
  // tap known to have fired.
  if (skillBareTapActivates(this.skillType) && this.skillSettleMs <= 0
      && this.skillReactivationMs <= 0) {
    if (this.checkSkillReadinessFast() !== SkillReadiness.Active) {
      return false;
    }
    this.skillFiredAt = Date.now();
    this.tap(Button.gameSkill1, 10);
    // Full before the tap, so the tap fired it, and the Bubble Strategy's next
    // pop would land in the hole the burst is about to leave (the animation
    // reads Active too, as it always did here). Held only with bubbles on the
    // board and no hold standing: those are what the hold is for, since the
    // bubbles the burst itself makes are new to the next scan and
    // `ripeGameBubbles` holds them by age. The scan's bubbles go with the
    // hold: their positions and blast counts were read off the board being
    // cleared.
    if (this.gameBubbles.length > 0 && Date.now() >= this.bubbleHoldUntil) {
      logDebug(Log.Skill.BlindTapFired, { bubbles: this.gameBubbles.length });
      this.holdBubblesAfterSkill(Date.now());
      this.gameBubbles = [];
    }
    return false;
  }
  // One readiness read before the full useSkill probe (findPage plus a double
  // gauge check, several screenshots) so the recurring cost while the gauge is
  // still filling stays at a single screenshot.
  let status: SkillReadiness;
  if (overload) {
    status = this.checkSkillReadinessFast();
  } else {
    const img = this.screenshot();
    try {
      status = this.checkSkillReadiness(img, Button.gameSkill1);
    } finally {
      releaseImage(img);
    }
  }
  if (status !== SkillReadiness.Active) { return false; }
  const fired = this.useSkill(board, overload);
  if (overload) {
    // Whether or not it fired: a probe that saw Active and a useSkill that then
    // did not is exactly the mid-animation false positive the negative sense of
    // classifySkillGauge produces, and re-probing it 40ms later just repeats it.
    this._skillCooldownUntil = Date.now() + SkillOverloadCooldownMs;
    logDebug(Log.Skill.OverloadProbe, { fired: fired, durationMs: Date.now() - now });
  }
  return fired;
};

// Hold off activating while a fever is about to end, so the skill's clear lands
// in the next fever rather than being spent on its last moments.
function skillWaitOutEndingFever(ts: Tsum) {
  let feverAlmostOver = null;
  do {
    if (feverAlmostOver) {
      ts.sleep(100);
    }
    // Where along the fever bar's fill "nearly over" sits, in logical px --
    // the fill's geometry is `FeverBar`. Hoisted above the read because the
    // probe list has to be complete before it is sent, and this depends only
    // on the setting, not on the frame.
    const bar = FeverBar;
    const offsetX = Math.floor((bar.xEnd - bar.xStart) * ts.noSkillLastFeverSec
      * 1000 / bar.durationMs);
    const img = ts.screenshot();
    try {
      // One crossing for all seven probes rather than seven. This runs in a
      // poll loop that re-reads until the fever stops ending, so the saving is
      // per iteration, not once.
      // The backdrop probe is `FeverProbes`' dimmed-chrome one, beside the
      // score capsule: (340,310), where this used to read, is the gem icon on
      // the 2025 layout, so the hold-off never fired there.
      const backdrop = FeverProbes[2];
      const p = ts.getColors(img, [
        {x: backdrop.x, y: backdrop.y},      // 0 in-fever backdrop
        {x: 332, y: 1666},                   // 1 fever ring, left
        {x: 746, y: 1666},                   // 2 fever ring, right
        {x: bar.xStart, y: bar.y},           // 3 fill start
        {x: bar.xStart + offsetX, y: bar.y}, // 4 fill at the "nearly over" mark
        {x: 155, y: 190},                    // 5 remaining time
        {x: 144, y: 195}                     // 6 a few seconds left
      ]);
      const fever1 = isSameColor(p[0], backdrop, backdrop.threshold);
      const feverRingLeft = rgb2hsv(p[1]);
      const feverRingRight = rgb2hsv(p[2]);
      const hueDifference = Math.min(
          Math.abs(feverRingLeft.h - feverRingRight.h),
          360 - Math.abs(feverRingLeft.h - feverRingRight.h));
      const fever2 = hueDifference > 20;
      const feverStartColorHsv = rgb2hsv(p[3]);
      const feverEndColorHsv = rgb2hsv(p[4]);
      const nearlyDone = feverEndColorHsv.v < 90 || Math.abs(feverStartColorHsv.v - feverEndColorHsv.v) > 10;
      const enoughSecondsRemaining = isSameColor(p[5], p[6], 60);
      // logDebug(Log.Skill.FeverHoldOff, {fever1: fever1, fever2: fever2, almostOver: nearlyDone, enoughTime: enoughSecondsRemaining});
      feverAlmostOver = fever1 && fever2 && nearlyDone && enoughSecondsRemaining;
    } finally {
      releaseImage(img);
    }
  } while (feverAlmostOver);
}

// Gap between the two readiness reads. It was 200ms on the ordinary path and 30
// on the overload one, on the reasoning that the longer gap caught the button
// mid-flash -- but at ~4.2ms a read, 200 was 40x the thing it was separating,
// and the overload path had been proving 30 since it was written. 30ms still
// separates two frames at 60Hz, and is inside the count-in window the overload
// needs.
const SkillReadDebounceMs = 30;

/**
 * How often `useSkill`'s look scores the whole page table; in between it scores
 * `inRoundPages()`, at half the cost (~0.5ms a turn). The full look keeps the
 * guards for screens outside that set live mid-round (root warning, network
 * dialogs). Over 30 minutes on two emulators, the mid-round full looks found
 * no such screen and 7 false ones.
 */
const SkillFullLookEveryMs = 1000;
/** When `useSkill` last scored the whole table. */
var gSkillFullLookAt = 0;

Tsum.prototype.useSkill = function(board, fast) {
  if (this.skillType === SkillType.NoSkill) {
    return false;
  }

  // One look, no retry budget. This is a guard, not a wait: the gauge is read
  // straight after it either way, and the look's timeout
  // is only ever spent when *nothing* fingerprints -- which mid-round means an
  // animation is covering the HUD, exactly when firing the skill is unwanted.
  // The 500ms it used to ask for bought nothing and stacked onto the play loop's
  // own check on every such frame.
  //
  // The board only, and the pause menu emphatically not: the menu leaves the
  // skill button showing over a screen that has stopped moving, so every read
  // says "ready" and the tap that should spend it never reaches the game. The
  // play loop's `while (this.useSkill(board))` then never ends -- which is what
  // a paused round used to hang on. The look is also what presses
  // Continue (`dismiss.resumeGame`), so returning false here hands the loop a
  // board again rather than parking it.
  //
  // The look's frame comes back with it when nothing touched the screen after
  // it, and the first gauge read below is taken off that rather than a capture
  // of its own: the same moment, one capture fewer an iteration.
  const full = Date.now() - gSkillFullLookAt >= SkillFullLookEveryMs;
  if (full) {
    gSkillFullLookAt = Date.now();
  }
  const look = gPages.detectWithFrame(1, 0, full ? undefined : inRoundPages());
  let lookFrame = look.frame;
  const handler = SkillHandlers[this.skillType];
  const usesSecondButton = !!(handler && handler.usesSecondButton);
  let skillActive2 = false;
  try {
    if (look.page !== PageName.GamePlaying) {
      return false;
    }

    // A skill whose last activation is still running says so, and a full gauge
    // waits for it: the tap would only restart the animation over the window's
    // remaining seconds. See `SkillHandler.stillRunning`.
    if (skillStillRunning(this)) {
      logDebug(Log.Skill.StillRunning, { skill: this.skillType });
      return false;
    }

    // Checked twice, a moment apart: a single read can catch the button mid-flash.
    // `fast` shrinks the read -- a crop of the button instead of the whole screen
    // -- because on the overload path this whole block sits between the gauge
    // filling and the tap that spends it.
    const cropped = !!fast && !usesSecondButton;
    for (let i = 0; i < 2; i++) {
      let skillActive1: boolean;
      if (cropped) {
        skillActive1 = this.checkSkillReadinessFast() === SkillReadiness.Active;
      } else {
        const img = lookFrame !== null ? lookFrame : this.screenshot();
        lookFrame = null;
        try {
          skillActive1 = this.checkSkillReadiness(img, Button.gameSkill1) === SkillReadiness.Active;
          skillActive2 = usesSecondButton
            && this.checkSkillReadiness(img, Button.gameSkill2) === SkillReadiness.Active;
        } finally {
          releaseImage(img);
        }
      }
      if (skillActive1 || skillActive2) {
        if (i === 0) {
          this.sleep(SkillReadDebounceMs);
        }
      } else {
        return false;
      }
    }
  } finally {
    if (lookFrame !== null) {
      releaseImage(lookFrame);
    }
  }

  // "Wait for Settle": the gauge fills off a chain, and the loop chains fast
  // enough that the board is often half empty and still refilling when it
  // does. Fired then, the skill clears very little. The setting is the most
  // this waits: `settleBoard` hands back as soon as the tsums have landed, so a
  // board already refilled costs three reads. No floor -- the default 500ms one
  // guards a skill's own cut-in, and nothing has fired yet. Ahead of the fever
  // hold-off so that still reads a fresh frame, and ahead of `beforeActivate`
  // so a handler's own pre-taps and baseline reads stay right before the tap.
  // Applies on the overload path too: the setting is explicit, and a tsum that
  // wants the fill instant leaves it 0.
  //
  // A board found still moving gets the last scan's bubbles popped into it,
  // as many as the Bubble Strategy allows a chain, so the refill lands as one
  // drop rather than the skill firing round bubbles it then has to wait on. A
  // board already still keeps them: the skill is about to fire anyway. The
  // hold after the last activation stands, inside `popGameBubbles` -- those
  // bubbles were read off a board a skill was still detonating on.
  let settleMs = 0;
  let settled: boolean | undefined;
  if (this.skillSettleMs > 0) {
    const from = Date.now();
    settled = this.settleBoard(this.skillSettleMs, 0, () => { this.popGameBubbles(); });
    settleMs = Date.now() - from;
    if (!this.isRunning) {
      return false;
    }
  }

  if (this.noSkillLastFeverSec > 0) {
    skillWaitOutEndingFever(this);
  }

  // `settleMs` is what the wait above actually took, against the setting's
  // ceiling; `settled` is whether the board held still inside it.
  logInfo(Log.Skill.Use, { skill: this.skillType, skillLevel: this.skillLevel,
    settleMs: settleMs, settled: settled });
  if (handler && handler.beforeActivate) {
    handler.beforeActivate(this);
  }

  // Stamped at touch-down, not after the tap returns: "activation" is when the
  // press lands, and stamping after would fold `tap`'s default 50ms hold into
  // every offset measured from it -- silently, and differently if that default
  // ever changes. An anchored choreography measures its waits from here, so
  // everything the handler spends before its first timed tap, including this
  // tap's own hold and the settle below, comes out of its own budget.
  const activatedAt = Date.now();
  this.skillActivatedAt = activatedAt;
  this.skillFiredAt = activatedAt;
  // No Bubble Strategy pop for a while from here: the burst is about to empty
  // the board round every bubble on it. See `holdBubblesAfterSkill`.
  this.holdBubblesAfterSkill(activatedAt);
  // The Lorcana card check stands down until this animation is over: for a
  // Lorcana tsum the animation *is* a card, drawn across the whole screen.
  // Here rather than in the play loop because this is the one place every
  // activation goes through -- see `lorcanaNoteSkillFired`.
  lorcanaNoteSkillFired();
  // A bare-tap skill with no choreography needs nothing after its tap but the
  // "Skill Waiting time" settle: the play loop's own bare tap fires the same
  // skills with no tail at all. The fan tap and waits below cost ~180ms an
  // activation; the second after a firing without them drew 37% more chains,
  // with no more dead scans.
  if (handler && handler.bareTapActivates && !handler.afterActivate) {
    this.tap(Button.gameSkill1, 10);
    if (this.skillInterval > 0) {
      this.settleBoard(this.skillInterval);
    }
    return true;
  }
  this.tap(Button.gameSkill1);
  this.sleep(30);
  if (skillActive2) {
    this.tap(Button.gameSkill2);
    this.sleep(30);
  }

  if (handler && handler.afterActivate) {
    return handler.afterActivate(this, board, activatedAt) !== false;
  }
  skillRandomizeAndWait(this);
  return true;
}
