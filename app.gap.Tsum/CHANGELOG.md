# Changelog

All notable changes to the Tsum Tsum script. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

**One section per version, named for `package.json`'s `version`.** There is no
`[Unreleased]`: an entry goes under whatever version the package is on, and
bumping the version is what opens the next section. Cutting a release does not
close one -- `npm run release:*` publishes the section for the version it built,
and later work on that same version reopens and republishes it.

**`### Summary` opens every section, and it is the user-facing changelog.**
`npm run release:*` reads those bullets and nothing else to fill the `Message`
field of the catalogue entry -- the release note a player reads on a phone, in a
card a few lines tall. A bullet is:

- **one line**: a sentence, no sub-bullets, no wrapped paragraph;
- **one bullet per feature, not per change** -- a new skill is "Coronation Day
  Elsa skill added", and a later round of work on it is "Coronation Day Elsa
  skill improved by making clears faster". Every pass over the same feature
  folds into that one line; *how* it was done belongs in the sections below;
- about **what a player sees or does** -- a setting, a screen, a stats column,
  behaviour they would notice. If it can only be said in file, key or API names,
  it is not one;
- **never internals**: refactors, tooling, docs, detection plumbing, tests, and
  build or release machinery all stay below.

Keep the list short enough to read on that card; over `MessageMaxChars`
(`config.json`) the release refuses rather than shipping one that scrolls.

The sections under it are the internal record, for whoever works on this next:
everything that changed, user-facing or not, **one or two lines each** -- what
changed, and the one fact that explains why. Measurements, rejected designs and
long reasoning belong in the design docs (`OBSCURED_BOARD.md`, `LOGGING.md`,
`DRIVING_SCREENS.md`, `PAGE_DISPATCH.md`, `DEVELOPMENT.md`).

**Two things are filed elsewhere.** Versions before 1.0 are in
`CHANGELOG_0.x.md`. Coronation Day Elsa's entries go in `CHANGELOG_ELSA.md`
while she stays off the production build, so her work does not reach the
release note; they fold back in here when she ships.

## [3.0b]

### Summary

- New "Wait for Settle" setting on the Skills tab: once the gauge fills, waits up to a chosen number of milliseconds (steps of 200) for the board to refill before firing the skill, popping bubbles into a board still moving as the Bubble Strategy allows, so it goes off on a full board rather than a half-empty one.
- Bubbles are no longer popped the moment they appear or right after a skill fires, when the burst has left nothing round them to clear; the Bubble Strategy spends them once the board has refilled.
- Gaston skill improved by drawing the longest chain the board allows in each window pass over the tsums the game itself shows to be Gaston (read off the highlight it paints the moment a Gaston is touched, so a chain no longer runs into a stray tsum and stops), over hops that cross no other tsum so the game neither links nor unlinks one on the way, with a chain begun on a stray tsum lifted at once and another start tried, by holding the window's last chain until the skill has run out so its clear charges the next activation, letting it go the moment the antlers leave the screen, by opening the next window the moment that charge fires (never a second activation inside a window), by keeping its chains clear of the fever's end, where the game briefly stops linking, by drawing each chain at a pace the game links whole and picking a chain back up where it stopped when a link fails mid-drag, by holding a chain it has no bubble to cancel for the next activation rather than waiting for it to clear, and by keeping its chains clear of the bubbles resting at the bottom of the bowl, where a chain used to stop dead, and popping them after a chain like any other, or on their own when they pile up, and by clearing the other tsums off a crowded board so the refills come back as Gaston; the round plays as normal until his first activation, with bubbles saved for the windows from then on.
- The score tally's count-up is tapped through whether or not round stats are being recorded, so the next round starts sooner.
- Box Buying can buy the Pick-Up Capsule: pick it under "Box to buy" and the sweep buys from the capsule while one is on sale, opening each and closing its prize, whether a tsum or an item, closes the Last Prize the final capsule hands out, and stops once the capsule is sold out.

### Added

