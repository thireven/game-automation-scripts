# Changelog -- Coronation Day Elsa

Every change to the Coronation Day Elsa skill, and her Legacy twin (removed in
3.0b5), from 1.0 on. Kept out of `CHANGELOG.md` because she was not on the
production build and that file's `### Summary` ships as the release note. She
is Production as of 5.0a2, so new work goes in `CHANGELOG.md`; her Summary
lines below still fold back into that file's. Her pre-1.0 history -- she was added in 0.6 -- is in
`CHANGELOG_0.x.md` with everything else of that time. From 6.0b33 she plays as
Burst and her own skill is gone (`CHANGELOG.md`).

## [3.0b5]

### Summary

- Coronation Elsa Legacy skill removed; use Coronation Day Elsa.

### Removed

- **`src/skills/coronationElsaLegacy.ts`**, `SkillType.CoronationElsaLegacy`,
  its `skill.elsaLegacy.*` log events, dropdown entry and share letter `E`.

## [3.0b4]

### Summary

- Coronation Day Elsa skill improved: each freeze window opens with a burst of long chains, chains are placed so their ice overlaps, the ice breaks early less often, bubbles are popped all through the window, lookalike tsums are chained less often by mistake and ice-coloured tsums like Dumbo or light-blue tsums are no longer tapped as ice, the whole window is used, and the tap sweep at its end and chains after TIME UP are gone.

### Added

- **The salvo** (`elsaSalvo()`, `salvo*`): twice per window, the first on
  its first look with no ice to touch, up to 4 of the play loop's own chains
  (`calculatePaths`, max 5, full reach) back to back; the careful sweep then
  chains what it left. Firing on every ice-free look made ~5 salvos a window
  and 9 of 16 early breaks followed one. At 0:55 of `02-41-53.mp4` four such chains froze a
  fresh board whole in 0.3s for a count of 72. `skill.elsa.salvo`;
  `salvos`/`salvoChains` on `skill.elsa.done`.
- **Two salvos a window** (`salvos` 2). The second runs on the next look,
  around the first one's ice, and hands over to the sweep if it finds under
  two chains. Picked on a Debug-tab A/B (`elsaSalvos`, now removed).
  `salvo` (1-based) on `skill.elsa.salvo`.

### Changed

- **Ice-alikes match the range they were learned over** (`iceAlikeMatch`),
  not their first read, and only +5 brighter (`valUp`). A light-blue live
  tsum learned at s 100 read s 60-98 in play and was taken for ice on 44 of
  160 scans between windows: 19 leftover breaks tapped live tsums. Replayed
  over six rounds: 318 vs 264 of 432 live reads matched, no ice-like
  cluster (v >= 220, s <= 75) whitelisted. `skill.elsa.iceAlike` logs the
  range.
- **A kind read that darkens nothing clears its colour** (`elsaKindVerdict`).
  A dead chain now only nominates a colour as mixed; its next kind read
  confirms or clears it, and a chain drawn off a kind read no longer
  nominates. 251 of 436 kind reads darkened nothing, and their chains died
  14% of the time against ~9% for sweep chains -- a hop, not a kind.
- **Overlap scoring and the salvo are always on.** Both were A/B tested
  behind temporary Debug-tab settings (`elsaOverlap`, `elsaSalvo`), now
  removed with their strings and flags.
- **Elsa's window matches the game's.** On video the background is light
  blue from tap + 1.77s to tap + 12.18s (32 windows); the script ran
  1.5-11.5s, so its first chain could land under the animation and the last
  0.7s went to the play loop. `leadInMs` 1800, `durationMs` +300 (10300 at
  level 6).
