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
// the paint read below catches.
//
// **The route is Gaston only, and the game itself says which tsums those are.**
// The route ran over the whole board array for a while, on the theory that a
// leftover of another colour the drag crosses is inert. It is not. The game
// links a tsum only while it is within reach of the chain's *head*, so the
// first leftover in the route leaves every Gaston after it two hops from the
// head, and the chain stalls there for good: `gaston_debug6.mp4` registered 14,
// 17, 2, 1 and 8 of routes planned at 29, 35, 15, 22 and 28, every stall on an
// ordinary 23-33px hop, while 43-44px hops inside the same chains linked fine.
// So the route is drawn over his tsums alone. For a long while his tsums were
// **the board's biggest colour cluster** (`gastonGastons`), and that is still
// how the drag picks the tsum it starts on. It is not good enough for the
// route. What the scan merges *into* that cluster it cannot tell apart, and
// under the fever backdrop's tint that is a lot: `gaston_8.mp4` (2026-09-21)
// had Donald, the Cheshire Cat and an orange tsum in the cluster on most
// boards, three to eight of them, and every route planned through one stopped
// there or lost its head to one -- the six held chains of that round
// registered 16, 14, 19, 7, 8 and 10 of 30, 35, 30, 37, 24 and 32. A palette
// learned by size and matched by colour was tried before that (`gaston_2.mp4`)
// and admitted Marie's cluster beside his face. Matching the skill-button
// portrait drew nothing: his face on blue is not his sprite on the board.
//
// What does tell them apart is the game. The moment a finger lands on a Gaston,
// the game paints **every other Gaston pale** -- translucent over a light layer,
// dark hair and all -- and nothing else on the board changes; land on a Donald
// and the Donalds go pale instead. It is on the next frame or the one after
// and it stays through the first hops at least. So the drag reads it
// (`gastonLinkChain` with a `GastonOracle`): every circle's floor -- its
// darkest channel, the median over a grid -- before the grab and again with
// the finger resting on the head (`paintMs`), and whatever rose by `paintRise`
// is Gaston. Measured on that recording: his tsums rise 22-51 under the fever
// tint and 36-56 on a plain board, a Donald or a Cheshire 0. The route is then
// planned from the head over exactly those (`gastonChainFrom`), and the finger
// goes on. A head that painted nothing was not Gaston: it comes up -- one
// tsum under a finger pops nothing -- and the pass tries the next start
// (`deadRetries`). The one thing the read cannot see through is the game's
// own paint at the close: from around the window's end every Gaston is held
// pale, finger or no finger, so nothing is read inside `paintBlackoutMs` of
// it, and a pass that reads nothing twice stops reading for the window. A
// pass without a read plans off what the last read learned: the circles it
// found not to be Gaston are remembered for the window (`gastonCarry`), less
// whatever a cancel's blast cleared since, and a circle of the cluster within
// `carryMatch` of one is left out -- the cluster, because the carry knows
// nothing of what dropped after the read. With no read at all it is the
// cluster, as it was. `extraClusterSlots` keeps his second and third clusters in the
// board array whatever the leftovers do, so the cluster pick has them.
//
// The read replaced a check that read eight far Gastons at the second hop
// (`gaston_7.mp4`): on `gaston_8.mp4` five of those eight were Donalds and
// Cheshires the cluster had swallowed, the check read live heads dead 27 times
// in 40, and every one of those lifts released the three tsums under it as a
// chain of three -- two and a half seconds of the window each on two windows.
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
// in the corpus has two to four glyph circles in the band. On BlueStacks the
// pile stacks further in, and the Gastons there were what joined its halves,
// so a route off the paint read keeps what it found painted down to the glyph
// rows (`paintedHudBand`).
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
// A chain with no bubble to cancel it is held too, whatever pass it is, when
// its own pop would refill past the earliest close (`refillBy`, not the late
// `closesAt`). Left to pop it takes ~90ms a tsum
// and the refill lands behind that, so a thirty-chain uncancelled at four
// seconds in refills after the close -- with leftovers. The device log of
// 2026-09-21 (`muc2hht99b`) had three windows of six whose second pass found
// no bubble: each waited 3.4s for that pop, planned its closing chain over a
// board whose Gaston cluster was 12 of 40, charged nothing, and the play
// loop's next activation then opened on a full board of leftovers -- two
// windows lost to one missing bubble. Holding the uncancelled chain instead
// charges off it; the pass after it would have had nothing to chain.
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
// **The antlers are not a fever theme; they are his skill.** `gaston_102.mp4`
// (2026-09-23), sampled at the chrome probe every 40-50ms: the antlers come
// up at tap+1.15-1.25s, never drop out before the close, and go at
// tap+9.60-9.72s in seven windows of seven, whatever the fever does. A fever
// behind them reads (0,55,65), a plain board (0,221,244), the antlers ~(248,
// 128,60). So `faceMs` + `feverMs` is the skill's clock, and the "exit" the
// switch wait predicts is the close, fixed at tap+9.65s -- where `closesAt`
// put it at 10.6-11.3. What the chrome
// cannot see is a fever under the antlers: one that ends mid-window ends
// unseen, and in that window a first pass planned at 37 linked 3 across it.
// When the antlers give way to a fever the wait sees no switch at all and
// runs to `switchLateMs`, which is where the held passes' 1.4-2.2s went.
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
//   - **the drag is the play loop's.** `linkTsums`' 10ms a tsum, unpaced.
//     For a while it dwelt 40ms on each, on `gaston_3.mp4` (2026-09-21):
//     Android hands the game one MOVE per frame and the game drops one in
//     five under fever, and at an 18ms dwell 279 of 456 planned tsums
//     registered. That was the snake route, whose hops ran to `linkReach`
//     and crossed back over its own links -- the mechanism `gaston_8.mp4`
//     found (below), which the crossing-free route removes. On the same
//     boards the play loop's 10ms chains run whole between windows, where
//     the 40ms drag cost 1.3s a chain and three of them did not fit the
//     window (`muc2hht99b`: the closing drag out 1.2-3.8s past the close in
//     every window). The freeze at the fever switch (above) was first read
//     as the game's UI thread blocking with the moves piling up behind it
//     (`gaston_4.mp4`: 33 planned registered 11, the drawn line frozen for
//     1.1s), and the host was given a paced MOVE for it -- `moveTo` with
//     `wait` returns once the game has taken the move (`pacedMoves`).
//     Measured in `gaston_6.mp4` it costs ~2ms a hop, the acks come back at
//     once, and the chains died at the switch all the same: the game takes
//     the moves and links none of them while it switches, so the freeze is
//     the game's own and the drag has to stay out of it. The pacing is off;
//     the pass record's `overMs` is what a drag cost beyond its dwells.
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
// ## A hop links whatever it crosses, and undoes what it crosses back over
//
// The host sends one MOVE per tsum and nothing between, and the game still
// links along the line between them: `gaston_8.mp4` has a three-tsum drag
// count 1, 2, 4, 5 and a chain of 37 planned register 7 because its fourth hop
// ran back across the third tsum's disc on the way to the fifth -- the counter
// went 4, 3, and the head sat there for the rest of the drag (the game takes
// the finger returning to the previous link as undoing it; a leftover under
// the fifth hop is what put the head there). The over-counts on the good
// drags, 24 of 23 and 25 of 22, are the same thing the pleasant way round. A
// planned hop of up to `linkReach` widths crosses another tsum nearly every
// time on a packed pile, so the route is planned over hops that cross nothing:
// an edge is kept only when its segment passes no other tsum's centre, nor a
// bubble's, within `crossAvoid` (`gastonNeighbors`). That is the adjacency
// graph and little more, which is what a finger draws anyway.
//
// Two things `gaston_7.mp4` measured and nothing here uses yet:
//
//   - the blink above is the game's own clock. It began at tap+9.0-9.7s and
//     went solid at ~9.7-10.4s in every window, where `closesAt` estimated
//     tap+10.7-11.2: the held chain went out 1-3s after the real close and
//     `heldMs` was 0 on every window. Safe, but window time.
//   - `gastonAwaitSwitch` held seven of eighteen drags 1.2-3.1s, because the
//     fever's start is stamped `faceMs` after the tap whenever the chrome reads
//     dimmed at the open, and one window's fever came on 4.3s after its tap.
//
// ## Every drag reads the game's own count
//
// Everything above was worked out by aligning a recording to the log and
// counting, one recording at a time, and none of it moved the number that
// matters: `gaston_9.mp4` (2026-09-21) still registered 7-15 of chains
// planned at 20-37, on boards the paint read had right. So the number is in
// the log now. Every drag reads the counter the game draws beside the head
// (chainCounter.ts) with the finger still down and logs it as `registered`
// beside `chain`, per pass and per window, and the play loop's chains between
// windows read it too (`readsChainCounter`), on the same boards. A drag
// setting is judged by that table -- `chain:replay` in the development
// toolkit checks a read against a recording -- and the first thing to settle
// with it is `dwellMs`: the host hands the game one MOVE a frame and the game
// links from the head only, so at 10ms every skipped hop that was a corner
// leaves the next tsum out of reach, which is what a chain stopping at a
// "wall" looks like. Measure 10 against 20 and 34 before changing anything
// else here.
//
// ## A route into a bubble dies there
//
// Measured, 2026-09-21, four recordings at dwell 10/20/34
// (`round-1-20260921-*.mp4`) aligned to the log by the activation cut-in and
// the planned route drawn over the frames. The counter read found 8 of 48
// drags -- the count is drawn pink, yellow-filled or rainbow-filled as often
// as navy -- so the numbers came off the release popups. Where the route was
// clean the 10ms drag registered whole: 24 of 24, 34 of 36 held, 19 of 19,
// 19 of 21, 19 of 20, 11 of 11. Where it died it died at a bubble: the
// 33-chain that read 7 linked 1-7 as planned and its eighth tsum was a bubble
// resting on the bowl; the one that read 13 ran into the bottom row of them
// at 14; a 14-chain stopped at 9 on a tsum 1.1 widths from a bubble the pass
// had read. The pass had read no bubble on the first two, with three in
// plain sight: the Hough pass loses the resting ones under the rim lights and
// the fever tint, the scan reads a bubble's icons as a tsum circle, and the
// paint read passes it (its `rise` is logged per circle now, to say by how
// much). So bubbles come from three sources (`gastonBubbles`): the pass
// proper, a second pass at a lower threshold over the bowl's bottom (`band`),
// and the round's memory of every read (`soft`, planned round and never
// tapped). The first run on them (`mucbceu4xy`) charged 13 windows of 18
// against 5 of 23 the day before, and showed the other edge: every bubble's
// avoid disc and crossing disc takes tsums out of the route, and at
// `bubbleAvoid` 1.4 four bubbles cut a full Gaston board into pieces (see
// the table). Dwell is not the lever; the passes that registered short did
// so at 10, 20 and 34 alike.
//
// The band's finds were `soft` too at first, and that left the resting
// bubbles standing: over six runs on 2026-09-22, 30 of the 35 chains released
// without a cancel had bubbles on the board, every one of them soft, and 66
// of those 78 sat in the band -- real ones, still there pass after pass and
// read hard by the next pass often enough. So the band's finds are tapped
// now, and only the memory's are not.
//
// The same recordings showed the carry starving whole windows: 221 of 291
// passes planned nothing, all on a carry that had marked the board's
// leftovers before the first clear slid them into new positions. A pass whose
// carry leaves nothing to chain now plans from the cluster and drops the
// carry until the next read (`starved` on the pass record).
//
// ## Every step is checked, not assumed
//
// The window used to take each step on trust: a bubble tapped was a cancel,
// a held chain was a charge. Two rounds on 2026-09-23 (`mudehgre4r`, 16
// windows) showed what that costs. Three passes went out uncancelled while
// the memory knew a bubble. Six charges failed, three on a held chain the
// counter read stalled (19 of 39, 19 of 27, 16 of 21), each spamming 4.5s
// over a board that had stopped clearing. And a failed charge is what ruins
// the windows after it: the play loop fills the gauge on the leftovers the
// clear refilled with, so the next activation opens on 17-20 Gastons of
// 36-45, and three windows in a row drew 3-14 on their first pass. So:
//
//   - a cancel is checked off the tsum count (`cancelDrop`); one the count
//     does not confirm taps the remembered bubbles, then any a fresh read
//     finds, and failing that the refill gate waits out the pop rather than
//     planning over it;
//   - a pass held back from the fever switch scans again before it draws
//     (`replanAfterWaitMs`), since the pile moves under a stale plan;
//   - a chain left to pop is held when its refill would land past the
//     earliest close (`refillBy`), not the late estimate the hold runs to;
//   - the charge stops spamming once the held chain's clear is over
//     (`chargeTailMs`), and the play loop's chains fill the rest;
//   - a pass whose Gaston chain is short draws other colours' chains too
//     (`mixedChains`), so a board of leftovers turns Gaston within a window.
//
// None of it sees a drag stall with the finger still down. The counter read
// one drag in six there, and its first read can be early (1 at the head, 16
// at the release), so a stall is judged by what the pass cleared instead.
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
  // A hop whose segment passes within this of any other tsum's centre, in
  // tsum widths, is not planned: the game links what the finger's line
  // crosses and undoes a link it crosses back over (see the header). The undo
  // of `gaston_8.mp4` was a segment 0.59 widths from the tsum's centre.
  // Adjacent tsums are a width apart and the third tsum of a packed row sits
  // 0.87 off the line between them, so every adjacent hop keeps. Replayed
  // over 103 logged boards the routes plan 99.5% of the unfiltered length at
  // 0.7 (98.6% at 0.8).
  crossAvoid: 0.7,

  // --- the paint read ------------------------------------------------------
  //
  // With a Gaston under the finger the game paints every other Gaston pale;
  // with a leftover under it the board stays as it was. Read as the rise in
  // every circle's floor -- its darkest channel, the median over a
  // (2*paintGrid+1)^2 grid at `paintStep` around its centre -- from a capture
  // just before the grab to one `paintMs` after the finger lands on the head.
  // `gaston_8.mp4`: the paint is on one to two frames after the DOWN, his
  // tsums rise 22-51 under the fever tint and 36-56 on a plain board, a
  // Donald or a Cheshire 0. A circle up by `paintRise` is Gaston. Fewer than
  // `minChain - 1` of them and the head was not: the finger comes up and the
  // pass tries another start, `deadRetries` times, one tsum under it popping
  // nothing. No read inside `paintBlackoutMs` of the close, where the game
  // paints every Gaston pale on its own -- solid from 0.8-1.8s past the
  // estimated close on that recording -- and none for the rest of a window
  // once a pass has read nothing twice.
  paintMs: 80,
  paintGrid: 3,
  paintStep: 2,
  paintRise: 12,
  paintBlackoutMs: 1000,
  deadRetries: 2,
  // A pass with no read leaves out every circle within this of a leftover the
  // last read found, in tsum widths: the pile settles after a cancel, but the
  // leftovers sit under the Gastons and mostly stay put.
  carryMatch: 0.6,
  // The two round HUD buttons under the bowl -- the skill button and the one
  // across from it -- in play-square coordinates. The hem brings them into the
  // bubble capture, and a circle within `hemButtonAvoid` tsum widths of one is
  // a button, not a bubble. Off the pass logs: x 27-34 and 167-173, y 212-216,
  // every pass.
  hemButtons: [{ x: 30, y: 214 }, { x: 170, y: 214 }],
  hemButtonAvoid: 1.0,
  // How far a planned tsum must stay from a bubble's centre, in tsum widths.
  // A bubble is about 1.4 tsums across, so this is "not touching". It was
  // 1.4 for one run (`mucbceu4xy`, 2026-09-22) on the strength of a 14-chain
  // that died at 9 on a tsum 1.1 widths from a bubble: with three or four
  // bubbles on the board that disc cut the pile into pieces no route could
  // cross -- routes of 4, 6 and 13 over 24-33 painted Gastons, 758 planned
  // over the run's 33 read passes against 898 at 1.0, replayed offline.
  bubbleAvoid: 1.0,
  // The bubbles the Hough pass misses are the ones resting on the bowl's
  // bottom: the rim lights and the fever tint leave their outline under
  // `GameBubbleConfig.param2`, and a route that runs into one dies there --
  // two 33-chains registered 7 and 13 that way on 2026-09-21, with the pass
  // reading no bubble at all and three in plain sight. A second pass at
  // `bandParam2` over the bottom of the capture, from `bubbleBandFrom` of its
  // height down (y 150 of a 220-tall hemmed capture: the resting ones centre
  // at 150-185), takes those; its finds are `band` -- kept out of the route
  // and tapped as cancels like the pass proper's. At 18 it also takes a tsum
  // now and then, and a tap on one is a tap the game ignores; the cost is
  // the pass counting it cancelled and waiting `fillMinMs` on a pop that ran
  // long. Replayed in cv2 over the scan frames of that day's four recordings:
  // the band pass found two of two, three of three and two of three bottom
  // bubbles at 20, more at 18, with one false circle in 18 frames.
  bubbleBandFrom: 0.68,
  bandParam2: 18,
  // Bubbles a read found stay known for this long, matched by position within
  // `bubbleMatch` widths on later reads: one that sank under the rim lights
  // and dropped out of the Hough is still there, and only a cancel's tap
  // removes one. Remembered bubbles are `soft`: planned round, never tapped,
  // since one that rolled when a clear went out from under it is a phantom
  // at the old spot.
  bubbleMemoryMs: 12000,
  bubbleMatch: 1.2,
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
  // Where the band ends for circles the paint read found painted: those are
  // tsums, so only the glyph rows stay cut. On BlueStacks the glyphs centre
  // at 0.2-0.45 and the pile's top row at 0.5 and down, and the full band cut
  // the Gastons that joined a pile's two halves (`gaston_102.mp4`: 6 planned
  // of 14 painted, 11 with them; over 153 read passes, 8% more planned).
  paintedHudBand: 0.6,

  // --- the drag ------------------------------------------------------------
  //
  // `linkTsums`' 10/10/10, unpaced: the play loop's own drag, which runs a
  // whole Gaston board as one chain between windows. It was 30/40/20 with a
  // paced MOVE for a while, on `gaston_3.mp4`'s finding that an 18ms dwell
  // lost a third of every chain -- measured on the snake route, whose long
  // hops and back-crossings the crossing-free route has since removed (see
  // the header). At 40 a thirty-chain was 1.3s, and three of them plus their
  // refill gates outran the window. A thirty-chain is now ~0.35s.
  //
  // No step between tsums (`stepsPerHop` 0), unlike Rapunzel+'s two: the game
  // links along the line between two MOVEs on its own (see the header), so a
  // sample in the middle adds nothing, and one that lands on a neighbour links
  // it out of order (`gaston_4.mp4`, three chains over their plan by 1-5 that
  // way). What keeps a hop clean is the route, planned over hops that cross
  // nothing (`crossAvoid`). `pacedMoves` makes each `moveTo` wait for the
  // game to take the move: ~2ms a hop measured, and no help at the fever
  // switch (see the header), so it is off and the moves queue as every other
  // drag's do.
  // The Debug tab's "Drag dwell" overrides `dwellMs` when set (`gastonDwellMs`).
  grabMs: 10,
  dwellMs: 10,
  stepMs: 5,
  stepsPerHop: 0,
  releaseMs: 10,
  pacedMoves: false,

  // --- the cancel, and the hold --------------------------------------------
  //
  // Chains drawn and cancelled before the held one. Each is a chain of
  // thirty and its cancel, and each earns a bubble; two fit a level-6 window
  // with the third drag ending about at the close. A pass with no bubble to
  // cancel with still counts as one -- unless its pop would refill past the
  // close, when it is held instead (see `gastonPass`).
  passesBeforeHold: 2,
  // Tapped the moment the drag releases: the pop animation is what it cuts
  // short, so a late tap spends a bubble on nothing.
  cancelTapMs: 10,
  // Bubbles left standing for the next window. None: every activation leaves
  // a bubble, so the next window has its cancel whatever this one spends, and
  // a bubble spent here refills as Gaston where one kept sits where the chain
  // would go.
  bubbleReserve: 0,
  // A cancelled clear leaves the board at once; one left to pop loses a tsum
  // every `popPerTsumMs`. So a cancel is confirmed when the tsum count drops
  // `cancelDrop` within `cancelCheckMs` of the tap (a pop manages ~4 in that
  // time). Unconfirmed, the remembered (`soft`) bubbles are tapped too -- one
  // that has rolled away leaves a tsum under the tap, which the game ignores
  // -- and the refill gate waits out the pop. Chains under `cancelCheckMin`
  // are not checked: their pop is over inside `fillMinMs` either way.
  cancelDrop: 8,
  cancelCheckMs: 400,
  cancelPollMs: 40,
  cancelCheckMin: 10,
  // A chain whose drag ends within this of the earliest close is held rather
  // than cancelled, whatever pass it is: a cancel there refills a board the
  // window has no time to chain again, and a release there charges nothing.
  // With no bubble to cancel with the tail is the pop itself (`popPerTsumMs`,
  // `popTailMs`): a clear left to pop refills that much later, and drops
  // past the close are not Gaston.
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
  // The spam also stops this long after the held chain's clear should be over
  // (`popPerTsumMs` a tsum, of its late count when the counter read one). On
  // 2026-09-23 every charge that fired read full within 0.9s of that; the ones
  // that did not spammed the whole `gaugeWaitMs` over a board that had
  // stopped clearing, and the play loop's first chains after filled the gauge.
  chargeTailMs: 1500,
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
  //
  // `dodgeSwitch` false sends every drag out at once: `gastonAwaitSwitch`
  // waits for nothing. The backdrop is still watched, so a pass still logs
  // `fever` -- whether the drag went out under one -- with `waitedMs` 0.
  dodgeSwitch: true,
  feverMs: 8350,
  faceMs: 1300,
  switchFreezeMs: 800,
  switchLeadMs: 250,
  // How long past the predicted exit to keep waiting for it. The fever clock
  // pauses under a skill animation, so a fever already running at the tap
  // outlives the estimate by the animation; past this the drag goes out anyway.
  switchLateMs: 1500,
  // A pass that waited longer than this for the switch scans again before it
  // draws: the pile moves in that time, and the route and the paint read are
  // planned off the scan.
  replanAfterWaitMs: 200,
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

  // --- a board of leftovers ------------------------------------------------
  //
  // A pass whose Gaston chain is under `mixedBelow` also draws up to
  // `mixedChains` chains of any colour off the same scan, while inside
  // `mixedChainMs` of its release and before the cancel: whatever the window
  // clears refills as Gaston, and one short chain a pass converts too little
  // (see the header). 0 turns it off.
  mixedBelow: 15,
  mixedChains: 4,
  mixedChainMs: 600,
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

