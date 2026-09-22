// ---------------------------------------------------------------------------
// Gaston
//
// His activation changes nothing already on the board: for a window his skill
// level sets, every tsum that *drops* is a Gaston. So the activation is worth
// however much board gets cleared while it is open -- clear a chain of Gastons
// and the hole fills with more of them -- and the chain that clears it wants to
// take as much of the board as it can. A human playing him draws **one chain of
// about thirty**; measured off `debug/gaston_correct.mp4`, that is the whole
// skill.
//
// ## The round, and the window inside it
//
// Before the first activation the round is ordinary play: the play loop's
// chains, the Bubble Strategy's pops. The activation is what changes the
// board -- every tsum that drops after it is Gaston, and every activation
// leaves a bubble -- so from the first one on the round is played to keep it
// that way: bubbles are the window's (`claimsBubbles`), spent inside it on the
// leftovers, and nothing between windows pops one. The window itself is two
// chains and a hold. The longest chain on the board, cancelled at once
// with a bubble so the refill lands as one drop, twice (`passesBeforeHold`);
// then the longest chain again, drawn and **held on its last tsum until the
// window has closed**, because Gastons cleared while the skill runs fill
// nothing and the ones cleared after it fill the gauge as they pop. Released
// past the close, that chain's clear is the charge, and the button is tapped
// through it until the gauge reads full. Timed right, only Gastons ever drop
// after the first activation.
//
// ## The chain is the longest path, from wherever it starts
//
// For a while the chain was a snake: a boustrophedon down the pile from a top
// corner of the biggest component, as the human's thirty-chain in
// `gaston_correct.mp4` is drawn, on the theory that the drops land at the top
// and a chain from the top is the one the next drop feeds. On the device the
// constraint cost more than it bought. Forced to start at the corner, the route
// ran upward into dead ends, up against a bubble, or back over itself, and the
// game stopped linking there. So the chain is the longest simple path over the
// free Gastons (`gastonChain`, on `findLongestTsumPath` -- the play loop's own
// search, every tsum tried as a start, under `searchSteps`), starting wherever
// that path starts. Replayed over 725 logged device boards it plans 15,917
// tsums to the snake's 15,743, longer on 131 boards and shorter on 5, the whole
// component on 647. The game takes any hop inside its reach, so the count is
// the point and the shape is nothing.
//
// **Which end it starts from is not nothing.** `gaston_7.mp4` (2026-09-21),
// aligned to its log and every route overlaid on the frames, had seven of
// eighteen drags register 1-8 of 14-33 planned, and five of the seven began on
// a tsum that was not Gaston: Lumiere, whose tan the scan merges with his
// face; Chip, with the Hough centre landed on the white cup beside him; the
// Beast, navy beside his hair. All at the *bottom* of the pile. The Gastons
// drop onto whatever the last clear left, so the frontier where his mass meets
// the leftovers is the bottom edge, and a longest path runs tip to tip -- one
// end of it is nearly always on that frontier. A wrong head links nothing for
// the whole drag (the game links from the head only), the cancel spends a
// bubble on nothing, and the refill gate then waits its floor for a clear that
// never happened: 2.75s of a 6s window, twice in some windows. So the drag
// starts from the higher end, and an end touching a known leftover loses
// whatever its height (`gastonOrient`); four of the five had a Gaston at the
// other end. What the scan cannot see -- a leftover merged into his cluster --
// the head check below catches.
//
// **The route is Gaston only, and Gaston is learned from the board.** The route
// ran over the whole board array for a while, on the theory that a leftover of
// another colour the drag crosses is inert. It is not. The game links a tsum
// only while it is within reach of the chain's *head*, so the first leftover in
// the route leaves every Gaston after it two hops from the head, and the chain
// stalls there for good: `gaston_debug6.mp4` registered 14, 17, 2, 1 and 8 of
// routes planned at 29, 35, 15, 22 and 28, every stall on an ordinary 23-33px
// hop, while 43-44px hops inside the same chains linked fine. So the route is
// drawn over his tsums alone, and **his tsums are the board's biggest colour
// cluster, nothing else** (`gastonGastons`). Gaston is one colour to the game
// and two or three to the scan -- a tan face under black hair, and the Hough
// centre lands on either -- and on any board the window has cleared once the
// face cluster is the biggest by a distance. A palette was kept for a while,
// learned by size on the window's first board and matched by colour after, to
// bring his hair cluster in; `gaston_2.mp4` (2026-09-20, aligned to its log and
// read chain by chain) showed both halves fail. Learned on a board still half
// leftovers it took the reds and the blues as his second cluster, and matching
// within the scan's own merge distance it admitted Marie's cluster beside his
// face: ten of the round's 21 chains started on a leftover and linked one to
// four tsums of 17-33 planned. A route over one cluster is at worst a chain of
// one leftover colour, which still clears and drops Gastons. What the scan
// merges *into* that cluster this file cannot tell apart -- Marie's pale face
// beside his, the navy tsums beside his hair -- and a chain planned through one
// stops there (20 of 26, 19 of 23, the same recording). That is the colour
// model's to fix. Matching the skill-button portrait was tried first and drew
// nothing: his face on blue is not his sprite on the board. `extraClusterSlots`
// keeps his second and third clusters in the board array whatever the
// leftovers do.
//
// ## Nothing here consults the chain settings
//
// "Maximum Chain Number" and "Chains per board scan" are tuned for ordinary
// play, where many short chains keep the combo alive. They are the wrong answer
// for every part of this skill, so `chainLimits` buys both of them out for the
// play loop between windows: the chain is **uncapped** and exactly **one** goes
// out per scan. The second half matters as much as the first -- the extra chains
// of a batch are planned on a board the first chain has already cleared, and on
// a Gaston board that is what turns one chain of thirty into a chain of twelve
// and two of three. Inside the window the pass consults nothing at all.
//
// ## The activation animation is 3.4 seconds and the window is 6
//
// So the window is anchored to the **end of the animation**, not to the tap.
// Measured off `gaston_correct.mp4` frame by frame: the tap lands at 8.0s, the
// board sits under a dark flexing figure until 11.4s, fills with Gaston by
// 13.5s, and the chain goes out at 14.3s. Anchored at the tap, a 6s window is
// over before the board is worth looking at -- which is exactly what
// `gaston_wrong.mp4` shows: five seconds of window spent scanning a board under
// the veil, then the play loop chaining fours across a board of twenty-six
// Gastons.
//
// The gate is **a full count that has stopped climbing, behind a floor** -- a
// count, not positions. A position gate was tried: the circles matched read to
// read, landed meaning nine in ten within 3px of a read ago. Run through the
// same Hough pass over the frames of a board that had visibly landed
// (`debug/gaston_debug5.mp4`, 3.0s to 5.3s), that share never passed 0.80 and
// mostly sat near 0.6: at a vote threshold of 10 the pass finds forty-odd
// circles of which a dozen are somewhere else on the next frame. So every gate
// ran to its ceiling and the window sat three seconds over a full board. The
// count wanders a few either way for the same reason, which is why "stopped
// climbing" allows `countNoise` (a refill landing climbs by several a read).
// What a count cannot see is a clear in progress -- forty popping tsums are
// forty circles for a while yet -- so the refill gate does not look before
// `fillMinMs`, long enough for a clear of any size to have taken tsums off the
// count, and a board that never reads full is taken at the ceiling
// (`fillWaitMs`) rather than by a "landed short" test the count cannot make.
// The floor (`openMinMs`) covers the activation animation, because a board that
// was full when the button went is still forty circles under the dim.
//
// ## The HUD is inside the play square
//
// The fever bonus and the combo counter are drawn across the top of the play
// square, over the pile's top row, and their glyphs -- the 0, 8, 9 and 2 of
// "48,202" -- are tsum-sized circles to the Hough pass. Ordinary play never
// meets them: they land in a small colour cluster the `uniqueTsumCount - 1` cut
// drops. This skill keeps every cluster (`extraClusterSlots`), so they were in
// its board, along the top. Replayed offline on the boards of
// `gaston_debug5.mp4`, both routes began on the fever bonus digits and hopped
// through the combo counter; on the device those drags linked one tsum, then
// five. `gastonFreeBoard` cuts everything with its centre in the top `hudBand`
// of the square. That costs a real tsum or two on a pile stacked into the band
// (`corpus/GamePlaying/last_seconds1.png` has three there); every fever capture
// in the corpus has two to four glyph circles in the band.
//
// ## The last chain is held past the close, then the button is spammed
//
// Gastons cleared while the skill is running do not fill the gauge; the ones
// cleared after it has run out do, and they fill it *as they pop* -- a thirty
// chain's clear is three seconds long (`debug/gaston_debug2.mp4`, 44.3s to
// 47.3s) and the gauge climbs through the whole of it. A chain released
// before the close charges nothing, even the part of its clear that pops
// after it. So the window's last chain is drawn and **held**: the finger
// stays on its last tsum until `holdPastCloseMs` past the close and only
// then comes up (`gastonLinkChain`). The game keeps a chain linked for as
// long as the finger is still, and nothing drops while it is held, so the
// hold costs the wait and nothing else. The close is the estimate
// `durationMs` makes: late costs a short hold, early releases inside the
// window and throws the charge away, which is why the anchor below is the
// late one. Which chain is held: the one after `passesBeforeHold` cancelled
// passes, or any chain whose drag ends inside `noCancelTailMs` of the close,
// since a cancel there refills a board the window will not chain again. A
// window that finds nothing to chain by `fillWaitMs` past the close hands
// the board back as it stands -- nothing later is Gaston, and a route over a
// mixed board links one tsum (the "1" chains after the fever in
// `gaston_debug5.mp4`).
//
// From the release the skill button is tapped over and over
// (`gastonSpamSkill`): a tap on a filling gauge is a no-op the game ignores,
// the tap that lands first after it fills is the one that fires, and the
// tsums still popping spill their count into the fresh gauge -- the overload
// `Tsum.link` is built around. The first read of the button that says full
// is the next activation, and **the next window opens from here**
// (`afterActivate` runs `gastonWindow` after `gastonWindow`): one more tap in
// case the read was the gauge full under the next tap rather than the flash
// of this loop's own, and the window is anchored at the read. Handing back to
// `useSkill` for that tap was tried and lost two windows of `gaston_6.mp4`:
// once the button has fired, the empty gauge behind its flash reads empty a
// few reads later, `useSkill` saw no activation to make, and the play loop
// chained a Gaston board for eleven seconds -- and, the moment the overflow
// filled the gauge, fired a second activation four seconds into the first's
// window, which threw the rest of it away. `stillRunning` is the guard for
// whatever else hands the play loop a full gauge inside a window: no tap
// before the window can have closed. A held chain under `chargeMinChain`
// fills nothing worth waiting on; the board goes straight back to the play
// loop, whose chains fill the rest.
//
// ## The fever switch freezes the game, and it lands on the held chain
//
// The game stops taking links for 0.5-0.75s when the fever backdrop switches,
// and a drag under way at that moment loses its head: the finger is ten hops
// on when links resume, out of reach. `gaston_6.mp4` had the exit land inside
// four of eight held drags, which registered 13, 9, 14 and 24 of 32, 22, 24
// and 30 planned; two of those windows then never filled the gauge. It is
// structural: every activation's clear filled the fever gauge, so the
// backdrop came on 1.3s after the tap as the face faded (`faceMs`), stayed
// exactly 8.35s (`feverMs`, nine of nine) and went off at tap + 9.65s -- when
// the third pass's drag is out. The exit is therefore predicted from the
// backdrop coming on and a drag that would straddle it waits for the switch
// and the freeze behind it (`gastonAwaitSwitch`); a switch seen within
// `switchFreezeMs` of any drag holds it the rest. The backdrop is read as the
// chrome beside the score not being its plain-board colour (`plainChrome`),
// because each fever theme paints its own -- `FeverProbes` expects one
// theme's dimmed teal and reads no fever at all on the antlered theme of that
// recording. A fever that enters mid-window off a cancelled pass is not
// predicted, only seen when it switches; none did there.
//
// Two smaller things the window has to get right:
//
//   - **the drag must not cross a bubble, and the bubbles are the window's.**
//     One crossed mid-travel pops and ends the chain there, and this chain
//     crosses the board. Tsums sitting on a bubble are held out of the plan,
//     and the bubble is then spent deliberately: tapped the moment the drag
//     releases, which cuts the pop animation short so the next batch of
//     Gastons drops at once. Which bubble: the one whose blast holds the most
//     leftovers (`gastonBubbleWorth`), since a pop there clears ground the
//     chain could not take and refills it with Gaston, where a pop over
//     Gastons clears what the next chain would have. Every bubble on the
//     board goes -- each activation leaves one, so the next window always has
//     its cancel with nothing held back. That is why bubbles are the skill's
//     rather than the Bubble Strategy's from the first activation on
//     (`claimsBubbles`): a pop between windows cuts a clear that is filling
//     the gauge, and the refill it brings is mixed. Before the first
//     activation the strategy plays them as set. The bubbles are read off a
//     capture that runs below the play square (`gastonBubbles`, `bubbleHem`):
//     the square cuts the bottom row of them in half, and a third of one
//     window's passes went uncancelled with four in plain sight. The hem also
//     brings in the two round HUD buttons under the bowl, which the pass read
//     as bubbles on every board of `gaston_2.mp4` and the cancels tapped
//     instead of the bubble in play; `hemButtons` names them and they are
//     dropped.
//   - **each sample outlasts a dropped frame.** Android hands the game one
//     MOVE per frame, the latest one, so a tsum's centre is seen only while
//     it is still the latest event at a frame boundary: `dwellMs` outlasts
//     two frames, because the game drops one in five under fever
//     (`gaston_3.mp4`, 2026-09-21: at one frame and 1.3ms, 279 of 456 planned
//     tsums registered). The freeze at the fever switch (above) was first
//     read as the game's UI thread blocking with the moves piling up behind
//     it (`gaston_4.mp4`: 33 planned registered 11, the drawn line frozen for
//     1.1s), and the host was given a paced MOVE for it -- `moveTo` with
//     `wait` returns once the game has taken the move (`pacedMoves`). Measured
//     in `gaston_6.mp4` it costs ~2ms a hop, the acks come back at once, and
//     the chains died at the switch all the same: the game takes the moves
//     and links none of them while it switches, so the freeze is the game's
//     own and the drag has to stay out of it. The pacing stays on -- it costs
//     nothing -- and the pass record's `overMs` is what it cost beyond the
//     dwells.
//
//     A closed loop in the script was tried too (`gaston_5.mp4`): each hop
//     confirmed off the coin the game draws on a linked tsum, a miss held by
//     sending the finger back. It lost more than it saved, for two reasons
//     worth keeping. The scan's centres sit ~14px off the game's sprites on
//     median (up to 30; Hough on a packed pile, and the pile keeps sliding
//     after a pop), so a read at the planned centre missed real coins on a
//     tsum in three. And the game takes the finger returning to the previous
//     tsum as *undoing* the last link, so every false miss cut the head off
//     and the rest of the route with it.
//
// ## The head is checked once, off the whole board
//
// Not a closed loop: one read, two tsums in, of something the game draws
// everywhere at once. With a Gaston under the finger every other Gaston is
// painted pale, translucent over a light layer; with a leftover under it the
// board stays as it was. That is position-proof -- eight of his tsums far from
// the head, read as a grid each, the median of medians -- and theme-proof when
// read as a *rise*, the same tsums before the grab and at the hop: the fever
// backdrop tints the pale to salmon and it still rises ~20 where a wrong head
// moves it 0 (`aliveRise`, `gastonFloorRead`). The link line itself was tried
// first and sits off the scan's midpoints too often to read. A dead head is
// lifted at the second tsum, ~110ms in, and the pass replans without it
// (`deadRetries`), so a wrong start costs a quarter second instead of the
// drag, the bubble and the refill floor. The one thing it cannot read through
// is the game's own blink: from ~1.7s before the window closes every Gaston
// pulses pale three times and then stays so until the close, finger or no
// finger, which is why the held pass and anything near the close go unchecked
// (`aliveBlackoutMs`).
//
// Two things that recording measured and nothing here uses yet:
//
//   - the blink above is the game's own clock. It began at tap+9.0-9.7s and
//     went solid at ~9.7-10.4s in every window, where `closesAt` estimated
//     tap+10.7-11.2: the held chain went out 1-3s after the real close and
//     `heldMs` was 0 on every window. Safe, but window time.
//   - `gastonAwaitSwitch` held seven of eighteen drags 1.2-3.1s, because the
//     fever's start is stamped `faceMs` after the tap whenever the chrome reads
//     dimmed at the open, and one window's fever came on 4.3s after its tap.
// ---------------------------------------------------------------------------

