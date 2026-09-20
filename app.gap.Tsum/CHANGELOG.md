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

## [2.1]

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