- **`BoxType.Capsule` -- the Pick-Up Capsule under "Box to buy".** It shares
  the store's limited-time tab with the Select Box, so `readBoxTabs` reads
  the tab's icon (`BoxStore.capsuleIcon`: the machine's red base, either side
  of its gold plate) and reports `limited` -- `capsule` or `select` -- which
  `openBoxTab` puts in the slot; a player who picked one never buys the
  other. The capsule sells singly, so any size buys one at a time. Its
  confirmation (`ConfirmPurchaseCapsulePage`) is retuned to today's "Left: N"
  dialog on the cyan bands instead of the dome gradient; the reveal loop taps
  through "TAP! OPEN!" and the ~9s spin blind, and closes either the reveal
  card (a tsum) or the game's GET! dialog, `EventGift` (an item), which it
  now treats like the card. The last capsule follows its GET! with "Last
  Prize!" over the store -- the same dialog, another title -- which the first
  device run stuck on: `EventGiftLastPrize` (`EventGift`'s `lastPrize`
  configuration) carries the GET! entry's chrome with two probes on the wider
  title, thresholds sized to the sparkles that play over it, and the loop
  closes it like the rest. The sold-out store reads as it does for a box (the
  tab's ribbon stops above the icon probes; the button is blue), so the next
  pass ends on `box.soldOut`. The tab read, the confirmation, the spin and
  the GET! Close ran on MuMu; the Last Prize entry and the sold-out pass are
  proven on the device's own captures only.

- **`src/chainCounter.ts`: every measured drag reads the game's own chain
  counter.** The number the game draws beside a chain's head is its outline
  (`game_num_48_blue` over the white plate) boxed off a navy mask, sampled to
  a 20x28 grid and scored against `ChainDigits`, templates the development
  toolkit's `chain:digits` renders from the sprite itself. Read with the
  finger still down, `settleMs` after the last MOVE. Gaston's passes log it
  as `registered` beside `chain` (and `skill.gaston.done` lists both), with
  `counter` saying where the number sat and what else was on the frame, and
  `registeredLate` a held chain's count again before its release; the play
  loop's chains log `board.chainDrawn` under a skill that sets
  `SkillHandler.readsChainCounter`, which Gaston does. Nine recordings of his
  drag were tuned without this number ever being in the log; the dwell is the
  first thing to measure with it, and **`SettingKey.DragDwellMs` on the Debug
  tab (never shared)** sets it for those drags without a rebuild -- 0 keeps
  each drag's own. Never run on a device.
- **`SettingKey.BoardModel` and `SettingKey.ClusterFragments`, on the Debug
  tab, never shared.** Two board-scan experiments, both off by default and
  neither run on a device, measured on `gaston_8.mp4`'s paint-labelled boards
  (`BoardModelConfig` in `src/pathfinding.ts`). *Radial* adds the rim drop --
  how much darker a tsum's rim is than its centre, read off the light blur on
  `RimDisc` -- to `distance3D` at weight 0.5, merges at 50, and runs three
  k-means passes over the greedy clusters (`refineClusters`): the foreign
  tsums in Gaston's cluster halved at the same recall. *Merge cluster
  fragments* folds each small cluster (at most 34% of the larger, centres
  within 80) into the nearest big one down to the round's type count
  (`mergeClusterFragments`): on ordinary-play frames the four kept clusters
  hold 88-94% of the circles instead of 72-82%. `SkillHandler.boardModel`
  lets a skill name its model over the setting (`skillBoardModel`); nothing
  does yet. `TsumPoint`/`TsumCluster` carry `drop`.
- **`SettingKey.SkillSettleMs`.** `useSkill` runs `settleBoard` with the
  setting as the budget and no floor between the gauge read and the activation
  tap, ahead of the fever hold-off and `beforeActivate` -- the tap goes out the
  moment the tsums have landed, or at the deadline. Milliseconds rather than
  fractional seconds because a share code carries whole numbers. Live (`Now`,
  read per activation), in share codes, presets and the stats CSV, and a Run
  order chip when set. With it on, `maybeAutoTapSkill` stops blind-tapping
  `bareTapActivates` skills and reads the gauge instead, since a blind tap
  cannot wait for the board. `skill.use` carries `settleMs` (what the wait
  took) and `settled`.
- **`settleBoard` takes an `onMoving` callback**, run once at the first reading
  that shows the tsums moving. The settle look above uses it to
  `popGameBubbles()` -- the Bubble Strategy's own budget, under the same
  hold after an activation as `link` -- so a board found refilling gets its
  bubbles spent into the drop, and a board already still keeps them.

### Changed

- **The tally's count-up tap is a dispatch handler, not `waitForScorePage`'s.**
  `dismiss.tallyCountUp` fires on every look that names the tally -- the play
  loop's, a chore's, `navigate`'s -- where with stats off nothing aimed a tap
  at the count-up at all, only `nav.move.exit`'s Close at a button not yet
  drawn. `record.tallyRow` (`readTallyRow`) reads the button row, the medals row
  and Play off one frame into `Tsum.tallyRow`; the count-up tap, the Play
  shortcut (`nav.move.tallyToGame`, which used to capture its own frame through
  `tallyPlayShown`) and the stats read (`roundMedalsRow` is gone) all read that.
  Each tap logs `page.scorePage.skipping` and is followed by a settle, so the
  next look reads the finished row; `stats.tallySkipped` still sums them.
- **Gaston's route is the longest path over the Gastons, from wherever it
  starts.** `gastonChain` runs `findLongestTsumPath` over every component of
  the free board under `GastonConfig.searchSteps`. The snake from a top corner
  (`gastonSnake`, `gastonRows`, `gastonHops`, `rowGap`, `rowHeight`,
  `snakeSteps`) is gone: on the device a route forced from the corner ran
  upward into dead ends, into bubbles and back over itself, and the game
  stopped linking there. Replayed over 725 logged boards it plans 15,917 tsums
  to the snake's 15,743. `skill.gaston.pass` carries `bubbleAt`, the bubble
  centres, so a hop across one can be checked offline.
- **Gaston's route is planned over the tsums the game paints, from the head
  the finger is on.** `gaston_8.mp4` aligned to its log: the colour cluster
  held Donald, the Cheshire Cat and an orange tsum on most boards under the
  fever tint, every route through one stalled or lost its head (the six held
  chains registered 7-19 of 24-37), and the head check's eight far probes
  were mostly those same tsums, so it read live heads dead 27 times in 40 and
  each lift popped a chain of three. Now `gastonLinkChain` lands on the head,
  waits `paintMs`, and reads every circle's floor rise (`gastonFloorRead`,
  `paintRise`): what rose is Gaston, the route is `gastonChainFrom` over
  those, a head that painted nothing is lifted with one tsum under it and the
  pass tries another (`deadRetries`). No read inside `paintBlackoutMs` of the
  close; a pass that cannot read plans off the last read's leftovers
  (`gastonCarry`, `carryMatch`, pruned by each cancel's blast), else the
  cluster. `skill.gaston.pass` now logs the whole scan as `board`, with
  `painted`, `head`, `source` and `carried`; `deadAt` is gone.
- **Gaston's hops cross nothing.** The game links along the line between two
  MOVEs and takes a line back over the previous link as undoing it (a 37 planned
  registered 7 that way). `gastonNeighbors` keeps only hops whose segment
  passes no other tsum's centre within `crossAvoid` nor a bubble; replayed over
  103 logged boards the routes plan 99.5% of the unfiltered length.
- **Gaston's drag starts from the route's higher end.** `gaston_7.mp4` aligned
  to its log: five of seven dead drags began on a leftover at the bottom of
  the pile, where a longest path's tip lands. `gastonOrient` draws from the
  higher end, an end touching a known leftover losing (`frontierAvoid`).
- **Gaston's window is two cancelled chains, then one held through the
  close.** A chain released while the skill still runs charges nothing, even
  the part of its clear that pops after the close, so after `passesBeforeHold`
  cancelled passes the next chain's finger stays on its last tsum until
  `holdPastCloseMs` past the estimated close (`gastonLinkChain`), and from the
  release the button is spammed until the gauge reads full (`gastonSpamSkill`,
  replacing `gastonAwaitGauge` and the chain drawn after the close). Bubbles
  are the skill's from the first activation to the tally
  (`claimsBubbles` off `roundStartedAt`) and the Bubble Strategy's before it;
  the cancel spends every bubble (`bubbleReserve` 0, since each activation
  leaves one), the one over the most leftovers first (`gastonBubbleWorth`,
  logged as `near`). `skill.gaston.pass` carries `heldMs`; the done record
  carries `heldMs`, `releaseLeadMs` and `spamTaps` in place of `charged`.
- **The hold after a skill activation is two seconds from the tap, not one
  scan.** `GameBubbleConfig.holdAfterSkillMs` replaces `settleScansAfterSkill`.
  `useSkill` stamps it at the activation, so an auto-tapped skill is covered
  too (only the play loop's own path stamped the old one), and
  `bubbleTapBudget`, `link`'s per-chain pops and the All Bubbles ASAP sweep
  all honour it (`bubble.heldAfterSkill`). A blind-tapped burst reads the
  button once after the tap while bubbles are on the board: still Active means
  it fired, so the hold is stamped and the scan's bubbles dropped
  (`skill.blindTapFired`). A skill's own pops and sweeps are untouched.
- **A bubble is held for a second after it is first seen**
  (`GameBubbleConfig.minAgeMs`). The blast count is one frame's reading, and a
  burst's bubble first shows mid-clear, where it can read surrounded over a
  hole -- Ariel+ popped hers the instant she made them. `trackGameBubbles`
  carries sightings across scans by position (`GameBubble.firstSeen`), and the
  unripe release is per bubble by age (`unripeReleaseMs`, 3s) instead of five
  consecutive scans. `bubble.found` and `bubble.unripe` carry `age`.

### Fixed

- **Gaston's route is the board's biggest colour cluster, and nothing else.**
  The palette -- learned by size on the window's first board, matched by colour
  after -- is gone with `gastonPalette`, `paletteShare`, `paletteMinShare`,
  `paletteDistance` and the pass record's `palette`. A recorded round read
  chain by chain (`gaston_2.mp4`) had ten of 21 chains start on a leftover the
  palette had admitted, by size on a board still half leftovers or by colour
  within the scan's merge distance, and link one to four tsums of 17-33
  planned; a fever-tinted board also left one window scanning 18 passes at 4
  matched tsums. A route over one cluster is at worst a chain of one leftover
  colour.
- **Gaston's drags stay out of the fever switch, where the game stops
  linking.** The game takes no link for 0.5-0.75s as the fever backdrop
  switches, and a drag under way loses its head there: `gaston_4.mp4` had 33
  planned register 11 with the drawn line frozen for 1.1s, and `gaston_6.mp4`
  had the fever's exit land inside four of eight held chains (13, 9, 14 and 24
  of 32, 22, 24 and 30 planned), two of which then never filled the gauge. The
  exit is predictable -- the backdrop comes on 1.3s after the tap as the face
  fades (`faceMs`) and stays exactly 8.35s (`feverMs`, nine of nine) -- so a
  drag that would straddle it waits for the switch and the freeze behind it
  (`gastonAwaitSwitch`, `switchFreezeMs`), and a switch seen just before any
  drag holds it the rest; the backdrop is read as the chrome beside the score
  not being its plain-board colour (`plainChrome`), since each fever theme
  paints its own there. Two approaches to the freeze came first. A synchronous
  MOVE at the host (`moveTo`'s `wait` flag, Gaston's `pacedMoves`) on the
  theory that the UI thread blocked and the moves batched: measured at ~2ms a
  hop with the chains dying all the same, so the freeze is the game's own; the
  flag is off. And a probe of the coin the game draws on a
  linked tsum, with a hold on a miss, which lost more than it saved
  (`gaston_5.mp4`: 13 chains in a round where the one before drew 23) -- the
  scan's centres sit ~14px off the sprites, and the game reads a finger
  returning to the previous tsum as undoing the last link. `stepsPerHop` is 0:
  a midpoint sample linked neighbours out of order. `skill.gaston.pass`
  carries `dragMs`, `overMs` (the wait on the game beyond the dwells),
  `waitedMs` (the hold-back from a switch) and `fever`. `GastonConfig.dodgeSwitch`
  false turns the hold-back off while the backdrop is still watched, so `fever`
  still says which drags went out under one.
- **Gaston's charge opens the next window itself, and no activation goes out
  inside a window.** The spam tap's read of a full gauge was handed to
  `useSkill` for the tap, but once the button has fired the empty gauge
  behind its flash reads empty, so `useSkill` saw no activation and the play
  loop played the window: `gaston_6.mp4` had it chain a Gaston board for
  eleven seconds, and once fire a second activation four seconds into a
  window, wasting the rest of it. `afterActivate` now runs `gastonWindow`
  after `gastonWindow` while each charge fires the next, anchoring each at
  the read that saw the gauge full and logging `skill.use` with `charged`;
  and `SkillHandler.stillRunning`, which Gaston answers until the window can
  have closed, makes `useSkill` and `maybeAutoTapSkill` leave a full gauge
  alone (`skill.stillRunning`). The spam loop stops when the round ends under
  it, and a pass whose scan reads well under the board the gate just saw full
  rescans for up to `flashRetryMs` (`rescans` in the pass record) -- the fever
  label's flash read 29 of 40 and drew a chain of 5.
- **Gaston's drag is the play loop's, 10/10/10 and unpaced.** It dwelt 40ms
  a tsum with a paced MOVE for a while, on `gaston_3.mp4`'s finding that an
  18ms dwell registered 279 of 456 planned -- measured on the snake route,
  whose reach-length hops and back-crossings the crossing-free route has
  since removed. At 40ms a thirty-chain was 1.3s and the window's three
  passes outran its six seconds: the device log of 2026-09-21
  (`muc2hht99b`) had the closing drag out 1.2-3.8s past the close in every
  window, while the play loop's 10ms chains ran the same Gaston boards
  whole between windows. A thirty-chain is ~0.35s.
- **A Gaston chain with no bubble to cancel it is held when its pop would
  refill past the close.** The pass used to wait out the pop
  (`chain * popPerTsumMs + popTailMs`, 3.4s for a thirty) and draw the next
  chain on the refill; past the close that refill is leftovers. Three of six
  windows in `muc2hht99b` lost their charge that way, and the next
  activation then opened on a full board of leftovers. `gastonLinkChain`
  now asks a `holds` rule at the head -- the tail, or no bubble and the pop
  running past `closesAt` -- in place of `cancelBefore`.
- **Gaston's cancels no longer tap the HUD buttons.** The hem the bubble
  capture runs below the play square brings in the two round buttons under the
  bowl, read as bubbles on every pass; `hemButtons` names them and
  `gastonNotButtons` drops them, so a cancel lands on a bubble in play and a
  pass with none waits out the pop.
- **Gaston's routes keep clear of the bubbles resting on the bowl.** Four
  recordings at dwell 10/20/34 (2026-09-21), the planned route drawn over
  the frames: every chain that died mid-drag died on a bubble the pass had
  not read -- the Hough pass loses the resting ones under the rim lights, the
  scan reads a bubble's icons as a tsum, and the paint read passed it.
  `gastonBubbles` now adds a second Hough at `bandParam2` over the bowl's
  bottom (`band`) and the round's memory of every read
  (`gastonRememberBubbles`, `soft`), both planned round. The pass record
  carries `band`, `soft` and every circle's paint `rises`. Clean routes
  registered whole at 10ms, so the dwell was not the lever. The first run on
  this charged 13 windows of 18 (5 of 23 before); `bubbleAvoid` was 1.4
  widths for that run and cut a full board into routes of 4-13, so it is
  back at 1.0.
- **The band's bubbles are tapped as cancels.** They were `soft` too at
  first, and the resting ones stood untouched: over six runs on 2026-09-22,
  30 of the 35 chains released without a cancel had bubbles on the board,
  all soft, 66 of the 78 in the band and read hard by the next pass often
  enough. `gastonCancelBubble` and the no-bubble hold now count the band's
  finds (`gastonTappableBubbles`); only the memory's stay untapped, since a
  remembered bubble may have rolled when a clear went out from under it.
- **A starved carry falls back to the cluster.** The window's first read
  finds a board of leftovers; the first clear slides them into the positions
  the carry remembered and the Gastons that land read as leftovers too, so
  221 of 291 passes that day planned nothing and six windows of 23 drew no
  chain at all. A pass whose carry leaves nothing plans from the colour
  cluster and drops the carry until the next read (`starved` on the record).
- **Gaston's window checks each step instead of assuming it.** On
  2026-09-23 (`mudehgre4r`) three passes went uncancelled with a remembered
  bubble on the board, and six charges failed. After each failed charge the
  next activation opened on leftovers, and it took windows to recover. A
  cancel is now checked off the tsum count (`cancelDrop`). One that did not
  take taps the remembered bubbles too, then waits out the pop instead of
  planning over it. The charge stops spamming once the held clear is over
  (`chargeTailMs`), and a short chain is followed by other colours' chains
  (`mixedChains`).
- **Gaston's chains without a paint read are planned over his colour cluster,
  less the carry.** `gaston_100.mp4` (2026-09-23), aligned to its log, had
  three of four failed charges on held chains planned without a read over
  tsums that were not his. The carry alone took everything dropped since the
  read for Gaston, so two ran through Lotsos and Stitches. On the third,
  reads had been switched off after three lifted heads that *had* painted.
  Now only heads that painted nothing (`blank`) switch reads off, as the
  header always said.
- **Gaston's pass scans again after waiting out the fever switch, and a missed
  cancel reads the board again.** `gaston_101.mp4` (2026-09-23) charged 5 of 7
  windows. One failure was a held chain drawn 1.5s after its scan: the pile
  had moved, and it linked 7 of 19. The other was a cancel tapped on a tsum
  the band pass took for a bubble. The real bubble sat beside it, and the
  36-chain popped slowly through the close. A wait over `replanAfterWaitMs`
  now rescans, and an unconfirmed cancel taps whatever a fresh read finds
  (`freshTaps`). The refill gate after an uncancelled pass now also waits
  out the extra chains' pops (`popMs`).
- **Gaston's no-bubble hold is judged against the earliest close, and a read
  route keeps his tsums along the top.** `gaston_102.mp4` (2026-09-23)
  charged 6 of 7 windows. The skill closes at tap+9.65s (the antler backdrop
  went at 9.60-9.72 in all seven); `closesAt` puts it 1.0-1.65s later. The
  one miss was a 29-chain with no bubble, judged to pop out before that late
  close: it went unheld and refilled with leftovers. Both holds now use
  `refillBy` (tap + `openMinMs` + duration). The HUD band also cut the
  Gastons joining a pile's halves (6 planned of 14 painted); painted circles
  are now cut only above `paintedHudBand`, 8% more planned over 153 passes.
- **Gaston's drags wait out a fever starting or ending.** Checked on video,
  `gaston_102`-`104.mp4` broke most chains short, about a third of them at a
  fever's start or end, which the antlers hide from the chrome probe. The ring
  round the fever gauge shows both: a drag now waits `feverStartMs` past it
  lighting, and for it to go dark when the fill says the fever ends inside
  the drag (`dodgeFever`, `feverWaitMs` on the pass record). Off by default:
  `gaston_105.mp4` broke as many chains with it on, and its waits cost time.
- **Gaston keeps a bubble for the next cancel.** `gaston_107.mp4` spent 2 and
  3 bubbles cancelling chains of 4 and 5; two held chains then had none and
  the next window's 29-chain went out uncancelled. A chain under
  `cancelMinChain` now spends no bubble, and a cancel leaves one standing
  (`bubbleReserve` 1; `spared` on the pass record).
- **Gaston's drag dwells 30ms a tsum (was 10).** On BlueStacks, `gaston_102`-
  `103.mp4` at 10ms linked 17 of 41 chains whole; `gaston_104`-`108.mp4` at 30
  linked 44 of 75 (73-87% of planned tsums against 57-67%).
- **Gaston's drag picks a stalled chain back up.** About 1.8% of hops fail
  at random, breaking ~40% of thirty-chains. Every 4 tsums and at the end, a
  capture looks for the game's gold coin on the tsums behind the finger; with
  none on four, the finger walks the route back to the last coin (the undo
  unwinds the chain to there) and draws on (`rewind`, `rewinds` and `coins` on
  the pass record). A stall that comes back at the same place is the route's
  (`gaston_111.mp4`: three of four redraws stalled where the first had), so it
  is planned afresh from the chain's end without the failing tsum, or the drag
  stops there; no walk back runs into the close.
- **Gaston's closing chain goes out at once and lets go as the antlers leave.**
  The switch wait held it 0.8-2.6s past the close on `gaston_108`/`109.mp4`,
  and the hold ran to `closesAt`, 1.0-1.6s late. The antlers stay up 8.4-8.6s,
  so the close is timed off them (`antlerMs`); the chain is cut to end
  `closeLeadMs` before it (drags over the close broke 5 of 7), held, and let go
  `antlerReleaseMs` after the antlers leave the chrome. `dodgeSwitch` is off.
- **Gaston's coin check no longer throws mid-drag, and a throw lifts the finger.**
  It called `getImageWidth`, which `globals.d.ts` declared but the host does
  not have: every drag of 12+ threw with the finger down (`gaston_110.mp4`),
  and five in a row restarted the app. `globals.d.ts` now declares only what
  the host registers (12 phantom natives dropped), and `gastonLinkChain` lifts
  the finger on any throw.
- **Gaston's play-loop rules start at his first activation.** `chainLimits`
  (one uncapped chain a scan), `extraClusterSlots` and `readsChainCounter`
  (the Debug dwell and a counter read per chain) held from the round's start,
  so the loop chained almost only Gaston before the skill had ever fired, and
  `gaston_112.mp4` redrew the same three short chains for 15s. All three now
  follow `gastonActivated`; `SkillHandler` takes a function for the last two.
- **Gaston's windows spend spare bubbles.** An uncharged window hands the
  board to the play loop, which keeps its bubbles for the windows; the windows
  spared every chain under `cancelMinChain` and never popped on a pass with
  no chain, so `gaston_113.mp4` had ten along the bottom by the fourth window,
  refills with no room and 29 of 44 passes drawing nothing. From
  `surplusBubbles` (3) every release is cancelled, and a pass with no chain
  pops all but the reserve (`popped` on `skill.gaston.done`).
- **Gaston's windows clear the other tsums off a crowded board.** Other
  colours' chains went out only after a Gaston chain under 15, four at most
  inside 600ms, and never on a pass with no Gaston chain -- 26 of those in
  `gaston_113.mp4` lifted the finger on boards of 20-odd leftovers. Now a
  board with `mixedFrom` (15) leftovers gets them too, every chain that fits
  in `mixedChainMs` (1000) top of the pile first, and a pass with no Gaston
  chain clears them instead (`gastonClearLeftovers`, `skill.gaston.clear`),
  all while their refill still lands as Gaston. A cancel is judged on the
  whole clear, not the Gaston chain alone.
- **Gaston's window holds its closing chain whenever another would not fit.**
  A chain was held only when it ended inside 800ms of the earliest close, so
  on `gaston_114.mp4` four windows of ten cancelled a second chain that ended
  just short of that and drew a third after the antlers had gone -- released
  0.5-1.8s late, each window 1.5s longer. Now a chain is held when the next
  pass (`nextPassMs`, 1.5s, plus a drag as long) could not end before the
  close. A drag stopped mid-route also reports what it linked, not what was
  planned, so its pop wait and the charge are judged on that (one window
  there waited 4s on a 33-chain that had linked 12).
- **Three native-image throw windows closed.** The host keeps every capture
  until `releaseImage`, so a native throwing between a capture and its guard
  leaked a frame for the rest of the run: `buildBoardGray` and `tiaraCapture`
  now release on a throw before the return, and `scanBoardQuick`'s overload
  tap moved inside its `try`. Nothing leaked on a normal path.

## [2.1b2]

### Summary

- The script no longer sits on the game's pause menu flipping the Gyro switch when a chore starts during a round; the chore waits for the round instead.
- Max round duration: once it stops playing a long round it now waits for the game over screen however long that takes, instead of picking the round back up after a few minutes.

### Fixed

- **A capped round is left alone until it ends.** Coasting gave up after three
  minutes and handed the task back, and the next pass found the board still up,
  restamped the clock and played on -- so a round the cap had stopped was played
  again in stretches for hours. The give-up is gone: a coast ends only on game
  over or a stop, and `play.roundCoasting` (`ranMs`, `coastedMs`) goes out once
  a minute so a long one is visibly alive. `play.roundCoastGaveUp` is retired.

- **The pause menu's Gyro toggle is no longer tapped once a second.**
  `Page.GamePause.back` sat on the Gyro switch (318,1078), and `PageRoutes`
  declared it an exit, so a `navigate` with any goal but the board -- the
  mailbox or heart chore starting while a round was up, which only stood aside
  for the pause menu -- pressed Pause and then toggled the gyro every pass until
  the stall guard restarted the game (`gyro_stuck.mp4`). The pause menu now
  declares no exit (its other buttons forfeit the round), `back` names To Home
  Screen, and every chore stands aside for a round in progress through
  `roundInProgress` (`src/pages.ts`), logged as `task.stoodAside`.

## [2.0]

### Summary

- Version bump from 1.0 to 2.0
- "Auto Unlock MyTsum Level" setting added: when the level-up screen after a round shows "Raise level cap!" on your MyTsum, the script buys that one raise from the Tsum list and plays on.
- "Hold bubbles last fever seconds" setting added: leaves bubbles alone while a fever is about to end, so they are there to pop into the first chains after it and start the next fever sooner.
- Bubbles are popped once tsums have refilled around them, so one a burst skill leaves is no longer spent on the empty space it left.
- Skip Ruby now works like Skip Medals: rubies are left in the mailbox and the mail under them is still taken, instead of the chore stopping at the first ruby.
- Skip Medals / Skip Ruby no longer open the last mail on a scrolled screen, which on a full medal box left the chore opening the same medal over and over.
- Box Buying no longer stalls on the "You got a Patch!" popup a purchase can come with: it is closed like the reveal card and the sweep goes on.
- Box Buying handles the store refusing a 10-Time purchase on a nearly empty box ("You can't use 10-Time Purchases"): the sweep ends there instead of retrying into it, and the new "Ten, then one until sold out" size carries on singly to empty the box. "Buy ten at a time" became the "Boxes per purchase" dropdown.
- Auto launch finds the Japan game on its own: whichever build is installed is the one started, so nothing has to be set for it. The stats CSV gains a `build` column.
- The selected tsum is named as the running game prints it: in English on the international game, in Japanese on the Japan game.
- The JP game's Magical Time offer is now recognised and cancelled like the EN one.
- Debug tab: a Detect MyTsum button reads which tsum the pre-round screen shows selected, without playing a round.
- Rounds turn over faster: the score tally's count-up is tapped through instead of waited out.
- Round stats: a medal count with a 0 in it is no longer left blank.

### Added

- **`SettingKey.AutoUnlockMyTsumLevel`** (Chores tab, Beta). `record.myTsumLevelCap`
  reads the level-up panel's first card off `LevelUpMyTsumCard` (`src/data.ts`):
  the card is found by scanning the gutter column for panel blue -- the stack
  is still bouncing into place on the frame the router first names, and a
  fixed row read the "Lv" text as the padlock -- and the padlock's white body
  read at its middle. `raiseMyTsumLevelCapIfPending` (`src/levelCap.ts`) runs
  from the play task's tail: to the collection, the greyed "MyTsum Set" button
  proves the panel shows the MyTsum, then the sweep's own raise
  (`raiseSelectedLevelCap`, split out of `raiseCardLevelCap`). A failed raise
  holds the next attempt off for 30 minutes. Live (`LiveWhen.Now`). Proven
  on 14 level-up and 3 collection frames through the bundle; not yet on a
  device -- `unlock.myTsum.*` is what to read.
- **`SettingKey.HoldBubblesLastFeverSec`.** A hold over every Bubble Strategy
  rather than a fourth entry: `bubbleTapBudget` answers 0 while
  `bubblesHeldForFever` (`src/board.ts`) holds, and the All ASAP blind sweep
  stands down too; the strategy resumes when `gFever` calls the fever over.
  Live (`LiveWhen.Now`), shared, a stats column, and a Run order chip.
  `bubble.held` logs each refused pop with the fever's remaining ms.
- **`Tsum.feverRemainingMs` (`src/fever.ts`), `FeverBar` (`src/data.ts`).**
  How long a fever has left, off a ~2.4ms crop of the bar's fill taken per
  pop, the way `checkSkillReadinessFast` reads the gauge -- twenty samples at
  y=1670, lit above a value of 150, each worth 500ms. Read at the moment it
  is asked rather than estimated from the watcher's last look, so a fever the
  game has paused under a skill animation reads as paused. Gated on
  `gFever.active`, because an ordinary full gauge is just as bright. Measured
  on the six corpus fever frames.
- **`Tsum.gameBuild` (`src/appLifecycle.ts`), `GameBuild` (`src/globals.d.ts`).**
  Which build this device plays: the one in front (`focusedGameBuild`, off the
  same `dumpsys window` line `isAppOn` reads, now shared as `focusedPackage`),
  else the one last seen in front, else the one installed (`installedGameBuilds`,
  one `pm path` per package, at most once a run). Both or neither installed
  answers global. `app.build` logs the installed-package read.
- **`BoxTenTimeRefused` (`src/data.ts`).** The "You can't use 10-Time
  Purchases" toast, `targeted` like `LevelCapRaised` because it is the
  `HeartSent` sprite -- a sweep over it answers `HeartSent` -- with one probe
  in the gap between its two lines of wording that refuses both twins.
  Authored on two frames cut from `no_more_10box.mp4`. `Tsum.awaitBoxDialog`
  (`src/boxes.ts`) watches for it beside the purchase confirmation after a
  10-Time press, taps it away, and `buyOneBox` reports `tenRefused`.
- **`BoxPurchaseSize` and `SettingKey.BuyBoxSize` (`src/shared.d.ts`).** One,
  Ten, or TenThenOne, replacing the `buyBoxTenTimes` switch; `loadSettings`
  carries a stored `true` over to Ten once. `buyBoxes` reads it into the
  `tenTimes` it already ran on, which the refusal clears under TenThenOne.
  `Log.Box.TenRefused` records the refusal; `Log.Box.End` reports
  `10-time refused` when it ended the sweep.
- **`BoxPatchPurchasedPage` (`src/data.ts`).** The "You got a Patch!" popup,
  a `patch` configuration of `BoxPurchasedPage`, so `clearBoxReveals` taps
  its Close. The reveal card's entries missed it on the two probes that read
  that card's lit backdrop, which is near-black here; the loop then tapped
  its blind advance point for the whole reveal budget. Authored on a frame
  cut from `premium_plus_badge.mp4`.
- **`MagicalTimeJp` (`src/data.ts`).** The JP build draws the dialog at the
  pre-2025 position with three footnote lines under the buttons; the pre-2025
  entry missed it on its Cancel probe, which reads the wider キャンセル glyphs.
  Probes on the flat button ends either side of the text, and a foot probe
  below where the EN panel ends so the two entries stay apart.

### Changed

- **Skip Ruby** (`receiveHeartsSkipRuby`) goes through the row walk Skip Medals
  built: `mailRowToOpen` reads every found row at each badge its switch turned
  on, opens the first row carrying none, and answers `MailAllSkipped` (was
  `MailAllMedals`) when the screenful is all skipped mail, which scrolls on. The
  fixed ruby probe and the idle-out it forced are gone from the loop.
  `gifts.receiveOne.skipRuby` marks each row stepped past;
  `gifts.receiveOne.medalsOnly` is `gifts.receiveOne.skippedOnly`.
- **The Bubble Strategy pops only bubbles worth popping.** `findGameBubbles`
  counts each bubble's `near` -- the scan's tsum circles within
  `GameBubbleConfig.blastReach` past its edge -- and `popGameBubbles`' default
  path takes only those at `minTsumsInBlast` or more, richest first
  (`ripeGameBubbles`, `src/board.ts`), leaving the rest for the next scan. A
  Burst activation is a blind tap that never arms `settleScansAfterSkill`, so
  the bubble it left was tapped in the hole it sat in. Bounded by
  `unripeHoldScans` (`bubbleUnripeScans`, counted per scan) so a misread cannot
  park one; a skill's explicit limit still takes every bubble. `bubble.unripe`
  logs a refused pop, and `bubble.found` / `bubble.popped` carry `near` / `held`.
- **`src/tsums.dat` is `v2`: a name column per build.** English and Japanese
  side by side, blank where that build's pack has no strip (84 Japanese-only,
  38 with neither). `myTsumLoadLibrary` refuses a v1 file; `selectedTsum` names
  the match by the build in front, falling back to the other column, then the
  id. `tsums.identified` / `tsums.detected` carry `build`.