// --- Tuning data -----------------------------------------------------------

// `var`, like every other skill's table: a `const` here is lexical, so it is not
// a property of the global object and the offline harness cannot reach it.
var GastonConfig = {
  // How long the drops stay Gaston **after the activation animation ends**, by
  // skill level 1-6, in ms.
  //
  // Level 6's 6s is the number the skill is played on; the rest are a straight
  // ladder to it and are NOT MEASURED. Nor is the anchor: the game may well
  // start the window at the tap, in which case this over-runs by the length of
  // the animation. That is the safe direction to be wrong in -- an over-run
  // holds the last chain a little longer than it had to, where an under-run
  // releases it inside the window and its clear charges nothing.
  durationMs: [4000, 4400, 4800, 5200, 5600, 6000],

  // --- the board gates -----------------------------------------------------
  //
  // The tsum count off one capture and one Hough pass (~10ms), polled -- not
  // `settleBoard`, whose grid a score popup or a coin shower keeps moving over
  // a board that has landed, and not circle positions, which the pass does not
  // hold still enough to match (see the header).
  pollMs: 80,
  // Full: the count at or over `enoughTsums`, and not up by more than
  // `countNoise` on `stillReads` reads running. A full board measures around
  // 43 and wanders a few either way read to read, where a refill landing
  // climbs by several a read; a dozen dim tsums is what the animation leaves
  // visible. 36 rather than 40 because the window carries bubbles, each sitting
  // where a tsum or two would, and because the count carries the two to four
  // HUD glyphs `gastonFreeBoard` cuts.
  enoughTsums: 36,
  countNoise: 2,
  stillReads: 2,
  // The opening gate's floor and ceiling. It waits out the activation animation
  // and the first fill together: the animation measured 3.4s in
  // `gaston_correct.mp4` and ~3.2s in `gaston_wrong.mp4`, 3.3s in
  // `gaston_debug5.mp4`, and the board was full 0.4s behind it there. The floor
  // is the animation, which the count cannot see through when the board was
  // already full at the tap (see the header); the gate then leaves on a full
  // board or on the ceiling. 3500 sits just over the animation: a drag begun
  // under its last frames is a drag the game may not take.
  openMinMs: 3500,
  openWaitMs: 6500,
  // The refill gates between passes. A cancelled clear is off the board at
  // once and the board is back and full at ~1.1s (`gaston_debug5.mp4`, 5.9s to
  // 7.0s), so its floor is `fillMinMs`. A clear left to pop -- no bubble to
  // cancel it with -- takes its tsums off one at a time at about
  // `popPerTsumMs` each (a thirty chain is three seconds, `gaston_debug2.mp4`),
  // and the count cannot tell that from a full board for the first second, so
  // its floor is the pop's own length plus `popTailMs` for the drop behind it.
  // `fillWaitMs` is the ceiling past the floor, for a board that never reads
  // full -- one crowded with bubbles -- which is chained as it stands then.
  fillMinMs: 1000,
  fillWaitMs: 1500,
  popPerTsumMs: 90,
  popTailMs: 400,
  // A full count is not a landed board: the last tsums of a refill are circles
  // while they fall, and `gaston_debug6.mp4` had two boards scanned with a band
  // still in the air -- 39 read, a route of 8. Every gate that leaves on full
  // sits this long first.
  landMs: 250,
  // A pass that found no chain waits this long before looking again.
  rescanIdleMs: 120,

  // --- the chain -----------------------------------------------------------
  //
  minChain: 3,
  // Steps the longest-path search may spend over one component
  // (`findLongestTsumPath`). Replayed over 725 device boards, 10,000 planned
  // 12 tsums more than 3,000 in all and 30,000 one more than that; the bench
  // prices 3,000 pruned steps at ~12ms on the device.
  searchSteps: 3000,
  // An end of the route within this of a leftover, in tsum widths centre to
  // centre, is the frontier and the drag starts from the other end (see
  // `gastonOrient`). Adjacent tsums sit one width apart, so this is
  // "touching".
  frontierAvoid: 1.2,

  // --- the head check ------------------------------------------------------
  //
  // With a Gaston under the finger the game paints every other Gaston pale;
  // with a leftover under it the board stays as it was. Read as the rise in
  // each sampled tsum's floor -- its darkest channel, the median over a
  // (2*aliveGrid+1)^2 grid at `aliveStep` around its centre -- from a read
  // just before the grab to one with the finger on tsum `aliveAtHop`, the
  // median over `aliveSamples` Gastons furthest from the head. Measured off
  // `gaston_7.mp4`: live drags rose 18-24 under the fever tint and 36-56 on a
  // plain board, the five wrong heads -2 to 0, and the reads were stable
  // from the first hop. Under `aliveRise` the head is dead: the finger comes
  // up and the pass replans without that start, `deadRetries` times. Only a
  // pass that will be cancelled is checked, and none inside `aliveBlackoutMs`
  // of the close: the game blinks the Gastons pale itself as the window ends,
  // from ~1.7s before it, which reads either way.
  aliveAtHop: 2,
  aliveSamples: 8,
  aliveMinSamples: 4,
  aliveGrid: 3,
  aliveStep: 2,
  aliveRise: 10,
  aliveBlackoutMs: 3000,
  deadRetries: 1,
  // The two round HUD buttons under the bowl -- the skill button and the one
  // across from it -- in play-square coordinates. The hem brings them into the
  // bubble capture, and a circle within `hemButtonAvoid` tsum widths of one is
  // a button, not a bubble. Off the pass logs: x 27-34 and 167-173, y 212-216,
  // every pass.
  hemButtons: [{ x: 30, y: 214 }, { x: 170, y: 214 }],
  hemButtonAvoid: 1.0,
  // How far a planned tsum must stay from a bubble, in tsum widths. A bubble is
  // about 1.4 tsums across, so this is "not touching".
  bubbleAvoid: 1.0,
  // How far below the play square the bubble capture runs, as a share of its
  // height. The bowl is deeper at the middle than the square is tall, and a
  // bubble resting there has its lower third cut off the square: four sat so
  // in `gaston_debug6.mp4` and the pass over the square found none of them.
  bubbleHem: 0.1,
  // The band across the top of the play square the HUD draws into, in tsum
  // widths; a circle with its centre in it is a glyph, not a tsum (see the
  // header). The fever bonus digits centre at 0.7-1.0 and the combo counter's
  // at up to ~1.15 (`gaston_debug5.mp4`); a full pile's top row centres at
  // 1.25-2.0.
  hudBand: 1.25,

  // --- the drag ------------------------------------------------------------
  //
  // `linkTsums`' 10/10/10 is measured against ordinary chains and left alone;
  // this drag is an order of magnitude longer and `dwellMs` is what it is for:
  // a tsum's centre must still be the latest MOVE at some frame boundary, and
  // the game drops one frame in five under fever (`gaston_3.mp4`), so the
  // dwell outlasts two frames (33.3ms) with margin. 18 -- one frame and 1.3ms
  // -- lost a third of every chain; see the header. A thirty-chain is 1.4s.
  //
  // No step between tsums (`stepsPerHop` 0), unlike Rapunzel+'s two: the game
  // links by where the finger *is*, not the path it took, so a hop inside its
  // reach needs no crossing -- and a midpoint sample that lands on a neighbour
  // links it out of order, which leaves planned tsums unlinked behind a
  // healthy head (`gaston_4.mp4`, three chains over their plan by 1-5 that
  // way). With `pacedMoves` each `moveTo` also waits for the game to take the
  // move (see the header): ~2ms a hop measured, and no help at the fever
  // switch; off, the moves are queued as every other drag's are.
  grabMs: 30,
  dwellMs: 40,
  stepMs: 5,
  stepsPerHop: 0,
  releaseMs: 20,
  pacedMoves: true,

  // --- the cancel, and the hold --------------------------------------------
  //
  // Chains drawn and cancelled before the held one. Each is a chain of
  // thirty and its cancel, and each earns a bubble; two fit a level-6 window
  // with the third drag ending about at the close. A pass with no bubble to
  // cancel with still counts as one.
  passesBeforeHold: 2,
  // Tapped the moment the drag releases: the pop animation is what it cuts
  // short, so a late tap spends a bubble on nothing.
  cancelTapMs: 10,
  // Bubbles left standing for the next window. None: every activation leaves
  // a bubble, so the next window has its cancel whatever this one spends, and
  // a bubble spent here refills as Gaston where one kept sits where the chain
  // would go.
  bubbleReserve: 0,
  // A chain whose drag ends within this of the close is held rather than
  // cancelled, whatever pass it is: a cancel there refills a board the window
  // has no time to chain again, and a release there charges nothing.
  noCancelTailMs: 800,
  // How long past the close the held chain's finger stays down before the
  // release. The close is an estimate (see `durationMs`), and a release inside
  // the window is the whole charge lost, so this errs late.
  holdPastCloseMs: 300,
  // The hold sleeps in slices this long, so a stopped run lifts the finger
  // within one.
  holdSliceMs: 50,

  // --- charging the gauge after the release --------------------------------
  //
  // How long the button is spammed for after the release: a thirty chain pops
  // for three seconds and the gauge reads full a little after the last of it
  // -- a 34 watched for 3.5s was read full by the play loop 1.8s later. Past
  // this the play loop has the board back and its own chains fill the rest,
  // which is also the whole plan for a held chain under `chargeMinChain`: that
  // one is not going to fill anything, and the play loop's longest chain on
  // the Gastons it left is worth more than the wait.
  gaugeWaitMs: 4500,
  chargeMinChain: 12,
  // The spam tap's `during`. The host holds every tap 40ms on its own, so with
  // the gauge read between taps the loop runs at about one tap a frame pair.
  spamTapMs: 10,
  // How often the spam loop checks the board is still there: the round can end
  // under it, and the taps would go on into the tally.
  spamPageCheckMs: 500,

  // --- the fever switch ----------------------------------------------------
  //
  // The game stops linking for a moment when the fever backdrop switches, and
  // a drag under way loses its head there (see the header). The exit is
  // predictable: the backdrop stays up `feverMs` from the moment it comes on
  // -- nine of nine fevers in `gaston_6.mp4`, to the frame -- and it comes on
  // `faceMs` after the activation tap, as the face animation fades, when the
  // activation's clear has filled the fever gauge (every activation there). A
  // drag that would straddle the predicted exit waits for the switch to show
  // and `switchFreezeMs` more, the freeze measured 0.5-0.75s past the switch;
  // `switchLeadMs` is how far ahead of the switch the freeze can begin.
  feverMs: 8350,
  faceMs: 1300,
  switchFreezeMs: 800,
  switchLeadMs: 250,
  // How long past the predicted exit to keep waiting for it. The fever clock
  // pauses under a skill animation, so a fever already running at the tap
  // outlives the estimate by the animation; past this the drag goes out anyway.
  switchLateMs: 1500,
  // The chrome either side of the score capsule on a plain board (`normal.png`
  // and `last_seconds*.png`, the same points as `FeverProbes`' dimmed pair).
  // The fever backdrop recolours it and a skill animation darkens it, so the
  // backdrop is read as "not plain": each fever theme paints its own colour
  // there, and `FeverProbes` -- one theme's dimmed teal -- reads nothing on
  // the antlered theme of `gaston_6.mp4`.
  plainChrome: [
    { x: 300, y: 250, r: 24, g: 207, b: 239 },
    { x: 800, y: 250, r: 16, g: 190, b: 231 },
  ],
  plainChromeTolerance: 90,

  // A pass whose scan reads this far under a board the gate just saw full is
  // under a flash -- the fever label's, `gaston_6.mp4` read 29 of 40 -- and
  // rescans for up to this long.
  flashRetryMs: 600,
};