// What the window's last paint read found not to be Gaston, as centres in
// play-square scale, for a pass that cannot read (see `carryMatch`), and
// whether a read has happened this window at all -- a carry with nothing in
// it after one means the board is all his. Both reset as each window opens;
// a cancel's blast takes out what it cleared.
var gastonCarry: Point[] = [];
var gastonCarryRead = false;

// Every bubble a read of this round has found, by position, with when it was
// last seen (`gastonRememberBubbles`): the ones the Hough loses under the rim
// lights are still there. Keyed to the round; a cancel's tap drops one.
var gastonBubbleMemory: GameBubble[] = [];
var gastonBubbleRound = 0;

/** What one pass of the window came to. */
interface GastonPass {
  /** Tsums in the chain drawn, 0 when none was. */
  chain: number;
  /** Tsums the game's counter said it linked (chainCounter.ts); null when nothing was drawn or the counter did not read. */
  registered: number | null;
  /** The counter again just before a held chain's release; null unless held and read. */
  registeredLate: number | null;
  /** Bubbles tapped to cancel the pop animation. */
  cancelled: number;
  /** Whether the tsum count showed the cancel take; null when unchecked (see `cancelCheckMin`). */
  confirmed: boolean | null;
  /** Other colours' chains drawn beside a short one (`mixedChains`). */
  extra: number;
  /** From the release to the last tsum of it and its extras popping, uncancelled. */
  popMs: number;
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
  /** Drags the finger came up from at the head: a start that painted nothing, or one no chain reaches from. */
  dead: number;
  /** Of those, the heads that painted nothing -- the read failing, not the route. */
  blank: number;
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
 * `feverMs`). Answers the ms spent waiting; 0 at once with `dodgeSwitch` off.
 */