- **`detectMyTsum` (`src/roundStats.ts`).** The Debug tab's Detect button,
  reached by name through `runScriptCallback` like `reportIssue`. Refuses a
  live run (the loop reads the same screen itself), else builds a throwaway
  `Tsum` on the page's settings for the geometry, sleeps
  `DetectMyTsumSettleMs` for the closed panel to leave the frame -- the host
  captures every window -- and answers the `MyTsumSelection` or a
  `DetectMyTsumRefusal` (`src/shared.d.ts`) as JSON. `tsums.detected` is its
  own event so a log reader cannot take a press for a round's read; the
  banner carries the name with score and margin.
- **`askDetectMyTsum` / `onMyTsumDetected` (`src/settings.ts`).** Closes the
  panel the way the Now buttons do, sends the form, and words the answer under
  the row (`tpl-detect`) in the page's language, so it is there when the
  panel is reopened.
- **`skillWaitOutEndingFever` reads its fill geometry off `FeverBar`** instead
  of its own 345/733 constants; the measured fill runs 350-705, so the
  "nearly over" mark moves by a few px.
- **`waitForScorePage` taps the tally through its count-up
  (`src/roundStats.ts`).** A tap skips the animation and the game draws the
  final figures with the button row at once; the tap is retried every
  `StatsSkipTapMs` while the row is missing, at the spot the overlay tap already
  uses (`StatsBlindTapSpot`, was `StatsUnknownTapSpot`), which is inert on the
  finished tally and on every panel that can drop over it. Only on a look that
  named the tally, so a panel in front is still cleared by its own handler
  first. `stats.tallySkipped` records the taps and how long the row took.