// The `roundStartedAt` of the round whose first activation has gone out, or 0.
// Bubbles are the window's from that activation to the round's end and the
// Bubble Strategy's before it -- see `claimsBubbles`. A round's start stamp is
// unique and the play loop clears it at the tally, so nothing here resets.
var gastonClaimRound = 0;

// The window now open -- its round and the earliest it can close -- for
// `stillRunning`: a full gauge inside it waits (see the header).
var gastonWindowRound = 0;
var gastonWindowUntil = 0;

// The fever backdrop as the window last saw it (`gastonWatchFever`): whether
// the chrome read plain (-1 before the first look), when the backdrop came on
// (0 while off) for the exit prediction, and the last change either way for
// the freeze. Nothing resets between rounds: a stale `onAt` predicts an exit
// long past, which waits for nothing.
var gastonFever = { plain: -1, onAt: 0, switchedAt: 0 };

/** What one pass of the window came to. */
interface GastonPass {
  /** Tsums in the chain drawn, 0 when none was. */
  chain: number;
  /** Bubbles tapped to cancel the pop animation. */
  cancelled: number;
  /** The chain was held on its last tsum until the window had closed, then left to pop -- the closing chain. */
  held: boolean;
  /** How long the finger stayed on the last tsum past the drag, in ms. */
  heldMs: number;
  /** Epoch ms of the release, 0 when nothing was drawn. */
  releasedAt: number;
  /** Tsums the scan put in the board array, HUD glyphs included. */
  read: number;
  /** Tsums in the board's biggest colour cluster -- how far short of `read` the scan reads Gaston. */
  biggest: number;
  /** Time the drag spent waiting on the game beyond its dwells. See `GastonDrag`. */
  overMs: number;
  /** Drags the head check lifted for a dead head, replanned or not. */
  dead: number;
  /** The board was there to be scanned; false is a round that ended under the window. */
  onBoard: boolean;
}