function gastonAwaitSwitch(ts: Tsum, dragMs: number): number {
  const cfg = GastonConfig;
  if (!cfg.dodgeSwitch) { return 0; }
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

/** The dwell on each tsum of a drag: the Debug tab's, when set, else `dwellMs`. */
function gastonDwellMs(): number {
  return Config.dragDwellMs > 0 ? Config.dragDwellMs : GastonConfig.dwellMs;
}

/** About how long a drag over `chain` tsums takes, for the switch wait. */
function gastonDragEstimate(chain: number): number {
  const cfg = GastonConfig;
  return cfg.grabMs + cfg.releaseMs + chain * (gastonDwellMs() + 5);
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
 *
 * Then two more sources: a second Hough at `bandParam2` over the bottom
 * `bubbleBandFrom` of the capture, for the bubbles resting on the bowl the
 * first pass reads through (`band`, tapped like the first pass's), and the
 * memory of earlier reads (`gastonRememberBubbles`; `soft`, planned round
 * and never tapped). A band find within `minDist` of a hard one is the same
 * bubble and dropped. The list is ordered hard, band, soft.
 */
function gastonBubbles(ts: Tsum): GameBubble[] {
  const cfg = GastonConfig;
  const bc = GameBubbleConfig;
  const hem = cfg.bubbleHem;
  const h = Math.min(Math.round(ts.playHeight * (1 + hem)), ts.screenHeight - ts.playOffsetY);
  const outH = Math.round(ts.playResizeHeight * h / ts.playHeight);
  const img = getScreenshotModify(ts.playOffsetX, ts.playOffsetY, ts.playWidth, h,
    ts.playResizeWidth, outH, 100);
  let gray: NativeImage | null = null;
  let hard: GameBubble[];
  let band: HoughCircle[];
  try {
    gray = buildBoardGray(img);
    hard = gastonNotButtons(findGameBubbles(gray));
    band = houghCircles(gray, 3, 1, bc.minDist, bc.param1, cfg.bandParam2, bc.minRadius, bc.maxRadius);
  } finally {
    if (gray != null) { releaseImage(gray); }
    releaseImage(img);
  }
  const bandFrom = outH * cfg.bubbleBandFrom;
  const low: GameBubble[] = [];
  for (let k = 0; k < band.length; k++) {
    const b = band[k];
    if (b.y < bandFrom) { continue; }
    low.push({ x: b.x, y: b.y, r: b.radius, band: true });
  }
  const out = hard.slice();
  const lowKept = gastonNotButtons(low);
  for (let k = 0; k < lowKept.length; k++) {
    if (!gastonBubbleNear(lowKept[k], out, bc.minDist)) { out.push(lowKept[k]); }
  }
  return gastonRememberBubbles(ts, out);
}

/**
 * The bubbles a cancel may tap: the Hough pass proper's and the band's, not
 * the memory's (`soft`).
 */
function gastonTappableBubbles(bubbles: GameBubble[]): GameBubble[] {
  const out: GameBubble[] = [];
  for (let i = 0; i < bubbles.length; i++) {
    if (!bubbles[i].soft) { out.push(bubbles[i]); }
  }
  return out;
}

/** Whether `b` is within `dist` (play-square units) of any of `list`. */
function gastonBubbleNear(b: Point, list: Point[], dist: number): boolean {
  for (let i = 0; i < list.length; i++) {
    const dx = list[i].x - b.x;
    const dy = list[i].y - b.y;
    if (dx * dx + dy * dy < dist * dist) { return true; }
  }
  return false;
}

/**
 * Fold this read into the round's bubble memory and hand back the read plus
 * every remembered bubble it did not find again, as `soft`. A read refreshes
 * a remembered bubble within `bubbleMatch` widths; one unseen for
 * `bubbleMemoryMs` is forgotten; a cancel's tap forgets one outright
 * (`gastonForgetBubble`). A new round starts with nothing.
 */
function gastonRememberBubbles(ts: Tsum, read: GameBubble[]): GameBubble[] {
  const cfg = GastonConfig;
  const now = Date.now();
  if (gastonBubbleRound !== ts.roundStartedAt) {
    gastonBubbleMemory = [];
    gastonBubbleRound = ts.roundStartedAt;
  }
  const match = Config.tsumWidth * cfg.bubbleMatch;
  const out = read.slice();
  const next: GameBubble[] = [];
  for (let i = 0; i < read.length; i++) {
    next.push({ x: read[i].x, y: read[i].y, r: read[i].r, lastSeen: now });
  }
  for (let k = 0; k < gastonBubbleMemory.length; k++) {
    const old = gastonBubbleMemory[k];
    if (gastonBubbleNear(old, read, match)) { continue; }
    if (now - (old.lastSeen || 0) > cfg.bubbleMemoryMs) { continue; }
    next.push(old);
    out.push({ x: old.x, y: old.y, r: old.r, soft: true });
  }
  gastonBubbleMemory = next;
  return out;
}

/** A cancel tapped `b`: it is gone, so the memory drops it. */
function gastonForgetBubble(b: Point): void {
  const match = Config.tsumWidth * GastonConfig.bubbleMatch;
  gastonBubbleMemory = gastonBubbleMemory.filter(function(p) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    return dx * dx + dy * dy >= match * match;
  });
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
 * circle with its centre in the HUD band across the top, `band` tsum widths
 * deep, which is the fever bonus and the combo counter read as tsums -- see
 * the header.
 *
 * Board points are top-left corners and bubbles are centres, so the half-width
 * goes back on before either test.
 */
function gastonFreeBoard(board: BoardPoint[], bubbles: GameBubble[], band: number): BoardPoint[] {
  const half = Config.tsumWidth / 2;
  const hud = Config.tsumWidth * band;
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

/** Whether the segment `a`-`b` passes within `rSq` (squared) of `p`. */
function gastonSegmentNear(a: Point, b: Point, p: Point, rSq: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const ex = a.x + t * dx - p.x;
  const ey = a.y + t * dy - p.y;
  return ex * ex + ey * ey < rSq;
}

/**
 * The hops the drag may draw over `board`: `buildTsumNeighbors`' reach, less
 * every hop whose segment passes within `crossAvoid` of a third tsum's centre
 * or inside a bubble -- the game links what the line crosses and undoes what
 * it crosses back over (see the header). Board points are top-left corners,
 * so the half width goes back on for the geometry.
 */
function gastonNeighbors(board: BoardPoint[], bubbles: GameBubble[]): number[][] {
  const half = Config.tsumWidth / 2;
  const reachSq = Config.tsumWidth * Config.linkReach * Config.tsumWidth * Config.linkReach;
  const cross = Config.tsumWidth * GastonConfig.crossAvoid;
  const crossSq = cross * cross;
  const centres: Point[] = [];
  for (let i = 0; i < board.length; i++) { centres.push({ x: board[i].x + half, y: board[i].y + half }); }
  const neighbors = buildTsumNeighbors(centres, reachSq);
  for (let i = 0; i < neighbors.length; i++) {
    const kept: number[] = [];
    for (let k = 0; k < neighbors[i].length; k++) {
      const j = neighbors[i][k];
      let clean = true;
      for (let o = 0; o < centres.length && clean; o++) {
        if (o !== i && o !== j && gastonSegmentNear(centres[i], centres[j], centres[o], crossSq)) { clean = false; }
      }
      for (let b = 0; b < bubbles.length && clean; b++) {
        if (gastonSegmentNear(centres[i], centres[j], bubbles[b], bubbles[b].r * bubbles[b].r)) { clean = false; }
      }
      if (clean) { kept.push(j); }
    }
    neighbors[i] = kept;
  }
  return neighbors;
}

/**
 * The chain to draw over `board` -- the Gastons the drag may touch: the longest
 * path `findLongestTsumPath` finds in any of its connected components, from
 * whichever tsum it starts at. See the header for why nothing anchors it.
 *
 * Components biggest first, each searched over its own points so the search's
 * memo applies (it keys on 31 tsums or fewer), and a route through the whole
 * of one ends the search: no smaller component can beat it.
 */
function gastonChain(board: BoardPoint[], bubbles: GameBubble[]): TsumPath | null {
  const cfg = GastonConfig;
  if (board.length < cfg.minChain) { return null; }
  const neighbors = gastonNeighbors(board, bubbles);
  const comps = findTsumComponents(neighbors);
  comps.sort(function(a, b) { return b.length - a.length; });
  let best: TsumPath = [] as TsumPath;
  for (let c = 0; c < comps.length; c++) {
    const comp = comps[c];
    if (comp.length <= best.length || comp.length < cfg.minChain) { break; }
    // The whole board's hops, renumbered to the component: rebuilt over the
    // component alone they would lose the other components' tsums as
    // obstacles.
    const points: BoardPoint[] = [];
    const all: number[] = [];
    const local: number[] = [];
    for (let i = 0; i < board.length; i++) { local.push(-1); }
    for (let i = 0; i < comp.length; i++) { points.push(board[comp[i]]); all.push(i); local[comp[i]] = i; }
    const sub: number[][] = [];
    for (let i = 0; i < comp.length; i++) {
      const row: number[] = [];
      const nbrs = neighbors[comp[i]];
      for (let k = 0; k < nbrs.length; k++) { row.push(local[nbrs[k]]); }
      sub.push(row);
    }
    const route = findLongestTsumPath(sub, all, cfg.searchSteps).path;
    if (route.length > best.length) {
      best = [] as TsumPath;
      for (let i = 0; i < route.length; i++) { best.push(points[route[i]]); }
    }
  }
  return best.length >= cfg.minChain ? best : null;
}

/**
 * The longest chain from `head` over `gastons` -- the finger is already on the
 * head, so only that start is searched. Null under `minChain`.
 */
function gastonChainFrom(head: BoardPoint, gastons: BoardPoint[], bubbles: GameBubble[]): TsumPath | null {
  const cfg = GastonConfig;
  const points: BoardPoint[] = [head];
  for (let i = 0; i < gastons.length; i++) {
    if (gastons[i] !== head) { points.push(gastons[i]); }
  }
  if (points.length < cfg.minChain) { return null; }
  const route = findLongestTsumPath(gastonNeighbors(points, bubbles), [0], cfg.searchSteps).path;
  if (route.length < cfg.minChain) { return null; }
  const path: TsumPath = [] as TsumPath;
  for (let i = 0; i < route.length; i++) { path.push(points[route[i]]); }
  return path;
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
  /** The route drawn: the plan, or what the paint read planned from its head. Empty when nothing was. */
  path: TsumPath;
  /** Grab to release less the hold, in ms. */
  ms: number;
  /**
   * Over the dwells and settles: the calls themselves, and with `pacedMoves`
   * the time `moveTo` spent waiting for the game to take each move -- ~2ms a
   * hop measured (see the header).
   */
  overMs: number;
  /** The finger stayed on the last tsum until the window had closed. */
  held: boolean;
  /** How long it stayed there past the drag, in ms; 0 when released at once. */
  heldMs: number;
  /** Epoch ms of the release, 0 when nothing was drawn. */
  releasedAt: number;
  /** The paint read lifted the finger: the head painted nothing, so it was not Gaston. */
  dead: boolean;
  /** The circles the paint read found to be Gaston, null when it did not run. */
  gastons: BoardPoint[] | null;
  /** The read's rise: the median over the circles that rose, or over every circle when none did. Null when it did not run. */
  rise: number | null;
  /** Every circle's rise, in `board` order, for the log: what a bubble or a leftover reads against `paintRise`. Null when the read did not run. */
  rises: number[] | null;
  /** The circles the read found not to be Gaston, as centres, for `gastonCarry`. Empty without a read. */
  leftovers: Point[];
  /** The game's chain counter, read `settleMs` after the last MOVE with the finger down (chainCounter.ts). Null when nothing was drawn. */
  count: ChainCount | null;
  /** The counter again just before a held chain's release, in case the count was still climbing. Null unless held. */
  countLate: ChainCount | null;
}

/**
 * The paint read a drag may make with the finger on its head (see the header):
 * every circle of the scan to classify, and the plan to draw from the head
 * over the Gastons it finds.
 */
interface GastonOracle {
  board: BoardPoint[];
  plan: (head: BoardPoint, gastons: BoardPoint[]) => TsumPath | null;
}

/** The lower median of `values`. */
function gastonMedian(values: number[]): number {
  const sorted = values.slice().sort(function(a, b) { return a - b; });
  return sorted[(sorted.length - 1) >> 1];
}

/**
 * Each circle's floor: the median, over a grid around its centre, of the
 * pixel's darkest channel, off one capture of the play square. The pale paint
 * the game puts on a live chain's Gastons lifts it by 20-50 whatever the theme
 * tints the board, where the sprite's own colours barely move it -- see
 * `paintRise`. Board points are top-left corners; the grid sits on the centre.
 */
function gastonFloorRead(ts: Tsum, board: BoardPoint[]): number[] {
  const cfg = GastonConfig;
  const half = Config.tsumWidth / 2;
  const pts: Point[] = [];
  for (let c = 0; c < board.length; c++) {
    for (let i = -cfg.paintGrid; i <= cfg.paintGrid; i++) {
      for (let j = -cfg.paintGrid; j <= cfg.paintGrid; j++) {
        pts.push({
          x: Math.round(board[c].x + half + i * cfg.paintStep),
          y: Math.round(board[c].y + half + j * cfg.paintStep),
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
  const per = (2 * cfg.paintGrid + 1) * (2 * cfg.paintGrid + 1);
  const out: number[] = [];
  for (let c = 0; c < board.length; c++) {
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
 * Draw the chain, dwelling on each tsum (see `dwellMs`), and release it -- at
 * once unless `holds` says the chain is the closing one, when the finger
 * stays on the last tsum until `holdUntil` so the clear falls after the
 * window's close (see the header).
 *
 * With `oracle`, `path` is only the head: the finger lands on it, waits
 * `paintMs` for the game's paint, and the read says which circles are Gaston
 * (`paintRise`). The route is then planned from the head over those and drawn
 * on. A head that painted fewer than `minChain - 1` is not Gaston: the finger
 * comes up at once, one tsum under it, which pops nothing (`dead`).
 *
 * `holds` is asked at the head, not at the plan, with when the head landed
 * and how long the chain drawn is: it is where the release falls against the
 * close that matters, and the read may have replanned the chain. The finger
 * comes up whatever happens to the run, since the host lifts nothing on its
 * own; a stopped run cuts the hold short and releases.
 */
function gastonLinkChain(ts: Tsum, path: TsumPath, holds: (headAt: number, chain: number) => boolean,
    holdUntil: number, oracle: GastonOracle | null): GastonDrag {
  const drag: GastonDrag = {
    path: [] as TsumPath, ms: 0, overMs: 0, held: false, heldMs: 0, releasedAt: 0,
    dead: false, gastons: null, rise: null, rises: null, leftovers: [], count: null, countLate: null,
  };
  // A stopped run draws no new chain -- the same rule as `linkTsums`.
  if (!ts.isRunning || path.length < 1 || (oracle === null && path.length < 2)) { return drag; }
  const cfg = GastonConfig;
  const half = Config.tsumWidth / 2;
  const base = oracle !== null ? gastonFloorRead(ts, oracle.board) : null;
  const from = Date.now();
  const dwellMs = gastonDwellMs();
  const head = gastonToScreen(ts, path[0]);
  tapDown(head.x, head.y, cfg.grabMs);
  moveTo(head.x, head.y, dwellMs, cfg.pacedMoves);
  if (oracle !== null && base !== null) {
    const rest = cfg.paintMs - cfg.grabMs - dwellMs;
    if (rest > 0) { ts.sleep(rest); }
    const now = gastonFloorRead(ts, oracle.board);
    const gastons: BoardPoint[] = [];
    const rises: number[] = [];
    const all: number[] = [];
    for (let k = 0; k < now.length; k++) {
      const rise = now[k] - base[k];
      all.push(rise);
      if (oracle.board[k] === path[0]) { continue; }
      if (rise >= cfg.paintRise) {
        gastons.push(oracle.board[k]);
        rises.push(rise);
      } else {
        drag.leftovers.push({ x: oracle.board[k].x + half, y: oracle.board[k].y + half });
      }
    }
    drag.gastons = gastons;
    drag.rise = gastonMedian(rises.length > 0 ? rises : all);
    drag.rises = all;
    const planned = gastons.length + 1 >= cfg.minChain ? oracle.plan(path[0], gastons) : null;
    if (planned === null) {
      drag.dead = gastons.length + 1 < cfg.minChain;
      // A head that painted nothing said nothing about the rest.
      if (drag.dead) { drag.leftovers = []; }
      drag.releasedAt = Date.now();
      tapUp(head.x, head.y, cfg.releaseMs);
      drag.ms = Date.now() - from;
      return drag;
    }
    path = planned;
  }
  drag.path = path;
  const pts: Point[] = [head];
  for (let i = 1; i < path.length; i++) { pts.push(gastonToScreen(ts, path[i])); }
  for (let i = 1; i < pts.length; i++) {
    for (let s = 1; s <= cfg.stepsPerHop; s++) {
      const f = s / (cfg.stepsPerHop + 1);
      moveTo(Math.floor(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f),
        Math.floor(pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f), cfg.stepMs, cfg.pacedMoves);
    }
    moveTo(pts[i].x, pts[i].y, dwellMs, cfg.pacedMoves);
  }
  const headAt = Date.now();
  // What the game linked, off its own counter, with the finger still down:
  // the measurement every drag setting is judged by (chainCounter.ts).
  const route = chainRouteCentres(path);
  ts.sleep(ChainCounterConfig.settleMs);
  drag.count = chainCounterRead(ts, route);
  if (holds(headAt, path.length)) {
    drag.held = true;
    while (ts.isRunning && Date.now() < holdUntil) {
      ts.sleep(Math.min(cfg.holdSliceMs, holdUntil - Date.now()));
    }
    drag.countLate = chainCounterRead(ts, route);
    drag.heldMs = Date.now() - headAt;
  }
  const last = pts[pts.length - 1];
  drag.releasedAt = Date.now();
  tapUp(last.x, last.y, cfg.releaseMs);
  drag.ms = Date.now() - from - drag.heldMs;
  const slept = cfg.grabMs + dwellMs * pts.length
    + cfg.stepMs * cfg.stepsPerHop * (pts.length - 1) + cfg.releaseMs
    + (oracle !== null ? Math.max(0, cfg.paintMs - cfg.grabMs - dwellMs) : 0)
    + ChainCounterConfig.settleMs + drag.count.ms;
  drag.overMs = Math.max(0, drag.ms - slept);
  return drag;
}

/** What a cancel came to. */
interface GastonCancel {
  /** Bubbles tapped, remembered ones included. */
  tapped: number;
  /** Of those, remembered (`soft`) ones, tapped because the others did not take. */
  soft: number;
  /** Of those, found by a read after the release, because none before it took. */
  fresh: number;
  /** The count showed the clear leave at once; null when unchecked. */
  confirmed: boolean | null;
  /** How far the count fell after the taps; 0 when unchecked. */
  cleared: number;
}

/**
 * Cancel the pop animation, and check it took (`cancelDrop`): the bubbles
 * this capture found first, then -- with nothing found, or when those did not
 * take -- the ones the memory holds, which may have rolled since (see
 * `gastonBubbles`), then any a fresh read finds that neither list had.
 * `check` false taps the first set and trusts it, as every cancel did before
 * the check.
 *
 * The fresh read is for a bubble the pre-drag read got wrong: in
 * `gaston_101.mp4` (2026-09-23) the band pass took a tsum beside the real
 * bubble for it, the cancel tapped the tsum, and the 36-chain popped one by
 * one through the close, leaving the window nothing to hold.
 */
function gastonCancelBubble(ts: Tsum, path: TsumPath, all: GameBubble[], check: boolean): GastonCancel {
  const out: GastonCancel = { tapped: 0, soft: 0, fresh: 0, confirmed: null, cleared: 0 };
  if (!ts.isRunning) { return out; }
  const match = Config.tsumWidth * GastonConfig.bubbleMatch;
  const tapped: GameBubble[] = [];
  const tiers = [gastonTappableBubbles(all), all.filter(function(b) { return !!b.soft; })];
  for (let t = 0; t < 3; t++) {
    let tier: GameBubble[];
    if (t < 2) {
      tier = tiers[t];
    } else {
      // Only worth a capture when the count can say whether it took.
      if (!check || !ts.isRunning) { break; }
      tier = gastonTappableBubbles(gastonBubbles(ts)).filter(function(b) {
        return !gastonBubbleNear(b, tapped, match);
      });
    }
    if (tier.length === 0) { continue; }
    // Read right before the taps, so a pop running since cannot pass for them.
    const before = check ? gastonCountTsums(ts) : -1;
    const n = gastonTapBubbles(ts, path, tier);
    for (let k = 0; k < tier.length; k++) { tapped.push(tier[k]); }
    out.tapped += n;
    if (t === 1) { out.soft += n; }
    if (t === 2) { out.fresh += n; }
    if (before < 0) { break; }
    const drop = before - gastonAwaitDrop(ts, before);
    out.cleared = Math.max(out.cleared, drop);
    out.confirmed = drop >= GastonConfig.cancelDrop;
    if (out.confirmed) { break; }
  }
  // The board has moved, so every other position in the list is stale too.
  ts.gameBubbles = [];
  return out;
}

/**
 * The lowest tsum count within `cancelCheckMs`, stopping once it is
 * `cancelDrop` under `before`.
 */
function gastonAwaitDrop(ts: Tsum, before: number): number {
  const cfg = GastonConfig;
  const until = Date.now() + cfg.cancelCheckMs;
  let low = before;
  while (ts.isRunning && Date.now() < until && before - low < cfg.cancelDrop) {
    ts.sleep(cfg.cancelPollMs);
    low = Math.min(low, gastonCountTsums(ts));
  }
  return low;
}

/**
 * Tap `bubbles`, all but the reserve -- the one over the most leftovers first
 * (`gastonBubbleWorth`), then the one furthest from the chain. Answers how
 * many went.
 *
 * Leftovers because a pop there clears what no Gaston chain can and refills
 * it as Gaston. Furthest because the chain's own tsums are already clearing
 * -- a bubble popped on top of them adds nothing, where one across the board
 * clears ground the chain did not reach. Positions come from the scan the
 * chain was planned off; bubbles are big and drift slowly, so the tap still
 * lands.
 */
function gastonTapBubbles(ts: Tsum, path: TsumPath, bubbles: GameBubble[]): number {
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
  const blast = GameBubbleConfig.blastReach * Config.tsumWidth;
  for (let i = 0; i < count && i < far.length; i++) {
    const x = Math.floor(ts.playOffsetX + far[i].b.x * ts.playWidth / ts.playResizeWidth);
    const y = Math.floor(ts.playOffsetY + far[i].b.y * ts.playHeight / ts.playResizeHeight);
    tap(x, y, GastonConfig.cancelTapMs);
    gastonForgetBubble(far[i].b);
    // What the blast clears refills as Gaston, so it is no longer a leftover.
    const reach = far[i].b.r + blast;
    gastonCarry = gastonCarry.filter(function(p) {
      const dx = p.x - far[i].b.x;
      const dy = p.y - far[i].b.y;
      return dx * dx + dy * dy > reach * reach;
    });
  }
  return Math.min(count, far.length);
}

// --- A board of leftovers ---------------------------------------------------

/** Whether any hop of `path` passes inside a bubble -- a drag across one pops it and ends there. */
function gastonCrossesBubble(path: TsumPath, bubbles: GameBubble[]): boolean {
  const half = Config.tsumWidth / 2;
  for (let i = 1; i < path.length; i++) {
    const a = { x: path[i - 1].x + half, y: path[i - 1].y + half };
    const b = { x: path[i].x + half, y: path[i].y + half };
    for (let k = 0; k < bubbles.length; k++) {
      if (gastonSegmentNear(a, b, bubbles[k], bubbles[k].r * bubbles[k].r)) { return true; }
    }
  }
  return false;
}

/** A plain drag at the window's pace: no paint read, no counter, no hold. */
function gastonDrawPlain(ts: Tsum, path: TsumPath): void {
  const cfg = GastonConfig;
  const dwellMs = gastonDwellMs();
  let p = gastonToScreen(ts, path[0]);
  tapDown(p.x, p.y, cfg.grabMs);
  moveTo(p.x, p.y, dwellMs, cfg.pacedMoves);
  for (let i = 1; i < path.length; i++) {
    p = gastonToScreen(ts, path[i]);
    moveTo(p.x, p.y, dwellMs, cfg.pacedMoves);
  }
  tapUp(p.x, p.y, cfg.releaseMs);
}

/**
 * After a short Gaston chain, more of a board that is not his cleared: up to
 * `mixedChains` chains of any colour off the pass's scan, longest first,
 * while inside `mixedChainMs` of `releasedAt`. Planned over the free board
 * less the chain just drawn, skipping any that would cross a bubble. What
 * they clear refills as Gaston, so it leaves the carry. Answers each length.
 */
function gastonMixedChains(ts: Tsum, board: BoardPoint[], bubbles: GameBubble[], drawn: TsumPath,
    releasedAt: number): number[] {
  const cfg = GastonConfig;
  const out: number[] = [];
  if (cfg.mixedChains <= 0 || drawn.length === 0 || drawn.length >= cfg.mixedBelow) { return out; }
  const free = gastonFreeBoard(board, bubbles, cfg.hudBand).filter(function(p) { return drawn.indexOf(p) < 0; });
  const paths = calculatePaths(free, -1, false, 0);
  const half = Config.tsumWidth / 2;
  const match = Config.tsumWidth * cfg.carryMatch;
  for (let i = 0; i < paths.length && out.length < cfg.mixedChains; i++) {
    if (!ts.isRunning || Date.now() - releasedAt > cfg.mixedChainMs) { break; }
    const path = paths[i];
    if (gastonCrossesBubble(path, bubbles)) { continue; }
    gastonDrawPlain(ts, path);
    out.push(path.length);
    gastonCarry = gastonCarry.filter(function(c) {
      for (let k = 0; k < path.length; k++) {
        const dx = c.x - (path[k].x + half);
        const dy = c.y - (path[k].y + half);
        if (dx * dx + dy * dy < match * match) { return false; }
      }
      return true;
    });
  }
  return out;
}

/**
 * `board` less every circle within `carryMatch` of a leftover the window's
 * last paint read found (`gastonCarry`), and how many that left out. For a
 * pass that cannot read, over his colour cluster: the carry knows nothing of
 * what dropped since the read, which past the close is not him.
 */
function gastonCarryOut(board: BoardPoint[]): { kept: BoardPoint[], left: number } {
  const half = Config.tsumWidth / 2;
  const match = Config.tsumWidth * GastonConfig.carryMatch;
  const matchSq = match * match;
  const kept: BoardPoint[] = [];
  for (let i = 0; i < board.length; i++) {
    const cx = board[i].x + half;
    const cy = board[i].y + half;
    let leftover = false;
    for (let k = 0; k < gastonCarry.length; k++) {
      const dx = gastonCarry[k].x - cx;
      const dy = gastonCarry[k].y - cy;
      if (dx * dx + dy * dy < matchSq) { leftover = true; break; }
    }
    if (!leftover) { kept.push(board[i]); }
  }
  return { kept: kept, left: board.length - kept.length };
}

// --- The window -------------------------------------------------------------

/**
 * Scan, plan the longest chain over the board, draw it, and either cancel it
 * with a bubble or hold it until `holdUntil` and leave it to pop, which makes
 * it the closing chain (`held`). Held when `mayCancel` is off, when the head
 * lands inside `noCancelTailMs` of `refillBy`, or when there is no bubble to
 * cancel with and the clear's own pop would refill past it: those drops are
 * not Gaston, so the next pass would plan over leftovers -- and a window
 * whose second pass waited out such a pop lost its charge and the window
 * after it (`muc2hht99b`, 2026-09-21, three of six windows). `refillBy` is
 * the earliest the window can close, not the late estimate the hold runs to
 * (see `gastonWindow`). A chain
 * released short draws other colours' chains after it (`gastonMixedChains`),
 * and the cancel is checked off the tsum count (`gastonCancelBubble`).
 *
 * The board is checked for first: this runs blind for ten seconds and more,
 * and a round that ends under it would otherwise have chains dragged across
 * whatever screen came next. `fullBoard` is the gate's verdict: a scan that
 * then reads well short is under a flash and is taken again (`flashRetryMs`).
 *
 * Which circles are Gaston: a drag begun before `paintUntil` reads the game's
 * paint with the finger on its head and plans from there (`GastonOracle`,
 * see the header); the head itself is the start of the longest chain over
 * the window's carry (`gastonCarryOut`) when a read has happened this window,
 * else over the biggest colour cluster. A head the finger came up from -- one
 * that painted nothing, or one no chain reaches from -- is left out and the
 * pass tries again, `deadRetries` times; `paintUntil` 0 reads nothing, and
 * the carry or the cluster is the route. A pass whose drags all came up
 * answers `chain` 0 with `dead` counting them, so the window looks again at
 * once rather than waiting out a refill that is not coming.
 */
function gastonPass(ts: Tsum, refillBy: number, mayCancel: boolean, holdUntil: number,
    fullBoard: boolean, paintUntil: number): GastonPass {
  const cfg = GastonConfig;
  if (gPages.detect(1, 0) !== PageName.GamePlaying) {
    return {
      chain: 0, registered: null, registeredLate: null, cancelled: 0, confirmed: null, extra: 0, popMs: 0,
      held: false, heldMs: 0, releasedAt: 0, read: 0, biggest: 0, overMs: 0, dead: 0, blank: 0,
      onBoard: false,
    };
  }
  gastonWatchFever(ts);
  // The starts the finger came up from, left out of the next plan.
  const avoid: Point[] = [];
  let lifted = 0;
  let blank = 0;
  // Time this pass has spent held back from the switch, and whether it has
  // scanned again for it.
  let waitedMs = 0;
  let replanned = false;
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
    // His tsums as far as the pass can tell without a read: the cluster, less
    // what the last read found not to be him (the carry). The carry alone
    // takes every tsum dropped since that read for Gaston, and past the close
    // those are leftovers: `gaston_100.mp4` (2026-09-23) had two held chains
    // planned that way through Lotsos and Stitches, one headed on a Lotso.
    const carry = gastonCarryRead ? gastonCarryOut(gastons) : null;
    let source = carry !== null ? carry.kept : gastons;
    let origin = carry !== null ? 'carry' : 'cluster';
    let free = gastonFreeBoard(source, bubbles, cfg.hudBand);
    for (let k = 0; k < avoid.length; k++) { free = gastonWithout(free, avoid[k]); }
    let path = gastonOrient(gastonChain(free, bubbles), gastonLeftovers(board, source));
    // A carry that leaves nothing to chain is stale, not a board with nothing
    // on it: the first read of a window finds a board of leftovers, the
    // chain's clear slides them down into the positions it remembered, and
    // the Gastons that landed on top read as leftovers too. Every pass after
    // that planned nothing, for the rest of the window -- 221 of 291 passes on
    // 2026-09-21, six windows of 23 lost whole. So the pass falls back to the
    // cluster, and the carry is dropped until the next read replaces it.
    let starved = false;
    if (!path && carry !== null) {
      starved = true;
      gastonCarryRead = false;
      source = gastons;
      origin = 'cluster';
      free = gastonFreeBoard(source, bubbles, cfg.hudBand);
      for (let k = 0; k < avoid.length; k++) { free = gastonWithout(free, avoid[k]); }
      path = gastonOrient(gastonChain(free, bubbles), gastonLeftovers(board, source));
    }
    // Bubble centres in play-square scale, beside the board below: whether a
    // hop crossed one is then answerable offline. `near` is each one's
    // leftovers, the order the cancel spends them in.
    // `band` counts the band pass's finds and `soft` the memory's; the list
    // runs the pass proper's, then the band's, then the memory's.
    const bubbleAt: number[] = [];
    const near: number[] = [];
    let softBubbles = 0;
    let bandBubbles = 0;
    for (let b = 0; b < bubbles.length; b++) {
      bubbleAt.push(Math.round(bubbles[b].x), Math.round(bubbles[b].y));
      near.push(bubbles[b].near || 0);
      if (bubbles[b].soft) { softBubbles++; }
      if (bubbles[b].band) { bandBubbles++; }
    }
    if (!path) {
      logInfo(Log.Skill.GastonPass, {
        chain: 0, read: board.length, rescans: rescans, gaston: gastons.length,
        source: origin, carried: carry !== null ? carry.left : 0, starved: starved,
        cut: source.length - free.length, bubbles: bubbles.length, band: bandBubbles, soft: softBubbles,
        bubbleAt: bubbleAt, near: near, retry: lifted,
      });
      return {
        chain: 0, registered: null, registeredLate: null, cancelled: 0, confirmed: null, extra: 0, popMs: 0,
        held: false, heldMs: 0, releasedAt: 0, read: board.length, biggest: biggest, overMs: 0, dead: lifted,
        blank: blank, onBoard: true,
      };
    }
    const oracle: GastonOracle | null = paintUntil > 0 && Date.now() < paintUntil ? {
      board: board,
      // Painted circles are tsums, so only the glyph rows are cut (`paintedHudBand`).
      plan: function(head, found) {
        return gastonChainFrom(head, gastonFreeBoard(found, bubbles, cfg.paintedHudBand), bubbles);
      },
    } : null;
    // Whether the chain drawn is the closing one, asked at its head (see the
    // doc comment). No bubble: its pop runs `popPerTsumMs` a tsum and the
    // refill drops `popTailMs` behind, and only drops before the close are
    // Gaston.
    const holds = function(headAt: number, chain: number): boolean {
      if (!mayCancel || headAt >= refillBy - cfg.noCancelTailMs) { return true; }
      return gastonTappableBubbles(bubbles).length === 0
        && headAt + chain * cfg.popPerTsumMs + cfg.popTailMs >= refillBy;
    };
    // Not into the fever switch: the game takes no link through it.
    const waited = gastonAwaitSwitch(ts, gastonDragEstimate(path.length));
    waitedMs += waited;
    // A wait the pile can move in leaves the scan -- and the route and the
    // paint read planned off it -- stale. `gaston_101.mp4` (2026-09-23): a
    // held chain drawn 1.5s after its scan, through the switch, landed beside
    // its head and linked 7 of 19.
    if (waited > cfg.replanAfterWaitMs && !replanned && ts.isRunning) {
      replanned = true;
      continue;
    }
    // Its own drag, not `linkTsums` and emphatically not `link`: the paint
    // read and the hold are the point, and `link`'s `maybeAutoTapSkill` would
    // re-enter this choreography.
    const drag = gastonLinkChain(ts, path, holds, holdUntil, oracle);
    // What the read learned is the window's until the next read.
    if (drag.gastons !== null && !drag.dead) { gastonCarry = drag.leftovers; gastonCarryRead = true; }
    // A drag that drew nothing cleared nothing, so there is no pop to cut short.
    const released = !drag.held && drag.path.length > 0;
    // A short chain on a board of leftovers: clear more of it before the cancel.
    const extra = released ? gastonMixedChains(ts, board, bubbles, drag.path, drag.releasedAt) : [];
    // When the last of it pops if nothing cancels it: the extras pop from
    // their own releases, the last of them about now.
    const extraAt = Date.now() - drag.releasedAt;
    let popMs = drag.path.length * cfg.popPerTsumMs;
    for (let k = 0; k < extra.length; k++) { popMs = Math.max(popMs, extraAt + extra[k] * cfg.popPerTsumMs); }
    let drawnTsums = drag.path.length;
    for (let k = 0; k < extra.length; k++) { drawnTsums += extra[k]; }
    const cancel: GastonCancel = released
      ? gastonCancelBubble(ts, drag.path, bubbles, drawnTsums >= cfg.cancelCheckMin)
      : { tapped: 0, soft: 0, fresh: 0, confirmed: null, cleared: 0 };
    const cancelled = cancel.tapped;
    // The scan the route was planned on and the route over it, so a short
    // chain on a recording can be replayed offline: every circle, which of
    // them the read found painted, and the route as indexes into it. Logged
    // after the drag and the cancel, which are what the window's time is for.
    const flat: number[] = [];
    for (let i = 0; i < board.length; i++) {
      flat.push(Math.round(board[i].x + Config.tsumWidth / 2), Math.round(board[i].y + Config.tsumWidth / 2));
    }
    const route: number[] = [];
    for (let i = 0; i < drag.path.length; i++) { route.push(board.indexOf(drag.path[i])); }
    const fields: LogFields = {
      chain: drag.path.length, read: board.length, rescans: rescans, gaston: gastons.length,
      // What the game's counter said the drag linked, against `chain`: the
      // field to read first on a drag setting. `counter` is the read itself
      // -- where the number sat (play-square scale, beside `board`), how sure
      // the match was, and every other number on the frame. `registeredLate`
      // is a held chain's count again just before its release.
      registered: drag.count !== null ? drag.count.value : null,
      counter: drag.count !== null ? chainCountDetail(drag.count) : null,
      registeredLate: drag.countLate !== null ? drag.countLate.value : null,
      // Where the head came from, how many circles the carry left out, and
      // whether it was dropped for leaving nothing.
      source: origin, carried: carry !== null ? carry.left : 0, starved: starved,
      cut: source.length - free.length, bubbles: bubbles.length, band: bandBubbles, soft: softBubbles,
      held: drag.held, heldMs: drag.heldMs, cancelled: cancelled,
      // Whether the count saw the cancel take (null: unchecked), how far it
      // fell, and how many of the taps went to remembered bubbles.
      confirmed: cancel.confirmed, cleared: cancel.cleared, softTaps: cancel.soft, freshTaps: cancel.fresh,
      // Other colours' chains drawn after a short one (`mixedChains`).
      extra: extra,
      board: flat, route: route, bubbleAt: bubbleAt, near: near,
      // The head the drag started on, as an index into `board`, and which
      // try this is.
      head: board.indexOf(path[0]), retry: lifted,
      // The paint read: the rise it read (null when it did not run) and
      // whether it lifted the finger for a head that was not Gaston.
      rise: drag.rise, dead: drag.dead,
      // How long the drag was held back from a fever switch, whether the pass
      // scanned again after it (`replanAfterWaitMs`), and whether the backdrop
      // was up when it went out.
      waitedMs: waitedMs, replanned: replanned, fever: gastonFever.onAt > 0,
      // The drag's length, and the part of it spent beyond its sleeps: the
      // game's MOVE acks, and the read's two captures on a pass that read.
      dragMs: drag.ms, overMs: drag.overMs,
    };
    // Which circles the read found painted, as indexes into `board`.
    if (drag.gastons !== null) {
      const painted: number[] = [];
      for (let i = 0; i < drag.gastons.length; i++) { painted.push(board.indexOf(drag.gastons[i])); }
      fields.painted = painted;
    }
    // And every circle's rise, in `board` order: the pile's bubbles passed the
    // read on 2026-09-21 (the route ran into one), and this is what says by
    // how much.
    if (drag.rises !== null) { fields.rises = drag.rises; }
    logInfo(Log.Skill.GastonPass, fields);
    if (drag.path.length === 0) {
      lifted++;
      if (drag.dead) { blank++; }
      if (lifted <= cfg.deadRetries && ts.isRunning) {
        avoid.push({ x: path[0].x, y: path[0].y });
        continue;
      }
    }
    return {
      chain: drag.path.length, registered: drag.count !== null ? drag.count.value : null,
      registeredLate: drag.countLate !== null ? drag.countLate.value : null,
      cancelled: cancelled, confirmed: cancel.confirmed, extra: extra.length, popMs: popMs,
      held: drag.held, heldMs: drag.heldMs,
      releasedAt: drag.releasedAt, read: board.length, biggest: biggest,
      overMs: drag.overMs, dead: lifted, blank: blank, onBoard: true,
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
  // What a refill has to land before: the close as early as it can come.
  // `closesAt` errs late for the hold, and judged against it
  // `gaston_102.mp4`'s first window let a 29-chain with no bubble pop from
  // tap+7.3s, due done by 10.3 against 10.8; the game closed at 9.65 and
  // the refill was leftovers.
  const refillBy = gastonWindowUntil;
  // What the last window's reads learned is the last window's.
  gastonCarry = [];
  gastonCarryRead = false;
  // The paint read runs clear of the game's own paint at the close, and not
  // again in a window where a pass read nothing twice. See `paintBlackoutMs`.
  let paintUntil = closesAt - cfg.paintBlackoutMs;

  // The window: chain, cancel, wait for the drop, `passesBeforeHold` times;
  // then chain and hold through the close -- that one ends the window and
  // is the charge. So is any chain whose head lands in the tail, and one
  // with no bubble whose pop would refill past the close (`gastonPass`). The
  // refill gate is not cut at the close: what is falling at the close is
  // Gaston, and the held chain wants it landed.
  let passes = 0;
  let cancels = 0;
  let missed = 0;
  let extra = 0;
  let overMs = 0;
  let dead = 0;
  let onBoard = true;
  let fullBoard = opened.full;
  let passesLeft = cfg.passesBeforeHold;
  // The held chain, 0 when the window closed without one.
  let clearing = 0;
  let clearingLate: number | null = null;
  let heldMs = 0;
  let releasedAt = 0;
  const drawn: number[] = [];
  const registered: (number | null)[] = [];
  const read: number[] = [];
  const biggest: number[] = [];
  while (ts.isRunning) {
    const pass = gastonPass(ts, refillBy, passesLeft > 0, holdUntil, fullBoard, paintUntil);
    passes++;
    dead += pass.dead;
    if (!pass.onBoard) { onBoard = false; break; }
    // Only heads that painted nothing say the read has stopped working; one
    // that painted but had no route from it is the plan's fault. Counting
    // those switched reads off for `gaston_100.mp4`'s second window, whose
    // held chain then ran off the cluster into brown tsums at 14 of 32.
    if (pass.chain === 0 && pass.blank > cfg.deadRetries) { paintUntil = 0; }
    read.push(pass.read);
    biggest.push(pass.biggest);
    if (pass.chain > 0) {
      drawn.push(pass.chain);
      registered.push(pass.registered);
      cancels += pass.cancelled;
      if (pass.confirmed === false) { missed++; }
      extra += pass.extra;
      overMs += pass.overMs;
      if (pass.held) {
        clearing = pass.chain;
        clearingLate = pass.registeredLate;
        heldMs = pass.heldMs;
        releasedAt = pass.releasedAt;
        break;
      }
      passesLeft--;
      // A cancelled clear is gone at once. One left to pop -- no bubble, or a
      // cancel the count did not confirm -- takes its tsums off one by one
      // from the release (`popPerTsumMs`), and a chain planned over them
      // stalls on tsums already going.
      const fast = pass.cancelled > 0 && pass.confirmed !== false;
      const notBefore = fast ? Date.now() + cfg.fillMinMs : Math.max(Date.now(),
        pass.releasedAt + Math.max(cfg.fillMinMs, pass.popMs + cfg.popTailMs));
      fullBoard = gastonAwaitBoard(ts, notBefore + cfg.fillWaitMs, notBefore).full;
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
  // A short held chain fills nothing worth waiting on (`chargeMinChain`),
  // and once the clear is over neither does the spam (`chargeTailMs`): the
  // play loop's chains fill the rest. The late count, when the counter read
  // one, is what popped; the first read can come before the game caught up.
  const chargeFrom = Date.now();
  let charge: GastonCharge = { taps: 0, ready: false, onBoard: onBoard };
  let spamUntil = chargeFrom;
  if (onBoard && clearing >= cfg.chargeMinChain) {
    const popping = clearingLate !== null && clearingLate > 0 && clearingLate < clearing ? clearingLate : clearing;
    spamUntil = Math.min(chargeFrom + cfg.gaugeWaitMs,
      releasedAt + popping * cfg.popPerTsumMs + cfg.chargeTailMs);
    charge = gastonSpamSkill(ts, spamUntil);
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
    // What the game's counter said each of those chains linked, in the same
    // order (chainCounter.ts); null where the counter did not read. The
    // table a drag setting is judged by: `registered` well under `chains` is
    // the drag the game did not follow, whatever the route looked like.
    registered: registered,
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
    // Passes whose cancel the tsum count did not confirm (`cancelDrop`); their
    // refill gates waited out the pop. `skill.gaston.pass` has `confirmed`.
    missed: missed,
    // Other colours' chains drawn beside short Gaston ones (`mixedChains`).
    extra: extra,
    // Time the drags spent waiting on the game's MOVE acks beyond their
    // dwells, summed -- `skill.gaston.pass` has it per drag.
    overMs: overMs,
    // Drags the finger came up from at the head -- each one is a
    // `skill.gaston.pass` with `chain` 0, `dead` saying whether the head
    // painted nothing, and `rise` what the read saw. One a window or so is
    // the cluster's frontier being caught; every drag is the read failing,
    // and a window that keeps reading nothing has stopped reading.
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
    // How long the spam was allowed: `gaugeWaitMs`, or less once the held
    // chain's clear should be over (`chargeTailMs`).
    spamBudgetMs: spamUntil - chargeFrom,
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
  // The play loop's chains between windows read the counter too, so the
  // same boards say whether its drag registers where the window's did not.
  readsChainCounter: true,
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
