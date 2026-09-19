# Changelog -- Coronation Day Elsa

Every change to the Coronation Day Elsa skill, and her Legacy twin, from 1.0
on. Kept out of `CHANGELOG.md` because she is not on the production build and
that file's `### Summary` ships as the release note. Same shape, one section
per version, so the day she ships her Summary lines fold back into that
file's. Her pre-1.0 history -- she was added in 0.6 -- is in
`CHANGELOG_0.x.md` with everything else of that time.

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