/** What a wait for the board came to. */
interface GastonWait {
  /** The fullest the board was seen. */
  peak: number;
  /** It left on a full count, not the ceiling. */
  full: boolean;
}

/** What the charge after the held chain came to. */
interface GastonCharge {
  /** Taps sent to the button. */
  taps: number;
  /** The gauge read full -- the next activation fired, or is about to on the next tap. */
  ready: boolean;
  /** The board was still there; false is a round that ended under the charge. */
  onBoard: boolean;
}

/**
 * Whether a round-over screen has replaced the board -- the play loop's own
 * sweep, so the pause menu or an animation over the HUD does not count.
 */
function gastonRoundOver(): boolean {
  return isRoundOverPage(gPages.detect(1, 0, inRoundPages()));
}

// --- The fever switch --------------------------------------------------------

/**
 * Whether the chrome beside the score reads plain: no fever backdrop and no
 * animation over it. One crop of the row through both probes (`plainChrome`).
 */
function gastonChromePlain(ts: Tsum): boolean {
  const cfg = GastonConfig;
  const a = ts.toRealXY(cfg.plainChrome[0].x, cfg.plainChrome[0].y);
  const b = ts.toRealXY(cfg.plainChrome[1].x, cfg.plainChrome[1].y);
  const x = Math.max(0, Math.min(a.x, b.x));
  const y = Math.max(0, Math.min(a.y, b.y) - 1);
  const img = getScreenshotModify(x, y, Math.abs(b.x - a.x) + 1, Math.abs(b.y - a.y) + 3, 0, 0, 100);
  try {
    return absColor(getImageColor(img, a.x - x, a.y - y), cfg.plainChrome[0]) < cfg.plainChromeTolerance
      && absColor(getImageColor(img, b.x - x, b.y - y), cfg.plainChrome[1]) < cfg.plainChromeTolerance;
  } finally {
    releaseImage(img);
  }
}

/**
 * One look at the backdrop, recording the switch if it changed. Called from
 * every poll of the window, so a switch is seen within a poll of the frame.
 */
function gastonWatchFever(ts: Tsum): void {
  const plain = gastonChromePlain(ts) ? 1 : 0;
  if (plain === gastonFever.plain) { return; }
  if (gastonFever.plain !== -1) {
    const now = Date.now();
    gastonFever.switchedAt = now;
    gastonFever.onAt = plain ? 0 : now;
  }
  gastonFever.plain = plain;
}

/**
 * Hold a drag of `dragMs` back from the fever switch: the freeze after one
 * just seen, and the exit the running fever's clock puts inside the drag (see
 * `feverMs`). Answers the ms spent waiting.
 */
function gastonAwaitSwitch(ts: Tsum, dragMs: number): number {
  const cfg = GastonConfig;
  const from = Date.now();
  if (gastonFever.onAt > 0) {
    const exitIn = gastonFever.onAt + cfg.feverMs - from;
    if (exitIn > -cfg.switchFreezeMs && exitIn < dragMs + cfg.switchLeadMs) {
      const until = from + exitIn + cfg.switchLateMs;
      while (ts.isRunning && gastonFever.onAt > 0 && Date.now() < until) {
        ts.sleep(cfg.pollMs);
        gastonWatchFever(ts);
      }
    }
  }
  const rest = gastonFever.switchedAt + cfg.switchFreezeMs - Date.now();
  if (gastonFever.switchedAt > 0 && rest > 0) { ts.sleep(rest); }
  return Date.now() - from;
}

/** About how long a drag over `chain` tsums takes, for the switch wait. */
function gastonDragEstimate(chain: number): number {
  const cfg = GastonConfig;
  return cfg.grabMs + cfg.releaseMs + chain * (cfg.dwellMs + 5);
}

// --- Reading the board ------------------------------------------------------

/**
 * How many tsum circles the board shows: one capture and `findTsums`' circle
 * pass, counted and nothing else.
 */
function gastonCountTsums(ts: Tsum): number {
  const img = ts.playScreenshotSquare();
  let gray: NativeImage | null = null;
  try {
    gray = buildBoardGray(img);
    return findTsumCount(gray);
  } finally {
    if (gray != null) { releaseImage(gray); }
    releaseImage(img);
  }
}

/**
 * Wait until the board reads full, and say how full it got.
 *
 * Leaves once the count is at `enoughTsums` and has stopped climbing --
 * `stillReads` reads running not up by more than `countNoise`, the last of a
 * refill landing being the count still on its way up -- or on `until`. Never
 * short of full: the count cannot tell a board landed short from one mid-clear
 * (see the header), so a board that never reads full is taken at the ceiling.
 *
 * Nothing ends the wait before `notBefore`: the opening gate's floor under the
 * activation animation, the refill gates' `fillMinMs` while a clear takes its
 * tsums off the count.
 */
function gastonAwaitBoard(ts: Tsum, until: number, notBefore: number): GastonWait {
  const cfg = GastonConfig;
  let count = gastonCountTsums(ts);
  let peak = count;
  let held = 0;
  let full = false;
  while (ts.isRunning && Date.now() < until) {
    if (Date.now() >= notBefore && count >= cfg.enoughTsums && held >= cfg.stillReads) {
      full = true;
      break;
    }
    ts.sleep(cfg.pollMs);
    const now = gastonCountTsums(ts);
    held = now > count + cfg.countNoise ? 0 : held + 1;
    count = now;
    if (count > peak) { peak = count; }
    gastonWatchFever(ts);
  }
  // Full is not landed: the last of the refill is still falling. See `landMs`.
  if (full) { ts.sleep(cfg.landMs); }
  return { peak: peak, full: full };
}

/**
 * Spam the skill button from the held chain's release until the gauge reads
 * full: its Gastons fill the gauge as they pop, a tap on a filling gauge is a
 * no-op the game ignores, and the tap that lands first after it fills is the
 * one that fires. The read that says full is either the gauge full under the
 * next tap or this loop's own tap having just fired it -- the button flashes
 * as it goes, and the empty gauge behind the flash reads empty a moment later
 * -- so the window that follows is opened from here, not by `useSkill` (see
 * the header). Stops once `until` passes with the gauge still filling, or the
 * round ends under it.
 */