### Removed

- **`SettingKey.JpVersion`.** Its row had been commented out since the public
  release, so `startApp` always launched the international package and a
  Japan-only device never came up. Launch, the force-stops, `selectedTsum`, the
  stats CSV (`build` column, in place of `jpVersion`), the report manifest
  (`script.build`) and the corpus sidecar (`build`; `load.js` still reads
  `isJP` off old ones) all take `gameBuild()` instead. `Tsum`'s constructor
  loses its first argument.

### Fixed

- **A fever is recognised on the 2025 layout.** `FeverProbes`' two
  dimmed-chrome pixels sat under the gauge, and on MuMu that build ends the
  game in a black band there, so `isFeverTime` was false on every frame and
  `gFever` never went active on that device -- the new bubble hold could not
  engage, and the "No skill last fever seconds" hold-off, whose own backdrop
  probe at (340,310) lands on that layout's gem icon, had never fired either.
  Both now read the chrome beside the score capsule, where
  `LevelUpDimmedChrome` reads; the ring thresholds go to 100 for the same
  frames. Measured on three of the device's own trail frames, filed in the
  corpus as `mumu-360x640-fever*`.
- **`renderPage` now drops `reportPanel` with the other panels.** A language
  change re-renders `#tabPanels`, and the Report row's panel was the one still
  pointing at the detached copy.
