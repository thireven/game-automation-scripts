# Backlog

All potential changes which would improve the script will be documented in this file.

### Bugs
- On some devices, after game play, rubies are spent when "Magic Time" is offered (reported by TAR). Happened on real phones without "Special screen ratio" (with video evidence) and Nox (not recorded, config details currently unknown). 
- Harden auto start. Clicking the daily banners too fast or while loading can make the game stuck.
- The board stops fingerprinting under a burst skill's full-screen animation and under the mid-round level-up banner, so the play loop plays blind through them. Needs captures of those moments before it can be fixed; the development tools' `OBSCURED_BOARD.md` is the handover. The cost when it happens is not a wrong page but a stopped one: once the debounce runs out the loop hands over to `confirmGameOver`, which neither scans nor taps, so an overlay lasting to time-up costs every second after it. `play.gameOver`'s `hudLostMs` is how long that was. The fever and closing-seconds cases are closed.
- The detection suite misses all four `TsumTsumStorePage` frames: probe 4 of `TsumTsum2025StorePage` (570,910) reads diff 31 against threshold 30 on every one -- a hair past the line, so either the threshold was cut too tight or the panel colour drifted. One re-measure in the studio settles which.
- Coronation Day Elsa's frozen tsums take colour slots among the `uniqueTsumCount - 1` `scanBoardQuick` keeps -- one per ice shade -- so a pass that starts on an iced board is read short of real colours. It costs chains, not correctness. Fixing it means teaching the scan about clusters it should not count, which is a change every skill shares.
- Coronation Day Elsa's window timings are only partly measured: `iceFormMs` and the frozen colour box come off recordings, but `leadInMs`, `burstTailMs`, `postBurstSettleMs` and `settledFraction`/`settleRetryMs` (the mid-fall gate) are reasoned. `skill.elsa.done`'s `icedLast` near zero with several chains drawn is the premature-pop signature.
- Black frames pass `EventCardReveal` (all ten probes are near-black), so the splash and the opening video's letterbox read as it, and one video frame in each startup recording passed `TsumsPage`. The boot phase no longer ends on either (`bootEndPages`), but both entries want a probe off the black. On the same recordings (540p, scaled up) the Home tab read as `ClosePage`, with `ProfilePage*` failing (799,1653): check on a real capture.
- `base_coins` can still go empty on a round whose only readable-looking frames came mid-payout: of the six `unread-base` shots pulled off MuMu on 2026-08-28, five were the '5' digit misreading (fixed in 0.4 by recutting the template) and the sixth was a "LAST BONUS" frame with the level-up panel still fading in, where failing safe is right. Worth revisiting only if the column keeps gapping now that the '5' reads.

### Screen interactions that bypass the page router

Every screen interaction should be anchored to an explicit page, so that no tap
is aimed at a screen nobody confirmed was there. These are the places that are
not, worst first. The root cause is shared: `NavPlans` (`src/data.ts`) has six
destinations, so `gPages.navigate()` can only be asked for those six -- any task
that needs to get somewhere deeper has to hand-drive, and the hand-driven part is
where the blind taps are.

Each of these needs captures of the screens before it can be fixed; that is the
gating cost, not the code.

**The fix for the root cause is a routing graph**, not more destinations. Declare
the page-to-page edges the navigate band already implements one subscription at a
time -- plus the anchors (`mail`, `tsums`, `home`) which are edges in the `Page`
table already -- and let `navigate()` find a path over them instead of accepting
only the six names in `NavPlans`. Used *forward* like this, a missing edge means
"no route", which is a loud failure; the same graph used backwards, to constrain
what the next page can be, produces a spurious `Unknown` instead and was turned
down for good (`PAGE_DISPATCH.md` § The sitemap says why a map, not a filter).
The observed graph in `docs/transitions.json` is what such a table would be
checked against -- an edge nobody has ever been seen to take, or a transition
seen that the table does not admit.

**Most of that now exists.** `PageRoutes` and `AnchorRoutes` (`src/data.ts`) are
the edge table, every edge tagged with how far it is to be believed, and
`forecastPath` (`src/forecast.ts`) already finds a route over them, and the
detection suite's self-test cross-checks them against the observed ledger. The
blind fallback is gone: `nav.move.exit` presses a page's `back` only where its
`PageRoutes` row says that is a way out, and a page with no row makes
`navigate()` say `nav.noRoute` rather than tap. What is still open is the
consumer: `navigate()` does not walk the graph, it takes the `NavPlans` `via`
hop, and most exit rows name no destination. The remaining work is to give the
rows a `to` somebody can justify, then have `navigate()` walk them.

- **`taskReceiveOneItem`** (`src/mail.ts`) -- a parallel recognition system. It
  is screen-driven, but through per-button `isSameColor` probes rather than
  `gPages`, so none of it is visible to the detection suite:
  six `Button.*.color` points decide what screen it is on and `gPages` is only
  asked about `MailBox` and `ReceiveHeartWithoutCoins`, while `Received`,
  `ReceiveHeart`, `ReceiveSkillTicket` and `ReceivePremiumTicket` sit unused. The heart sender was the other half of this
  and is now `gPages`-driven throughout.
- **The rest of `taskReceiveAllItems`** (`src/mail.ts`) -- the hop into the
  mailbox is a real navigation now (`nav.move.toMail` + the `MailBox` plan), but
  the receive-all confirmation and the results panel that follow are still
  open-loop taps on sleep timing. Needs a frame of each.
- **`friendPageGoToSelf`** (`src/hearts.ts`) -- two confirmed `navigate()` hops
  now, but it still ends on the raw native `tap(0, 0, 20)`, which bypasses
  `ts.tap` and its coordinate conversion entirely. It is there to move an
  emulator pointer off the score column that the zero-score check reads.

Deliberately outside the router and to be left alone: `src/dialogs.ts` (native
Android dialogs are not game screens, and it finds buttons structurally via
`uiautomator` bounds -- it is entered through `PageName.RootDetection`, which is
the right seam), the in-round taps (chains, skills, fan, `clearAllBubbles`, the
skill choreographies -- these run on `GamePlaying`, which the play loop
re-verifies every iteration), `exitUnknownPage` (blind by definition, correctly
anchored to `PageName.Unknown`), and app start/restart.

### Features
- Add "Spam skill" option to check for skill after every finished chain instead of every chain batch.
- Rewrite of Settings UI (became too large as single-page, not dynamic regarding settings like "skill level" of Cinderella)
- Local corpus: remember screens the user directed through GAP Companion, so the next sighting replays that tap. The store would be a grid signature (`myTsumPrepare`/`myTsumSimilarity`) mapped to the tap, kept on the device and checked for progress. The director add-on would need to report the tap it performed. Teaching is the only safe source: the script cannot tell a Close button from Buy with Rubies on its own.