function gastonSpamSkill(ts: Tsum, until: number): GastonCharge {
  const cfg = GastonConfig;
  const charge: GastonCharge = { taps: 0, ready: false, onBoard: true };
  let checkedAt = Date.now();
  while (ts.isRunning && Date.now() < until) {
    if (Date.now() - checkedAt >= cfg.spamPageCheckMs) {
      checkedAt = Date.now();
      if (gastonRoundOver()) { charge.onBoard = false; return charge; }
    }
    ts.tap(Button.gameSkill1, cfg.spamTapMs);
    charge.taps++;
    if (ts.checkSkillReadinessFast() === SkillReadiness.Active) { charge.ready = true; return charge; }
    gastonWatchFever(ts);
  }
  return charge;
}

/**
 * The Gastons on the board: the points of its biggest colour cluster, and
 * nothing else -- see the header for the palette that used to add to it.
 */
function gastonGastons(ts: Tsum, board: BoardPoint[]): BoardPoint[] {
  const sizes: number[] = [];
  for (let c = 0; c < ts.boardClusters.length; c++) { sizes.push(0); }
  for (let i = 0; i < board.length; i++) {
    const c = +board[i].tsumIdx;
    if (c >= 0 && c < sizes.length) { sizes[c]++; }
  }
  let biggest = -1;
  for (let c = 0; c < sizes.length; c++) {
    if (sizes[c] > 0 && (biggest < 0 || sizes[c] > sizes[biggest])) { biggest = c; }
  }
  const out: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    if (+board[i].tsumIdx === biggest) { out.push(board[i]); }
  }
  return out;
}

/**
 * The bubbles on the board, off a capture that runs `bubbleHem` below the play
 * square -- see `bubbleHem` for the ones the square cuts in half. The same
 * Hough pass as `findGameBubbles`, in play-square scale; a centre below the
 * square has y past `playResizeHeight`, which the taps map like any other.
 */
function gastonBubbles(ts: Tsum): GameBubble[] {
  const hem = GastonConfig.bubbleHem;
  const h = Math.min(Math.round(ts.playHeight * (1 + hem)), ts.screenHeight - ts.playOffsetY);
  const outH = Math.round(ts.playResizeHeight * h / ts.playHeight);
  const img = getScreenshotModify(ts.playOffsetX, ts.playOffsetY, ts.playWidth, h,
    ts.playResizeWidth, outH, 100);
  let gray: NativeImage | null = null;
  try {
    gray = buildBoardGray(img);
    return gastonNotButtons(findGameBubbles(gray));
  } finally {
    if (gray != null) { releaseImage(gray); }
    releaseImage(img);
  }
}

/**
 * The bubbles less the two round HUD buttons the hem brings into the capture
 * (`hemButtons`): every pass of `gaston_2.mp4` read them as bubbles, and the
 * cancels went to them instead of the bubble in play.
 */
function gastonNotButtons(bubbles: GameBubble[]): GameBubble[] {
  const cfg = GastonConfig;
  const avoid = Config.tsumWidth * cfg.hemButtonAvoid;
  const avoidSq = avoid * avoid;
  const out: GameBubble[] = [];
  for (let b = 0; b < bubbles.length; b++) {
    let button = false;
    for (let k = 0; k < cfg.hemButtons.length; k++) {
      const dx = bubbles[b].x - cfg.hemButtons[k].x;
      const dy = bubbles[b].y - cfg.hemButtons[k].y;
      if (dx * dx + dy * dy < avoidSq) { button = true; break; }
    }
    if (!button) { out.push(bubbles[b]); }
  }
  return out;
}

/**
 * What each bubble's pop is worth to the window, written to its `near`: the
 * tsums in its blast that are not Gaston. The blast is the bubble's radius
 * plus `GameBubbleConfig.blastReach` tsum widths, as `findGameBubbles` counts
 * it; board points are top-left corners, so the half width goes back on. The
 * HUD glyphs across the top are not leftovers and are left out (`hudBand`).
 * The cancel spends the richest first -- see `gastonCancelBubble`.
 */
function gastonBubbleWorth(bubbles: GameBubble[], board: BoardPoint[], gastons: BoardPoint[]): void {
  const half = Config.tsumWidth / 2;
  const hud = Config.tsumWidth * GastonConfig.hudBand;
  const blast = GameBubbleConfig.blastReach * Config.tsumWidth;
  for (let b = 0; b < bubbles.length; b++) {
    const reach = bubbles[b].r + blast;
    const reachSq = reach * reach;
    let near = 0;
    for (let i = 0; i < board.length; i++) {
      const cy = board[i].y + half;
      if (cy < hud || gastons.indexOf(board[i]) >= 0) { continue; }
      const dx = board[i].x + half - bubbles[b].x;
      const dy = cy - bubbles[b].y;
      if (dx * dx + dy * dy <= reachSq) { near++; }
    }
    bubbles[b].near = near;
  }
}

/**
 * The board minus what the drag must not touch: every tsum sitting on a bubble,
 * since a bubble the drag crosses pops and ends the chain there, and every
 * circle with its centre in the HUD band across the top, which is the fever
 * bonus and the combo counter read as tsums -- see the header.
 *
 * Board points are top-left corners and bubbles are centres, so the half-width
 * goes back on before either test.
 */
function gastonFreeBoard(board: BoardPoint[], bubbles: GameBubble[]): BoardPoint[] {
  const half = Config.tsumWidth / 2;
  const hud = Config.tsumWidth * GastonConfig.hudBand;
  const avoid = Config.tsumWidth * GastonConfig.bubbleAvoid;
  const avoidSq = avoid * avoid;
  const out: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    const cx = board[i].x + half;
    const cy = board[i].y + half;
    if (cy < hud) { continue; }
    let clear = true;
    for (let b = 0; b < bubbles.length; b++) {
      const dx = bubbles[b].x - cx;
      const dy = bubbles[b].y - cy;
      if (dx * dx + dy * dy < avoidSq) { clear = false; break; }
    }
    if (clear) { out.push(board[i]); }
  }
  return out;
}

/**
 * The board's leftovers: every point outside the Gaston cluster, less the HUD
 * glyphs across the top (`hudBand`), which are not tsums.
 */
function gastonLeftovers(board: BoardPoint[], gastons: BoardPoint[]): BoardPoint[] {
  const hud = Config.tsumWidth * GastonConfig.hudBand - Config.tsumWidth / 2;
  const out: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i].y >= hud && gastons.indexOf(board[i]) < 0) { out.push(board[i]); }
  }
  return out;
}

/** `board` less every point within half a tsum of `avoid` -- the dead start of a replan. */
function gastonWithout(board: BoardPoint[], avoid: Point): BoardPoint[] {
  const near = Config.tsumWidth / 2;
  const nearSq = near * near;
  const out: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    const dx = board[i].x - avoid.x;
    const dy = board[i].y - avoid.y;
    if (dx * dx + dy * dy >= nearSq) { out.push(board[i]); }
  }
  return out;
}

// --- The chain --------------------------------------------------------------

/**
 * The chain to draw over `board` -- the Gastons the drag may touch: the longest
 * path `findLongestTsumPath` finds in any of its connected components, from
 * whichever tsum it starts at. See the header for why nothing anchors it.
 *
 * Components biggest first, each searched over its own points so the search's
 * memo applies (it keys on 31 tsums or fewer), and a route through the whole
 * of one ends the search: no smaller component can beat it.
 */
function gastonChain(board: BoardPoint[]): TsumPath | null {
  const cfg = GastonConfig;
  if (board.length < cfg.minChain) { return null; }
  const reachSq = Config.tsumWidth * Config.linkReach * Config.tsumWidth * Config.linkReach;
  const comps = findTsumComponents(buildTsumNeighbors(board, reachSq));
  comps.sort(function(a, b) { return b.length - a.length; });
  let best: TsumPath = [] as TsumPath;
  for (let c = 0; c < comps.length; c++) {
    const comp = comps[c];
    if (comp.length <= best.length || comp.length < cfg.minChain) { break; }
    const points: BoardPoint[] = [];
    const all: number[] = [];
    for (let i = 0; i < comp.length; i++) { points.push(board[comp[i]]); all.push(i); }
    const route = findLongestTsumPath(buildTsumNeighbors(points, reachSq), all, cfg.searchSteps).path;
    if (route.length > best.length) {
      best = [] as TsumPath;
      for (let i = 0; i < route.length; i++) { best.push(points[route[i]]); }
    }
  }
  return best.length >= cfg.minChain ? best : null;
}

/**
 * Which end the drag starts from. A path links the same tsums drawn either
 * way, and a longest path runs tip to tip; on a refilled board the tips are
 * the bottom frontier, where the Gaston mass meets what it landed on and the
 * scan is least to be trusted -- a leftover of his colour merged into his
 * cluster, a centre landed on the neighbour. Five of the seven dead drags of
 * `gaston_7.mp4` began on one, four of them at the bottom end with a Gaston at
 * the top end. So the start is the higher end, and an end touching a known
 * leftover (`frontierAvoid`) loses whatever its height. The opposite of
 * Rapunzel+'s rule, whose board is still landing at the top; this one has
 * landed (`landMs`) and the trouble is at the bottom.
 */