- **A scrolled mail list no longer opens the row under the Claim All bar.**
  `MailList.scroll` lands the rows half a pitch out of phase, where the last
  row's Check button is whole but its badge is under the bar -- so the medal
  probe read the bar's cyan, the row went as a heart, and with the medal box
  full the pass tapped the same medal over and over (a JP recording).
  `mailRowToOpen` now leaves a row whose deepest probe falls past
  `MailList.buttonColumn.toY` for the next scroll (`gifts.receiveOne.rowUnderBar`).
  `toY` is 1340, the last list pixel: at 1345 the scan's last sample sat on
  the bar, so a button it cut never registered as clipped. Reproduced offline
  by shifting the medals corpus frame.
- **A medal count with a `0` in it reads.** The tally's medals row draws its
  glyphs 19px tall on the 540 emulator where the coin row's are 20, and at that
  height the `0` led `9` by 0.029 -- a thousandth under `StatsMinGlyphMargin`
  -- so 401, 380 and 400 all went to the CSV blank. `StatsDigits` recut with
  two of those tallies in the sample; the worst lead over the corpus is 0.036.

## [1.0]

### Summary

- Version bump from 0.13 to 1.0

### Changed

- **Log sentences shortened.** Every `message` is written to the log file
  verbatim and the `event` id already names what happened, so the English and
  zh-TW catalogues now carry short phrases; the explanations moved out of the
  log line.