- **Overlap needs room** (`overlapClearPx` 25): only a chain whose drag keeps
  a tsum width from read ice earns its overlap. With salvo and overlap on,
  16 of 164 scored chains were followed by an early break, 2 of 90 unscored.
  Ice broken per window was ~109-130 (game's shatter counts) against ~63-89
  in earlier games.
- **Elsa places bands over standing ice.** With ice read, every row is
  planned and the chain whose band line crosses the most ice wins
  (`overlap`, `overlapBandPx` 18), lowest row breaking ties; ice-free boards
  pick as before. An overlapping band doubles ice without spending the free
  tsums later chains need. `overlap` on `skill.elsa.pass`.
- **Pacing Elsa's chains was tried and dropped.** A band grows with the time
  since the last freeze, so fewer, bigger bands were tested (`chainGapMs`
  and a Debug setting): a 1.5s gap scored 3.7M against 16.0M at no gap.
  Overlap on scored 15.2M at TIME UP against 13.7M off, one game each.
- **The ice-lookalike paint read was tried and removed.** It rested the
  finger on a head and took circles that lightened as live, to rescue pale
  tsums read as ice. On video the game darkens the *other* kinds instead and
  ice stays bright too, so it could not tell a lookalike from ice (0 rescued
  in a round) and its reads cost ~4 chains a window.
- **Elsa reads which tsums are one kind where two share a colour** (`kind`,
  `elsaKindChain`). A cluster that produced a dead chain this round
  (`elsaMixed`) gets its later chains a finger-down read on the head; members
  that darken are another kind, and the chain is replanned over the rest. In
  one round cream Coronation Elsas and pale-pink tsums shared a cluster and
  22% of chains never linked. `skill.elsa.kind`; `kindChains`/`kindLifts` on
  `skill.elsa.done`.
- **A board whose ice hides its tsums is broken, not chained.** Frozen tsums
  drop out of the scan, so a look reading under 80% of the board with 15 or
  fewer free (`hiddenIceFraction`, `hiddenIceFreeMax`) drew chains over
  unseen ice: all 11 traceable unplanned breaks in run mugrir5i9h followed
  one. It now breaks the pile as a frozen-out board; `hidden` on
  `skill.elsa.pass`.
- **No leftover breaks before a round's first window.** No ice can exist
  then, but pale tsums read as ice fired six aimed breaks at nothing in
  one round and were left out of the play loop's chains.
- **Bubbles are popped on every look, ice or not** (up to `bubblePopRounds` 3
  pop-and-recapture rounds). They were popped only on an ice-free look, so
  after a window's first chain -- or from its start, over a leftover band --
  every bubble stood as an obstacle and a hole in the bands. A pop does not
  set the pile off; only a bubble on an ice read (`bubbleIceGap`) is left.
  `postBurstPopMaxIced` is gone. `skill.elsa.pass` logs `popped`/`bubbles`.
- **The paint floor read is shared** (`skillFloorRead`, `skillMedian` in
  `skillCore.ts`); Gaston calls it unchanged.

### Fixed

- **A second run no longer plays a lookalike tsum as ice.** Elsa's per-round
  state (ice-alike whitelist, window flag, mixed clusters) was keyed on the
  round number, which restarts at 1 every run while globals persist. A run's
  round 1 kept the last run's whitelist and never learned its own, and
  treated between-window ice reads as leftover from the start. On
  `dumbo.mp4`, Dumbo (centre hue 86-90 against the box's 88 floor) was half
  read as ice: 21 starved looks and 33 aimed taps in one window. Now keyed
  on `logRoundKey()` (run id + round); Legacy too.
- **Elsa stops at TIME UP.** The game dims the board and no page marks it,
  so two looks in a row whose scan averages under value 100
  (`dimValueMax`, `elsaBoardValue`) end the window with no more taps. Never
  two in a row during play across 2,781 in-window scans; caught 4 of 4
  windows open at TIME UP. `dim` on `skill.elsa.roundOver`.
- **Elsa's closing break no longer sweeps the board.** With under 8 ice read
  it added a blind grid of ~25 taps (1.4s), which the user saw as a bubble
  sweep and which pushed 7 of 25 closing breaks past the window's end. Every
  break is aimed taps only; `blindStep` is gone.

## [2.0]

### Summary

- Coronation Day Elsa skill promoted to Beta and improved: a freeze window that outlives the round no longer taps the score screen, which opened the Options menu and lost the round's stats.
- Coronation Elsa Legacy skill added: the 1.0 version of the freeze window, offered beside the current one on Beta builds so the two can be compared.

### Added

- **`src/skills/coronationElsaLegacy.ts`.** The 1.0 Elsa file as it was at
  the version bump, every symbol suffixed `Legacy` so the two share one
  bundle, registered as `SkillType.CoronationElsaLegacy` (share code `E`)
  with its own `skill.elsaLegacy.*` log events. Its own id so the stats
  and the log tell the two apart. Never tuned -- findings go in the
  current file.

### Changed

- **Both Coronation Elsa entries are `ReleaseStatus.Beta`.**

### Fixed

- **Elsa's closing break no longer lands on the score tally.** Windows chain
  back to back (the break refills the gauge), so one opened in the round's last
  seconds outlives it, and the choreography checked only its clock. On
  `option_menu.mp4` the break's grid ran over the tally and the post-burst scan
  read the tally's gear as a bubble -- the play square reaches that row on the
  540x960 layout -- so the pop opened Options over the numbers the stats read
  wanted, and the row went blank. `elsaRoundOver` (the play loop's
  `inRoundPages()` sweep) is asked on a starved look, at most once a second,
  and once more before the break; `skill.elsa.roundOver` says when, and
  `skill.elsa.done` carries `roundOver`.

## [1.0]

### Summary

- Coronation Day Elsa skill improved: the freeze window is swept a row at a time from the bottom, the pile is broken as soon as the board has frozen over and again at the close, and the bomb is popped each time.

### Fixed

- **Stitch was never chained on a Coronation Elsa board.** His centre reads
  inside the frozen box at value 236-253 (`elsa_stitch_issue.mp4`), so the
  flat "235 or brighter is ice" rule overrode his whitelist entry on 13 of
  17 tsums: no chain through him all round, and a leftover break fired at
  him on every scan between windows. Each ice-alike now remembers the
  brightest centre its tsums read before the first window, and the rule
  only fires above that (`sureValMargin`).
- **Coronation Elsa's frozen box missed real ice.** Replaying `coronation_elsa_1.mp4`
  through the scan showed standing piles at value 185-192, under the box's
  floor of 195, so chains were drawn onto them (four piles of 16-32 lost in one
  window) and the ice-free branches ran with a pile standing. Floor 170,
  saturation cap 105; the board's live blue sat at 110+ throughout.

### Changed

- **Elsa's window is a row sweep for one break.** A frozen tsum under a
  second band counts double at the break, so the old aim -- many quick chains
  whose bands avoid each other, spent mid-window -- was the wrong one. Now:
  capture, read the ice, draw the flattest short chain anchored in the lowest
  free row, wait `iceFormMs` for the band, look again, until the window is
  nearly out; one break; the bomb popped aimed. A board frozen out with two
  seconds or more of window left is broken on the spot and the refill swept
  again -- the sweep fills a board in three to four seconds, and one window
  on `coronation_elsa_7.mp4` took 391,274 and 599,936 that way against
  ~250,000 for a pile left standing. A break inside the window is aimed taps
  only: the blind grid behind them was 25 taps at ~50ms each, 1.4s a break
  and three breaks a window on `coronation_elsa_8.mp4`. The closing break
  keeps the grid only when it has no pile read to aim at; a pile the aimed
  taps miss is spent as leftover by the next scan. The wait for a band to
  form before the next look is 275ms, down from 350: the crystals settle by
  250-300ms and the capture adds ~60ms, and the ice does not care how fast
  the chains come. The hop limit is tiered (`maxHops`, 34 then 44px) on one
  capture: adjacent tsums wherever they are, else the scattered islands a
  frozen-out board leaves, whose 35-43px hops the tight limit refused right
  before three of four mid-window breaks on `coronation_elsa_8.mp4` -- the
  chains a player sees left standing. A chain the game did not take -- no
  new ice and its tsums still standing on the next look -- is dead for the
  rest of the pile and counts as a starved look, so the board is broken
  instead of the chain redrawn: on `coronation_elsa_9.mp4` one chain of two
  colours the read had merged was drawn for 8s, and a chain of circles on
  bare floor held another break for 4s. From `coronation_elsa_10.mp4`: a
  frozen-out board is broken with as little as 600ms of window left, not
  2s (it stood 2-3s until the closing break, three windows in a row); two
  chains in a row that freeze under two new tsums break the pile like two
  starved looks (ice above the refill held the board at 13 frozen through
  five chains); the leftover break between windows is aimed taps only (its
  grid was 1.3s, three times in one gap). Ice is read per tsum now, off
  the tsum's own centre colour (`BoardPoint.local`, a 5px blur `findTsums`
  samples beside its 22px one), not off the colour cluster: the cluster
  smear read a tsum ringed by ice as ice (four black Mickeys planned around
  as a pile) and merged a pink and a peach face into a chain that never
  linked. The boxes were calibrated against the game's own ice sprites and
  every pile in recordings 8-10: the cube dominates the centre whatever is
  under it (hue 88-165, saturation 25-150, value 175+), and the doubled cube
  and the shards read near-white, taken as ice unless the face contrast says
  a white-patched face. The ice-alike whitelist learns by the same per-tsum
  read: a grey-blue cat on `coronation_elsa_11.mp4` read as ice tsum by
  tsum but its cluster centre never entered the old box, so it was never
  learned -- every scan between windows fired a leftover break at it and no
  chain through it was ever drawn. A tsum in a whitelisted cluster still
  reads as ice when its centre is 235 or brighter (`sureValMin`), and
  brighter than that colour's own tsums read before the first window: the
  cube's centre is, most ice-alike tsums are not, and it is what holds when
  the clustering merges a learned colour with a fresh band. The toolkit's
  `ice_alikes.py` runs every tsum's board art through the read: 70 of 769
  depend on the whitelist, 41 more sit within 12 of a box wall. A break
  taps the bubbles its capture found after the ice, and the look after a
  break pops what it finds over a read of up to four ice: bubbles survive
  a break (`coronation_elsa_10.mp4` at 0:10) and the post-break look read
  shards as ice 127 times in 131, so nearly every bubble was frozen over
  again and only spent after the window. (A blind column of taps for the
  bomb was tried the same day and withdrawn: it cost about a second a
  break and coins with it.) The band
  model, the
  quarantine ring and the narrowest-band rule are gone.
  (Two intermediate versions -- a scheduled pair of chains, and a sweep that
  read "no new ice" as the window closing -- shipped and were withdrawn the
  same day: both made about one chain a window.)
- **Elsa's chains are planned over three rows with adjacent hops.** Planned
  over one row, a colour's tsums sat two apart and the game refused the hop --
  every chain of `coronation_elsa_4/5.mp4` registered as one or two tsums and
  froze nothing. `elsaStripChains` now enumerates chains with hops under
  `maxHop` (34px) across `rowSpan` rows, anchored in the lowest. Verified
  linking on `coronation_elsa_6.mp4`.
- **Elsa's window clock starts when the activation animation ends.** Chains
  12s after a tap still froze, and the window is 10s at level 6, so it runs
  from the ~1.5s lead-in, and no chain goes out under the animation.
- **Ice-alikes match per axis, with room on value, and only count once seen
  scan after scan.** The same live blue read value 185 between windows and 208
  under the fever tint, so the plain distance of 15 called it ice and every
  window of that run chained around a phantom pile. Loosened to hue 12,
  saturation 15, value 40 -- which then let a four-tsum pale transient on one
  pre-window scan exonerate every real band of the next run
  (`coronation_elsa_4.mp4`). A colour now needs four tsums on five scans
  before it is believed; `boardClusterSizes` carries the sizes for it.
- **No blind bubble sweeps in Elsa's choreography.** The one after the closing
  burst held the next activation ~2s per window with the gauge already full;
  the mid-window one spent ~2s of freeze time.
- **Leftover ice between Elsa windows is kept unless pile-sized**
  (`leftoverBurstMin`): a small leftover doubles under the next window's bands,
  and a pale flash reads as two or three frozen tsums often enough that the
  grid was mostly tapping at nothing.