function gastonOrient(path: TsumPath | null, leftovers: BoardPoint[]): TsumPath | null {
  if (!path || path.length < 2) { return path; }
  if (gastonEndRisk(path[path.length - 1], leftovers) < gastonEndRisk(path[0], leftovers)) {
    path.reverse();
  }
  return path;
}

/** An end's risk as a start: its y, plus the board's height if it touches a leftover. */
function gastonEndRisk(end: BoardPoint, leftovers: BoardPoint[]): number {
  const avoid = Config.tsumWidth * GastonConfig.frontierAvoid;
  const avoidSq = avoid * avoid;
  for (let i = 0; i < leftovers.length; i++) {
    const dx = leftovers[i].x - end.x;
    const dy = leftovers[i].y - end.y;
    if (dx * dx + dy * dy < avoidSq) { return end.y + Config.screenResize; }
  }
  return end.y;
}

/** Tsums in the board's biggest colour cluster, for the log. */
function gastonBiggestCluster(board: BoardPoint[]): number {
  const sizes: { [tsumIdx: string]: number } = {};
  let biggest = 0;
  for (let i = 0; i < board.length; i++) {
    const n = (sizes[board[i].tsumIdx] || 0) + 1;
    sizes[board[i].tsumIdx] = n;
    if (n > biggest) { biggest = n; }
  }
  return biggest;
}

// --- Drawing it -------------------------------------------------------------

/** A board point as the screen coordinate the touch natives want. */
function gastonToScreen(ts: Tsum, p: BoardPoint): Point {
  return {
    x: Math.floor(ts.playOffsetX
      + (p.x + Config.tsumWidth / 2) * ts.playWidth / ts.playResizeWidth),
    y: Math.floor(ts.playOffsetY
      + (p.y + Config.tsumWidth / 2) * ts.playHeight / ts.playResizeHeight),
  };
}

/** What a drag came to: its length, how much of that was the game's, and whether it was held. */
interface GastonDrag {
  /** Grab to release less the hold, in ms. */
  ms: number;
  /**
   * Over the dwells and settles: the time `moveTo` spent waiting for the game
   * to take each move -- ~2ms a hop measured, the acks come straight back
   * (see the header).
   */
  overMs: number;
  /** The finger stayed on the last tsum until the window had closed. */
  held: boolean;
  /** How long it stayed there past the drag, in ms; 0 when released at once. */
  heldMs: number;
  /** Epoch ms of the release, 0 when nothing was drawn. */
  releasedAt: number;
  /** The head check lifted the finger: nothing under it was linking. */
  dead: boolean;
  /** Tsums the finger had visited when it was lifted, 0 when it was not. */
  deadAt: number;
  /** What the head check read (see `aliveRise`), null when it did not run. */
  rise: number | null;
}

/** The lower median of `values`. */
function gastonMedian(values: number[]): number {
  const sorted = values.slice().sort(function(a, b) { return a - b; });
  return sorted[(sorted.length - 1) >> 1];
}

/**
 * Each tsum's floor: the median, over a grid around its centre, of the pixel's
 * darkest channel, off one capture of the play square. The pale paint the game
 * puts on a live chain's Gastons lifts it by ~20 whatever the theme tints the
 * board, where the sprite's own colours barely move it -- see `aliveRise`.
 */
function gastonFloorRead(ts: Tsum, centres: Point[]): number[] {
  const cfg = GastonConfig;
  const pts: Point[] = [];
  for (let c = 0; c < centres.length; c++) {
    for (let i = -cfg.aliveGrid; i <= cfg.aliveGrid; i++) {
      for (let j = -cfg.aliveGrid; j <= cfg.aliveGrid; j++) {
        pts.push({
          x: Math.round(centres[c].x + i * cfg.aliveStep),
          y: Math.round(centres[c].y + j * cfg.aliveStep),
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
  const per = (2 * cfg.aliveGrid + 1) * (2 * cfg.aliveGrid + 1);
  const out: number[] = [];
  for (let c = 0; c < centres.length; c++) {
    const floors: number[] = [];
    for (let k = 0; k < per; k++) {
      const col = colors[c * per + k];
      floors.push(Math.min(col.r, col.g, col.b));
    }
    out.push(gastonMedian(floors));
  }
  return out;
}

/**
 * The Gastons the head check reads: `aliveSamples` of `free` furthest from
 * where the finger will be at the check, none of them the route's first few
 * (those are linked, and drawn differently). Centres, in play-square scale.
 * Null when the board has too few to read.
 */
function gastonProbePoints(free: BoardPoint[], path: TsumPath): Point[] | null {
  const cfg = GastonConfig;
  const half = Config.tsumWidth / 2;
  const skip = Math.min(path.length, cfg.aliveAtHop + 3);
  const head = path[Math.min(cfg.aliveAtHop, path.length - 1)];
  const far: { p: BoardPoint, d: number }[] = [];
  for (let i = 0; i < free.length; i++) {
    let onRoute = false;
    for (let k = 0; k < skip; k++) {
      if (path[k] === free[i]) { onRoute = true; break; }
    }
    if (onRoute) { continue; }
    const dx = free[i].x - head.x;
    const dy = free[i].y - head.y;
    far.push({ p: free[i], d: dx * dx + dy * dy });
  }
  if (far.length < cfg.aliveMinSamples) { return null; }
  far.sort(function(a, b) { return b.d - a.d; });
  const out: Point[] = [];
  for (let i = 0; i < far.length && i < cfg.aliveSamples; i++) {
    out.push({ x: far[i].p.x + half, y: far[i].p.y + half });
  }
  return out;
}

/**
 * Draw the chain, dwelling on each tsum, each move paced to the game (see
 * `dwellMs` and `pacedMoves`), and release it -- at once when the head lands
 * before `cancelBefore`, else held on the last tsum until `holdUntil` so the
 * clear falls after the window's close (see the header). `cancelBefore` 0
 * always holds.
 *
 * With `probe` -- the Gastons to read, see `gastonProbePoints` -- the head is
 * checked at `aliveAtHop`: read before the grab and again there, and lifted at
 * once when the board has not gone pale (`aliveRise`). Two or three tsums under
 * a finger that comes up pop nothing.
 *
 * Decided at the head, not at the plan: the drag is a second and a half, and
 * it is where the release falls against the close that matters. The finger
 * comes up whatever happens to the run, since the host lifts nothing on its
 * own; a stopped run cuts the hold short and releases.
 */
function gastonLinkChain(ts: Tsum, path: TsumPath, cancelBefore: number, holdUntil: number,
    probe: Point[] | null): GastonDrag {
  const drag: GastonDrag = {
    ms: 0, overMs: 0, held: false, heldMs: 0, releasedAt: 0, dead: false, deadAt: 0, rise: null,
  };
  // A stopped run draws no new chain -- the same rule as `linkTsums`.
  if (!ts.isRunning || path.length < 2) { return drag; }
  const cfg = GastonConfig;
  const base = probe !== null && path.length > cfg.aliveAtHop ? gastonFloorRead(ts, probe) : null;
  const from = Date.now();
  const pts: Point[] = [];
  for (let i = 0; i < path.length; i++) { pts.push(gastonToScreen(ts, path[i])); }
  tapDown(pts[0].x, pts[0].y, cfg.grabMs);
  moveTo(pts[0].x, pts[0].y, cfg.dwellMs, cfg.pacedMoves);
  for (let i = 1; i < pts.length; i++) {
    for (let s = 1; s <= cfg.stepsPerHop; s++) {
      const f = s / (cfg.stepsPerHop + 1);
      moveTo(Math.floor(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f),
        Math.floor(pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f), cfg.stepMs, cfg.pacedMoves);
    }
    moveTo(pts[i].x, pts[i].y, cfg.dwellMs, cfg.pacedMoves);
    if (base !== null && probe !== null && i === cfg.aliveAtHop) {
      const now = gastonFloorRead(ts, probe);
      const rises: number[] = [];
      for (let k = 0; k < now.length; k++) { rises.push(now[k] - base[k]); }
      drag.rise = gastonMedian(rises);
      if (drag.rise < cfg.aliveRise) {
        drag.dead = true;
        drag.deadAt = i + 1;
        drag.releasedAt = Date.now();
        tapUp(pts[i].x, pts[i].y, cfg.releaseMs);
        drag.ms = Date.now() - from;
        return drag;
      }
    }
  }
  const headAt = Date.now();
  if (headAt >= cancelBefore) {
    drag.held = true;
    while (ts.isRunning && Date.now() < holdUntil) {
      ts.sleep(Math.min(cfg.holdSliceMs, holdUntil - Date.now()));
    }
    drag.heldMs = Date.now() - headAt;
  }
  const last = pts[pts.length - 1];
  drag.releasedAt = Date.now();
  tapUp(last.x, last.y, cfg.releaseMs);
  drag.ms = Date.now() - from - drag.heldMs;
  const slept = cfg.grabMs + cfg.dwellMs * pts.length
    + cfg.stepMs * cfg.stepsPerHop * (pts.length - 1) + cfg.releaseMs;
  drag.overMs = Math.max(0, drag.ms - slept);
  return drag;
}

/**
 * Cancel the pop animation: tap a bubble, and the surplus above the reserve
 * with it -- the one over the most leftovers first (`gastonBubbleWorth`),
 * then the one furthest from the chain. Answers how many went.
 *
 * Leftovers because a pop there clears what no Gaston chain can and refills
 * it as Gaston. Furthest because the chain's own tsums are already clearing
 * -- a bubble popped on top of them adds nothing, where one across the board
 * clears ground the chain did not reach. Positions come from the scan the
 * chain was planned off; bubbles are big and drift slowly, so the tap still
 * lands.
 */
function gastonCancelBubble(ts: Tsum, path: TsumPath, bubbles: GameBubble[]): number {
  if (!ts.isRunning || bubbles.length === 0) { return 0; }
  const far: { b: GameBubble, d: number }[] = [];
  for (let b = 0; b < bubbles.length; b++) {
    let nearest = Infinity;
    for (let i = 0; i < path.length; i++) {
      const dx = bubbles[b].x - (path[i].x + Config.tsumWidth / 2);
      const dy = bubbles[b].y - (path[i].y + Config.tsumWidth / 2);
      const d = dx * dx + dy * dy;
      if (d < nearest) { nearest = d; }
    }
    far.push({ b: bubbles[b], d: nearest });
  }
  far.sort(function(p, q) { return (q.b.near || 0) - (p.b.near || 0) || q.d - p.d; });
  const count = Math.max(1, bubbles.length - GastonConfig.bubbleReserve);
  for (let i = 0; i < count && i < far.length; i++) {
    const x = Math.floor(ts.playOffsetX + far[i].b.x * ts.playWidth / ts.playResizeWidth);
    const y = Math.floor(ts.playOffsetY + far[i].b.y * ts.playHeight / ts.playResizeHeight);
    tap(x, y, GastonConfig.cancelTapMs);
  }
  // The board has moved, so every other position in the list is stale too.
  ts.gameBubbles = [];
  return count;
}

// --- The window -------------------------------------------------------------

/**
 * Scan, plan the longest chain over the board, draw it, and either cancel it
 * with a bubble -- when the head lands before `cancelBefore` -- or hold it until
 * `holdUntil` and leave it to pop, which makes it the closing chain (`held`).
 * `cancelBefore` 0 always holds.
 *
 * The board is checked for first: this runs blind for ten seconds and more,
 * and a round that ends under it would otherwise have chains dragged across
 * whatever screen came next. `fullBoard` is the gate's verdict: a scan that
 * then reads well short is under a flash and is taken again (`flashRetryMs`).
 *
 * A drag begun before `probeUntil` has its head checked (`aliveAtHop`), and
 * one lifted for a dead head is planned again without that start, up to
 * `deadRetries` times; 0 checks nothing. A pass whose last drag was dead
 * answers `chain` 0, so the window looks again at once rather than waiting
 * out a refill that is not coming.
 */
function gastonPass(ts: Tsum, cancelBefore: number, holdUntil: number, fullBoard: boolean,
    probeUntil: number): GastonPass {
  const cfg = GastonConfig;
  if (gPages.detect(1, 0) !== PageName.GamePlaying) {
    return {
      chain: 0, cancelled: 0, held: false, heldMs: 0, releasedAt: 0, read: 0, biggest: 0,
      overMs: 0, dead: 0, onBoard: false,
    };
  }
  gastonWatchFever(ts);
  // The start the head check found dead, left out of the replan.
  let avoid: Point | null = null;
  let dead = 0;
  for (;;) {
    let board = ts.scanBoardQuick();
    let rescans = 0;
    const retryUntil = Date.now() + cfg.flashRetryMs;
    while (fullBoard && board.length < cfg.enoughTsums - cfg.countNoise && ts.isRunning
           && Date.now() < retryUntil) {
      ts.sleep(cfg.pollMs);
      board = ts.scanBoardQuick();
      rescans++;
    }
    // Its own bubble read, not the scan's `ts.gameBubbles`: the scan's capture
    // cuts the bottom row of bubbles in half. See `bubbleHem`.
    const bubbles = gastonBubbles(ts);
    const biggest = gastonBiggestCluster(board);
    const gastons = gastonGastons(ts, board);
    gastonBubbleWorth(bubbles, board, gastons);
    let free = gastonFreeBoard(gastons, bubbles);
    if (avoid !== null) { free = gastonWithout(free, avoid); }
    const path = gastonOrient(gastonChain(free), gastonLeftovers(board, gastons));
    // Bubble centres in play-square scale, beside the board below: whether a
    // hop crossed one is then answerable offline. `near` is each one's
    // leftovers, the order the cancel spends them in.
    const bubbleAt: number[] = [];
    const near: number[] = [];
    for (let b = 0; b < bubbles.length; b++) {
      bubbleAt.push(Math.round(bubbles[b].x), Math.round(bubbles[b].y));
      near.push(bubbles[b].near || 0);
    }
    if (!path) {
      logInfo(Log.Skill.GastonPass, {
        chain: 0, read: board.length, rescans: rescans, gaston: gastons.length,
        cut: gastons.length - free.length, bubbles: bubbles.length, bubbleAt: bubbleAt, near: near,
        retry: dead,
      });
      return {
        chain: 0, cancelled: 0, held: false, heldMs: 0, releasedAt: 0, read: board.length,
        biggest: biggest, overMs: 0, dead: dead, onBoard: true,
      };
    }
    const probe = probeUntil > 0 && Date.now() < probeUntil ? gastonProbePoints(free, path) : null;
    // Not into the fever switch: the game takes no link through it.
    const waitedMs = gastonAwaitSwitch(ts, gastonDragEstimate(path.length));
    // Its own drag, not `linkTsums` and emphatically not `link`: the pacing and
    // the hold are the point, and `link`'s `maybeAutoTapSkill` would re-enter
    // this choreography.
    const drag = gastonLinkChain(ts, path, cancelBefore, holdUntil, probe);
    // A dead drag cleared nothing, so there is no pop to cut short.
    const cancelled = drag.held || drag.dead ? 0 : gastonCancelBubble(ts, path, bubbles);
    // The board the route was planned on and the route over it, so a short chain
    // on a recording can be replayed offline. Logged after the drag and the
    // cancel, which are what the window's time is for.
    const flat: number[] = [];
    for (let i = 0; i < free.length; i++) {
      flat.push(Math.round(free[i].x + Config.tsumWidth / 2), Math.round(free[i].y + Config.tsumWidth / 2));
    }
    const route: number[] = [];
    for (let i = 0; i < path.length; i++) { route.push(free.indexOf(path[i])); }
    logInfo(Log.Skill.GastonPass, {
      chain: path.length, read: board.length, rescans: rescans, gaston: gastons.length,
      cut: gastons.length - free.length, bubbles: bubbles.length,
      held: drag.held, heldMs: drag.heldMs, cancelled: cancelled,
      board: flat, route: route, bubbleAt: bubbleAt, near: near,
      // How long the drag was held back from a fever switch, and whether the
      // backdrop was up when it went out.
      waitedMs: waitedMs, fever: gastonFever.onAt > 0,
      // The drag's length, and the part of it spent waiting on the game's
      // MOVE acks beyond the dwells.
      dragMs: drag.ms, overMs: drag.overMs,
      // The head check: what it read (null when it did not run), whether it
      // lifted the finger and after how many tsums, and which replan this is.
      rise: drag.rise, dead: drag.dead, deadAt: drag.deadAt, retry: dead,
    });
    if (drag.dead) {
      dead++;
      if (dead <= cfg.deadRetries && ts.isRunning) {
        avoid = { x: path[0].x, y: path[0].y };
        continue;
      }
      return {
        chain: 0, cancelled: 0, held: false, heldMs: 0, releasedAt: drag.releasedAt,
        read: board.length, biggest: biggest, overMs: drag.overMs, dead: dead, onBoard: true,
      };
    }
    return {
      chain: path.length, cancelled: cancelled, held: drag.held, heldMs: drag.heldMs,
      releasedAt: drag.releasedAt, read: board.length, biggest: biggest,
      overMs: drag.overMs, dead: dead, onBoard: true,
    };
  }
}

/**
 * One window, from the activation at `t0` to the charge after it: the gate,
 * the passes and the spam that fires the next activation. Answers when that
 * activation went (the read that saw the gauge full), or 0 when the charge
 * never filled it, the held chain was too short to try, or the round ended.
 */
function gastonWindow(ts: Tsum, level: number, t0: number): number {
  const cfg = GastonConfig;
  // The earliest the window can close, for `stillRunning`: the animation's
  // floor and the window itself.
  gastonWindowRound = ts.roundStartedAt;
  gastonWindowUntil = t0 + cfg.openMinMs + cfg.durationMs[level - 1];
  // The animation and the first fill are one wait, behind a floor: the
  // animation is never under three seconds, and a board that was full at the
  // tap counts as full under it. See `openMinMs`.
  const opened = gastonAwaitBoard(ts, t0 + cfg.openWaitMs, t0 + cfg.openMinMs);
  const openMs = Date.now() - t0;
  // The backdrop up as the board comes live is the fever this activation's
  // clear brought on, and its clock started as the face faded. See `faceMs`.
  gastonWatchFever(ts);
  if (gastonFever.plain === 0) { gastonFever.onAt = t0 + cfg.faceMs; }
  // The clock starts here, not at the tap. See `durationMs`.
  const closesAt = Date.now() + cfg.durationMs[level - 1];
  const holdUntil = closesAt + cfg.holdPastCloseMs;

  // The window: chain, cancel, wait for the drop, `passesBeforeHold` times;
  // then chain and hold through the close -- that one ends the window and
  // is the charge. So is any chain whose head lands in the tail. The refill
  // gate is not cut at the close: what is falling at the close is Gaston,
  // and the held chain wants it landed.
  let passes = 0;
  let cancels = 0;
  let overMs = 0;
  let dead = 0;
  let onBoard = true;
  let fullBoard = opened.full;
  let passesLeft = cfg.passesBeforeHold;
  // The held chain, 0 when the window closed without one.
  let clearing = 0;
  let heldMs = 0;
  let releasedAt = 0;
  const drawn: number[] = [];
  const read: number[] = [];
  const biggest: number[] = [];
  while (ts.isRunning) {
    const cancelBefore = passesLeft > 0 ? closesAt - cfg.noCancelTailMs : 0;
    // The head check runs on the cancelled passes only, and clear of the
    // game's own blink at the close. See `aliveBlackoutMs`.
    const probeUntil = passesLeft > 0 ? closesAt - cfg.aliveBlackoutMs : 0;
    const pass = gastonPass(ts, cancelBefore, holdUntil, fullBoard, probeUntil);
    passes++;
    dead += pass.dead;
    if (!pass.onBoard) { onBoard = false; break; }
    read.push(pass.read);
    biggest.push(pass.biggest);
    if (pass.chain > 0) {
      drawn.push(pass.chain);
      cancels += pass.cancelled;
      overMs += pass.overMs;
      if (pass.held) {
        clearing = pass.chain;
        heldMs = pass.heldMs;
        releasedAt = pass.releasedAt;
        break;
      }
      passesLeft--;
      // A cancelled clear is gone at once; one left to pop takes its time
      // off the board tsum by tsum. See `popPerTsumMs`.
      const floor = pass.cancelled > 0 ? cfg.fillMinMs
        : Math.max(cfg.fillMinMs, pass.chain * cfg.popPerTsumMs + cfg.popTailMs);
      const at = Date.now();
      fullBoard = gastonAwaitBoard(ts, at + floor + cfg.fillWaitMs, at + floor).full;
    } else {
      // Nothing to chain, and the close well past: the board is not coming
      // back as Gaston. A ceiling, not the close itself, because a pass that
      // finds nothing right at the close is a refill still landing.
      if (Date.now() >= closesAt + cfg.fillWaitMs) { break; }
      ts.sleep(cfg.rescanIdleMs);
      fullBoard = false;
    }
  }

  // The charge: the held chain is popping past the close, so every Gaston
  // in it fills the gauge. The button is spammed through the clear, and the
  // moment it reads full the next window opens from here -- see the header.
  // A short held chain fills nothing worth waiting on (`chargeMinChain`).
  const chargeFrom = Date.now();
  let charge: GastonCharge = { taps: 0, ready: false, onBoard: onBoard };
  if (onBoard && clearing >= cfg.chargeMinChain) {
    charge = gastonSpamSkill(ts, chargeFrom + cfg.gaugeWaitMs);
  }
  const firedAt = charge.ready ? Date.now() : 0;

  logInfo(Log.Skill.GastonDone, {
    skillLevel: level,
    windowMs: cfg.durationMs[level - 1],
    // The field to read first. `openMs` near 3900 with `openTsums` at a full
    // board is the gate working; `openMs` at the `openWaitMs` ceiling with
    // `openTsums` low is a board that never filled, and everything after it
    // was planned under the animation.
    openMs: openMs,
    openTsums: opened.peak,
    passes: passes,
    // Every chain the window drew, in order, the last of them the held
    // chain left to pop. Thirty, thirty, thirty is the skill playing; a short
    // one is a board read before it had filled, or a route the game did not
    // follow -- `skill.gaston.pass` has the board and the route to replay.
    chains: drawn,
    // Per pass: how many tsums the scan put in the board array, and how many
    // of them its biggest colour cluster holds. `biggest` well under `read`
    // on a board that looks like solid Gaston is the scan reading him as
    // several colours, and the route is drawn over the biggest alone.
    read: read,
    biggest: biggest,
    // Bubbles tapped into the window's clears. At least one a chain bar the
    // last is the loop working; well under is a window with no bubble to
    // cancel with, whose refills ran the `fillWaitMs` ceiling.
    cancels: cancels,
    // Time the drags spent waiting on the game's MOVE acks beyond their
    // dwells, summed -- `skill.gaston.pass` has it per drag.
    overMs: overMs,
    // Drags the head check lifted for a start that was not linking -- each
    // one is a `skill.gaston.pass` with `dead: true` and the route to replay.
    // One a window or so is the scan's frontier being caught; every drag is
    // the check misreading, and `rise` on those entries says why.
    dead: dead,
    // The held chain: how long the finger sat on its last tsum, and how far
    // past the estimated close it was released. `releaseLeadMs` under 0 is
    // a release inside the window, which charges nothing -- the bug to look
    // for; near `holdPastCloseMs` is the hold working, and well over it is
    // a third drag that ended past the close on its own. Both 0 when the
    // window closed with no chain to hold.
    heldMs: heldMs,
    releaseLeadMs: clearing > 0 ? releasedAt - closesAt : 0,
    // Taps on the button through the clear until it read full, -1 when it
    // never did by `gaugeWaitMs`, 0 when the held chain was too short to
    // charge. `ready` is whether the gauge was seen full, which is the next
    // activation and the next window; false hands the board to the play
    // loop with the gauge still filling. `chargeMs` is release to full.
    // `onBoard: false` is a round that ended under the window.
    spamTaps: charge.ready ? charge.taps : (charge.taps > 0 ? -1 : 0),
    chargeMs: Date.now() - chargeFrom,
    ready: charge.ready,
    onBoard: onBoard && charge.onBoard,
    totalMs: Date.now() - t0,
  });
  return firedAt;
}

registerSkill({
  types: [SkillType.Gaston],
  // Every bubble is a cancel, and a cancel is what fits a second pass into the
  // window -- worth far more than the bigger clear the Bubble Strategy would
  // buy by popping one into a chain. So they are the skill's from the first
  // activation to the round's end (see the header); before it the round is
  // ordinary play and the strategy spends them as set.
  claimsBubbles: function(ts) {
    return ts.roundStartedAt !== 0 && gastonClaimRound === ts.roundStartedAt;
  },
  // No `popBubblesAfterChain`: a bubble popped into a chain between windows
  // cancels a clear that is filling the gauge (see the header). Every bubble
  // goes on the window's own cancels instead (`gastonCancelBubble`).
  //
  // Every colour stays in the board array, so Gaston's second and third
  // clusters are there whatever the leftovers do -- see the header. Four, as
  // Coronation Day Elsa keeps, is more than a board of leftovers has colours.
  // It also keeps the HUD glyphs' cluster, which `gastonFreeBoard` cuts.
  extraClusterSlots: 4,
  // Neither chain setting applies to this skill -- see the header. Uncapped,
  // because right after a window the board is a single colour and the chain on
  // it is worth thirty (`npm run chain:bench -- --only=gaston` costs that
  // search); one per scan, because the rest of a batch is planned on a board
  // the first chain has already cleared, which is what turned that thirty into
  // a twelve and two threes in `gaston_wrong.mp4`.
  chainLimits: { maxChain: 0, maxChainsPerScan: 1 },
  // A full gauge inside a window waits for it: an activation there restarts
  // the animation over the seconds the window had left (see the header).
  stillRunning: function(ts) {
    return ts.roundStartedAt !== 0 && gastonWindowRound === ts.roundStartedAt
      && Date.now() < gastonWindowUntil;
  },
  afterActivate: function(ts, _board, activatedAt) {
    const cfg = GastonConfig;
    let t0 = activatedAt || Date.now();
    // From here to the tally the bubbles are the window's. See `claimsBubbles`.
    gastonClaimRound = ts.roundStartedAt;
    const level = Math.min(Math.max(ts.skillLevel, 1), cfg.durationMs.length);
    // Window after window while each one's charge fires the next. The charge
    // reads the gauge full either under its own tap or just before the next,
    // so one more tap makes sure -- a no-op on a gauge already spent -- and
    // the window is anchored at the read. What `useSkill` does at every
    // activation is done here too, and logged the same, marked `charged`.
    while (ts.isRunning) {
      const firedAt = gastonWindow(ts, level, t0);
      if (firedAt === 0) { break; }
      logInfo(Log.Skill.Use, { skill: ts.skillType, skillLevel: ts.skillLevel, settleMs: 0,
        charged: true });
      ts.holdBubblesAfterSkill(firedAt);
      lorcanaNoteSkillFired();
      ts.tap(Button.gameSkill1);
      ts.sleep(30);
      t0 = firedAt;
    }
    // "It fired", which is what ends the play loop's link batch: the paths
    // still to draw were planned ten seconds ago on a board this window has
    // since cleared several times over. The play loop's next `useSkill` finds
    // the gauge filling, or the round over.
    return true;
  }
});
