// The log event vocabulary: every `event` name this project writes, once.
//
// `event` is the field you filter a run on -- stable, dotted and language
// independent -- so it is an interface, and this is where it is declared. The
// sentence a user reads is `src/logs.ts`, keyed by these same constants; the
// record shape is `src/logging.ts`; `LOGGING.md` is the schema.
//
// A `const enum` per component, inside a namespace that is itself erased: the
// emitted bundle contains the bare string and nothing else, exactly as
// `PageName` does. What it buys is one definition per event to jump to, find
// references on and rename, and a name that completes as you type it.
//
// Names mirror the key: `Log.Skill.TiaraNoDream` is `skill.tiara.noDream`. The
// third segment folds into the member name because a const enum cannot nest.
//
// Not every event has a catalogue entry -- a debug line's name is its whole
// description. Adding one: a member here first, then `src/logs.ts` if it is
// user-visible. Order and grouping follow `LOGGING.md` § Components.
namespace Log {
  /** One start()..stop(). */
  export const enum Run {
    BundleIncomplete = 'run.bundleIncomplete',
    /** `saveLastRunSettings` could not write its file; the run goes on. */
    LastSettingsNotSaved = 'run.lastSettingsNotSaved',
    /** `rememberRemoteSetting` could not write a GAP Companion change. */
    RemoteSettingNotSaved = 'run.remoteSettingNotSaved',
    Start            = 'run.start',
    StartBusy        = 'run.startBusy',
    Stop             = 'run.stop',
    StopSlow         = 'run.stopSlow',
  }

  /** The scheduler. */
  export const enum Task {
    LoopStart             = 'task.loopStart',
    LoopStop              = 'task.loopStop',
    LoopStopped           = 'task.loopStopped',
    LoopStopping          = 'task.loopStopping',
    NotAFunction          = 'task.notAFunction',
    StoodAside            = 'task.stoodAside',
    Threw                 = 'task.threw',
    WatchdogRestart       = 'task.watchdogRestart',
    WatchdogRestartFailed = 'task.watchdogRestartFailed',
  }

  /** The game app process. */
  export const enum App {
    Build            = 'app.build',
    Off              = 'app.off',
    OffTimeout       = 'app.offTimeout',
    Restarted        = 'app.restarted',
    Restarting       = 'app.restarting',
    RestartPreparing = 'app.restartPreparing',
    RestartSkipped   = 'app.restartSkipped',
    Start            = 'app.start',
    Started          = 'app.started',
    Up               = 'app.up',
    UpTimeout        = 'app.upTimeout',
  }

  /** Screen geometry, once per run, and waiting for the screen or the board to stop moving. */
  export const enum Screen {
    BoardSettled  = 'screen.boardSettled',
    CalculateSize = 'screen.calculateSize',
    Detect        = 'screen.detect',
    DetectOffset  = 'screen.detectOffset',
    Offset        = 'screen.offset',
    Settled       = 'screen.settled',
    TallGeometry  = 'screen.tallGeometry',
  }

  /** The router: what was matched, and navigation. */
  export const enum Page {
    AccountLevelUpClosing = 'page.accountLevelUp.closing',
    Current               = 'page.current',
    DispatchReentered     = 'page.dispatchReentered',
    DispatchStopped       = 'page.dispatchStopped',
    EventCardRevealClosing = 'page.eventCardReveal.closing',
    EventGiftClosing      = 'page.eventGift.closing',
    EventMainClosing      = 'page.eventMain.closing',
    Friends               = 'page.friends',
    GameResuming          = 'page.gamePause.resuming',
    HeldOff               = 'page.heldOff',
    HighScoreClosing      = 'page.highScore.closing',
    HistoryFrameFailed    = 'page.historyFrameFailed',
    Matched               = 'page.matched',
    Probed                = 'page.probed',
    RankUpClosing         = 'page.rankUp.closing',
    Rejected              = 'page.rejected',
    SubscriptionCycle     = 'page.subscriptionCycle',
    SubscriptionThrew     = 'page.subscriptionThrew',
    TallySkipping         = 'page.scorePage.skipping',
    Trail                 = 'page.trail',
    Tsums                 = 'page.tsums',
    Unmatched             = 'page.unmatched',
    WaitOut               = 'page.waitOut',
  }

  /** Multi-step navigation plans. */
  export const enum Nav {
    NoPlan  = 'nav.noPlan',
    NoRoute = 'nav.noRoute',
  }

  /** What the script is about to do next, at all three layers (forecast.ts). */
  export const enum Forecast {
    State = 'forecast.state',
  }

  /** Reading the board and planning chains. */
  export const enum Board {
    /** A play-loop chain drawn, with what the game's counter said it linked (`readsChainCounter` skills only). */
    ChainDrawn       = 'board.chainDrawn',
    /** A pause landed mid-batch; the rest of the batch was dropped. */
    BatchPaused      = 'board.batchPaused',
    Clusters         = 'board.clusters',
    DeadScan         = 'board.deadScan',
    /** The scan waited out the last seconds' edge wash (`waitOutEdgeWash`). */
    EdgeWash         = 'board.edgeWash',
    /** Large tsums found on the board (`findLargeTsums`). */
    LargeTsums       = 'board.largeTsums',
    LinkReach        = 'board.linkReach',
    MyTsumColor      = 'board.myTsumColor',
    PathDone         = 'board.pathDone',
    PathStart        = 'board.pathStart',
    RecognitionStart = 'board.recognitionStart',
    RecognitionTime  = 'board.recognitionTime',
    Recognized       = 'board.recognized',
    /** The tsums on the board changed size (`Config.boardScale`). */
    Scale            = 'board.scale',
    Stalled          = 'board.stalled',
  }

  /** Bubbles on the board. */
  export const enum Bubble {
    Cleared        = 'bubble.cleared',
    Found          = 'bubble.found',
    Generated      = 'bubble.generated',
    /** A Mid Chain strategy popped the bubbles past `overflowKeep` -- the overflow pop. */
    Overflow       = 'bubble.overflow',
    /** A pop refused because a fever is about to end -- the fever hold. */
    Held           = 'bubble.held',
    /** A pop refused because a skill fired inside `holdAfterSkillMs` -- the burst hold. */
    HeldAfterSkill = 'bubble.heldAfterSkill',
    Popped         = 'bubble.popped',
    /** A pop refused because every bubble sits in a hole -- too few tsums round it. */
    Unripe         = 'bubble.unripe',
  }

  /** A round, start to finish. */
  export const enum Play {
    BoardUp               = 'play.boardUp',
    BoardUpTimeout        = 'play.boardUpTimeout',
    BonusItemsToggled     = 'play.bonusItemsToggled',
    CheckBonusItems       = 'play.checkBonusItems',
    ConfirmingGameOver    = 'play.confirmingGameOver',
    GameOver              = 'play.gameOver',
    GameOverAssumed       = 'play.gameOverAssumed',
    GameOverConfirmed     = 'play.gameOverConfirmed',
    GameStart             = 'play.gameStart',
    GamesLimitReached     = 'play.gamesLimitReached',
    GamingFast            = 'play.gamingFast',
    HudBack               = 'play.hudBack',
    MagicalTimeCancelled  = 'play.magicalTimeCancelled',
    RoundDelayOver        = 'play.roundDelayOver',
    RoundDelaySkipped     = 'play.roundDelaySkipped',
    RoundDelayStarted     = 'play.roundDelayStarted',
    RoundDelayWaiting     = 'play.roundDelayWaiting',
    RoundCoasting         = 'play.roundCoasting',
    RoundTimeUp           = 'play.roundTimeUp',
    /** "Stop after this round": armed, cancelled, and the stop it made. */
    WrapUpArmed           = 'play.wrapUpArmed',
    WrapUpCancelled       = 'play.wrapUpCancelled',
    WrapUpFired           = 'play.wrapUpFired',
  }

  /** Which tsum is selected, off the pre-round icon. */
  export const enum Tsums {
    Detected       = 'tsums.detected',
    Identified     = 'tsums.identified',
    LibraryLoaded  = 'tsums.libraryLoaded',
    NoBoardColors  = 'tsums.noBoardColors',
    NoLibrary      = 'tsums.noLibrary',
    ReadFailed     = 'tsums.readFailed',
    StaleTemplate  = 'tsums.staleTemplate',
    Unidentified   = 'tsums.unidentified',
    Unreadable     = 'tsums.unreadable',
  }

  /** The skill core, then one group per skill that has anything to say. */
  export const enum Skill {
    /** A blind tap on a burst skill read as fired: the bubbles are held. */
    BlindTapFired         = 'skill.blindTapFired',
    CabbageMickeyFound    = 'skill.cabbageMickey.found',
    CabbageMickeyNotFound = 'skill.cabbageMickey.notFound',
    CinderellaStroke      = 'skill.cinderella.stroke',
    CptLyEnteredLate      = 'skill.cptLy.enteredLate',
    ElsaBurst             = 'skill.elsa.burst',
    ElsaDone              = 'skill.elsa.done',
    ElsaIceAlike          = 'skill.elsa.iceAlike',
    ElsaKind              = 'skill.elsa.kind',
    ElsaPass              = 'skill.elsa.pass',
    ElsaSalvo             = 'skill.elsa.salvo',
    ElsaRoundOver         = 'skill.elsa.roundOver',
    FeverHoldOff          = 'skill.feverHoldOff',
    FormalBeastModeEnd    = 'skill.formalBeast.modeEnd',
    FormalBeastModeStart  = 'skill.formalBeast.modeStart',
    FormalBeastSteer      = 'skill.formalBeast.steer',
    GastonClear           = 'skill.gaston.clear',
    GastonDone            = 'skill.gaston.done',
    GastonPass            = 'skill.gaston.pass',
    LorcanaAuroraDone     = 'skill.lorcanaAurora.done',
    LorcanaAuroraNoChain  = 'skill.lorcanaAurora.noChain',
    LorcanaAuroraStayed   = 'skill.lorcanaAurora.stayed',
    LorcanaAuroraSwept    = 'skill.lorcanaAurora.swept',
    MyTsumPriorityHold    = 'skill.myTsumPriority.hold',
    /** NBC Set: Oogie Boogie's cut-in seen on a scan; his dice follow. */
    NbcOogie              = 'skill.nbc.oogie',
    /** NBC Set: Oogie's dice read at rest, and whether that roll is rerolled. */
    NbcDice               = 'skill.nbc.dice',
    /** NBC Set: Oogie's dice never read at rest before the wait ran out. */
    NbcDiceUnread         = 'skill.nbc.diceUnread',
    OverloadProbe         = 'skill.overloadProbe',
    RapunzelDone          = 'skill.rapunzel.done',
    ReadyAgain            = 'skill.readyAgain',
    /** A tap withheld: the skill's last activation is still running. */
    StillRunning          = 'skill.stillRunning',
    TiaraBubbleRead       = 'skill.tiara.bubbleRead',
    TiaraBusy             = 'skill.tiara.busy',
    TiaraDimDream         = 'skill.tiara.dimDream',
    TiaraDream            = 'skill.tiara.dream',
    TiaraNoDream          = 'skill.tiara.noDream',
    TiaraPicked           = 'skill.tiara.picked',
    TiaraSettled          = 'skill.tiara.settled',
    TiaraUnsure           = 'skill.tiara.unsure',
    TiaraWaiting          = 'skill.tiara.waiting',
    Use                   = 'skill.use',
  }

  /** Fever time -- a mode of the board, not a page. */
  export const enum Fever {
    End               = 'fever.end',
    Start             = 'fever.start',
    SubscriptionThrew = 'fever.subscriptionThrew',
  }

  /** The Lorcana transformation -- a mode of the board, not a page. */
  export const enum Lorcana {
    StonePopped   = 'lorcana.stonePopped',
    Transformed   = 'lorcana.transformed',
    Untransformed = 'lorcana.untransformed',
  }

  /** Sending and receiving hearts. */
  export const enum Hearts {
    GoToSelfDone        = 'hearts.goToSelf.done',
    GoToSelfStart       = 'hearts.goToSelf.start',
    ListEnd             = 'hearts.listEnd',
    NoToast             = 'hearts.noToast',
    ReadRecords         = 'hearts.readRecords',
    SaveRecords         = 'hearts.saveRecords',
    Screenful           = 'hearts.screenful',
    Scrolled            = 'hearts.scrolled',
    SendAttempt         = 'hearts.sendAttempt',
    SendDone            = 'hearts.sendDone',
    SendStart           = 'hearts.sendStart',
    SendStep            = 'hearts.sendStep',
    SendTaskUnfinished  = 'hearts.sendTask.unfinished',
    SweepTooLong        = 'hearts.sweepTooLong',
    TimeUp              = 'hearts.timeUp',
    ZeroScore           = 'hearts.zeroScore',
  }

  /** The gift box. */
  export const enum Gifts {
    AllReceived               = 'gifts.allReceived',
    CheckUnreceived           = 'gifts.checkUnreceived',
    Completed                 = 'gifts.completed',
    MailScrolled              = 'gifts.mailScrolled',
    NoOkButton                = 'gifts.noOkButton',
    ReceiveAgain              = 'gifts.receiveAgain',
    ReceiveAll                = 'gifts.receiveAll',
    ReceiveOneByOne           = 'gifts.receiveOneByOne',
    ReceiveOneClosing         = 'gifts.receiveOne.closing',
    ReceiveOneFetchedAllSoFar = 'gifts.receiveOne.fetchedAllSoFar',
    ReceiveOneIdle            = 'gifts.receiveOne.idle',
    ReceiveOneOk              = 'gifts.receiveOne.ok',
    ReceiveOneProbe           = 'gifts.receiveOne.probe',
    ReceiveOneReceiveAll      = 'gifts.receiveOne.receiveAll',
    ReceiveOneRowUnderBar     = 'gifts.receiveOne.rowUnderBar',
    ReceiveOneSkipAd          = 'gifts.receiveOne.skipAd',
    ReceiveOneSkipMedal       = 'gifts.receiveOne.skipMedal',
    ReceiveOneSkipRuby        = 'gifts.receiveOne.skipRuby',
    ReceiveOneSkippedOnly     = 'gifts.receiveOne.skippedOnly',
    ReceiveOneStuck           = 'gifts.receiveOne.stuck',
    ReceiveOneStuckRetry      = 'gifts.receiveOne.stuckRetry',
    ReceiveOneTimeout         = 'gifts.receiveOne.timeout',
    ReceiveOneWaiting         = 'gifts.receiveOne.waiting',
  }

  /** Raising tsum level caps -- the collection sweep. */
  export const enum Unlock {
    CardsRead         = 'unlock.cardsRead',
    DialogMissing     = 'unlock.dialogMissing',
    End               = 'unlock.end',
    GridLoaded        = 'unlock.gridLoaded',
    GridStillLoading  = 'unlock.gridStillLoading',
    /** The Auto Unlock MyTsum Level flow: one raise for the selected tsum after a round. */
    MyTsumBackoff     = 'unlock.myTsum.backoff',
    MyTsumCapped      = 'unlock.myTsum.capped',
    MyTsumEnd         = 'unlock.myTsum.end',
    MyTsumNotSelected = 'unlock.myTsum.notSelected',
    MyTsumRead        = 'unlock.myTsum.read',
    MyTsumStart       = 'unlock.myTsum.start',
    NextPage          = 'unlock.nextPage',
    NowQueued         = 'unlock.nowQueued',
    NowRefused        = 'unlock.nowRefused',
    NowWaiting        = 'unlock.nowWaiting',
    NowYielded        = 'unlock.nowYielded',
    PageMissed        = 'unlock.pageMissed',
    PagesExhausted    = 'unlock.pagesExhausted',
    Raised            = 'unlock.raised',
    RaiseLimit        = 'unlock.raiseLimit',
    RaiseNotConfirmed = 'unlock.raiseNotConfirmed',
    RaiseNotOffered   = 'unlock.raiseNotOffered',
    Raising           = 'unlock.raising',
    Retrying          = 'unlock.retrying',
    RewindFailed      = 'unlock.rewindFailed',
    Rewinding         = 'unlock.rewinding',
    Rewound           = 'unlock.rewound',
    SortFailed        = 'unlock.sortFailed',
    SortNotTaken      = 'unlock.sortNotTaken',
    SortRead          = 'unlock.sortRead',
    SortRestored      = 'unlock.sortRestored',
    SortUnread        = 'unlock.sortUnread',
    Sorted            = 'unlock.sorted',
    Start             = 'unlock.start',
    ToastStuck        = 'unlock.toastStuck',
  }

  /** Buying boxes in the Tsum Tsum Store -- the Box Buying chore. */
  export const enum Box {
    Bought           = 'box.bought',
    ButtonsRead      = 'box.buttonsRead',
    Buying           = 'box.buying',
    DialogMissing    = 'box.dialogMissing',
    End              = 'box.end',
    NoCoins          = 'box.noCoins',
    NotOffered       = 'box.notOffered',
    NowQueued        = 'box.nowQueued',
    NowRefused       = 'box.nowRefused',
    NowWaiting       = 'box.nowWaiting',
    PageMissed       = 'box.pageMissed',
    PurchaseLimit    = 'box.purchaseLimit',
    RevealsStuck     = 'box.revealsStuck',
    Retrying         = 'box.retrying',
    SoldOut          = 'box.soldOut',
    Start            = 'box.start',
    StoreLoading     = 'box.storeLoading',
    TabPicked        = 'box.tabPicked',
    TabNotTaken      = 'box.tabNotTaken',
    TabRead          = 'box.tabRead',
    TenRefused       = 'box.tenRefused',
    ToastStuck       = 'box.toastStuck',
  }

  /** The Tsum List export: every owned tsum off the collection into a CSV. */
  export const enum TsumList {
    CardMissed      = 'tsumList.cardMissed',
    CardRead        = 'tsumList.cardRead',
    End             = 'tsumList.end',
    Identified      = 'tsumList.identified',
    NowQueued       = 'tsumList.nowQueued',
    NowRefused      = 'tsumList.nowRefused',
    NowWaiting      = 'tsumList.nowWaiting',
    OwnedOnlyNotSet = 'tsumList.ownedOnlyNotSet',
    PageMissed      = 'tsumList.pageMissed',
    PageRead        = 'tsumList.pageRead',
    PageTurnMissed  = 'tsumList.pageTurnMissed',
    PortraitSaved   = 'tsumList.portraitSaved',
    PortraitSettled = 'tsumList.portraitSettled',
    Start           = 'tsumList.start',
    Unnamed         = 'tsumList.unnamed',
    WriteFailed     = 'tsumList.writeFailed',
    /** `tsum_list_<device id>.json`, the list Select Tsum reads, was written. */
    FileWritten     = 'tsumList.fileWritten',
  }

  /** A GAP Companion workflow run (src/workflow.ts). */
  export const enum Workflow {
    End             = 'workflow.end',
    Loop            = 'workflow.loop',
    Node            = 'workflow.node',
    NodeFailed      = 'workflow.nodeFailed',
    /** Select Tsum (src/myTsumSelect.ts): the target was already the MyTsum. */
    SelectTsumAlready = 'workflow.selectTsum.already',
    /** Select Tsum: MyTsum Set took (the button greyed out). */
    SelectTsumDone    = 'workflow.selectTsum.done',
    /** Select Tsum: a step failed; `reason` says which. The node is retried. */
    SelectTsumFailed  = 'workflow.selectTsum.failed',
    /** Select Tsum: the card at the listed position is another tsum. */
    SelectTsumStale   = 'workflow.selectTsum.stale',
    /** Select Tsum: the last page no longer ends on the list's last tsum; walking from page 1. */
    SelectTsumEndChanged = 'workflow.selectTsum.endChanged',
    /** Select Tsum: going to the listed page and slot. */
    SelectTsumStart   = 'workflow.selectTsum.start',
    /** Change My Tsum from GAP Companion: queued for the next turn between rounds. */
    SelectTsumNowQueued = 'workflow.selectTsum.nowQueued',
    /** `presetsMirror` could not write the presets file. */
    PresetsNotSaved = 'workflow.presetsNotSaved',
    /** A setting the workflow owns (`stopAfterGames`) was refused. */
    SettingRefused  = 'workflow.settingRefused',
    Start           = 'workflow.start',
  }

  /** The per-round CSV. */
  export const enum Stats {
    ClippedGlyph    = 'stats.clippedGlyph',
    CoinCounter     = 'stats.coinCounter',
    DeviceIdUnsaved = 'stats.deviceIdUnsaved',
    JoinedGlyphsCut = 'stats.joinedGlyphsCut',
    NeverRead       = 'stats.neverRead',
    NeverSettled    = 'stats.neverSettled',
    ReadFailed      = 'stats.readFailed',
    RoundWritten    = 'stats.roundWritten',
    ScorePageGaveUp = 'stats.scorePageGaveUp',
    /** Share round stats: the server accepted a batch. */
    Shared          = 'stats.shared',
    /** Share round stats: a batch was refused or failed; backing off. */
    ShareFailed     = 'stats.shareFailed',
    ShotSaveFailed  = 'stats.shotSaveFailed',
    TallyCovered    = 'stats.tallyCovered',
    TallySkipped    = 'stats.tallySkipped',
    TooManyGlyphs   = 'stats.tooManyGlyphs',
    UnreadableGlyph = 'stats.unreadableGlyph',
    UnreadShotSaved = 'stats.unreadShotSaved',
    WriteFailed     = 'stats.writeFailed',
  }

  /** Android system dialogs. */
  export const enum Dialog {
    Detected          = 'dialog.detected',
    DismissFailed     = 'dialog.dismissFailed',
    DpadFallback      = 'dialog.dpadFallback',
    NoButtonRow       = 'dialog.noButtonRow',
    ScreenSaved       = 'dialog.screenSaved',
    ScreenSaveFailed  = 'dialog.screenSaveFailed',
    TapPageHint       = 'dialog.tapPageHint',
    TapRightmostLabel = 'dialog.tapRightmostLabel',
    TapViaUi          = 'dialog.tapViaUi',
    UiDumpUnavailable = 'dialog.uiDumpUnavailable',
  }

  /** The progress watchdog. */
  export const enum Stall {
    CheckingDialog = 'stall.checkingDialog',
    GivingUp       = 'stall.givingUp',
    RestartingApp  = 'stall.restartingApp',
  }

  /** Capturing unrecognised screens. */
  export const enum Corpus {
    Saved      = 'corpus.saved',
    SaveFailed = 'corpus.saveFailed',
  }

  /** Issue reports -- the folder a player sends in (src/report.ts). */
  export const enum Report {
    Failed     = 'report.failed',
    PartFailed = 'report.partFailed',
    Saved      = 'report.saved',
  }

  /** The walkthrough recorder. */
  export const enum Walk {
    Done       = 'walk.done',
    Page       = 'walk.page',
    SaveFailed = 'walk.saveFailed',
    Start      = 'walk.start',
    Tap        = 'walk.tap',
  }

  /** Click Assist. */
  export const enum Assist {
    GameStart     = 'assist.gameStart',
    Linking       = 'assist.linking',
    NoChain       = 'assist.noChain',
    NoTouchDevice = 'assist.noTouchDevice',
    Ready         = 'assist.ready',
    TapOutside    = 'assist.tapOutside',
    TouchDevice   = 'assist.touchDevice',
  }

  /** The logger itself. */
  export const enum Log {
    Unserializable = 'log.unserializable',
    /** A `traceSend` builder threw; the trace was skipped. */
    TraceFailed = 'log.traceFailed',
  }

  /**
   * The settings WebView -- a separate compilation, same vocabulary.
   *
   * Written by the page itself, with one exception: `LiveApplied` is the engine
   * (`applyLiveSettings`, src/index.ts) reporting what a save off this page did
   * to the run in progress. The Quick Bar's namespace below is split the same
   * way, and for the same reason -- the event names what asked, not what wrote.
   */
  export const enum Settings {
    ClipboardExecCommandFailed = 'settings.clipboardExecCommandFailed',
    ClipboardGetFailed         = 'settings.clipboardGetFailed',
    ClipboardReadFailed        = 'settings.clipboardReadFailed',
    ClipboardSetFailed         = 'settings.clipboardSetFailed',
    ClipboardWriteFailed       = 'settings.clipboardWriteFailed',
    DetectMyTsumAsked          = 'settings.detectMyTsumAsked',
    Enabled                    = 'settings.enabled',
    EnableUnknown              = 'settings.enableUnknown',
    LiveApplied                = 'settings.liveApplied',
    LiveRead                   = 'settings.liveRead',
    Loaded                     = 'settings.loaded',
    NoneFound                  = 'settings.noneFound',
    PresetApplied              = 'settings.presetApplied',
    PresetDeleted              = 'settings.presetDeleted',
    PresetExported             = 'settings.presetExported',
    PresetImported             = 'settings.presetImported',
    PresetSaved                = 'settings.presetSaved',
    PresetStoreFailed          = 'settings.presetStoreFailed',
    ReportAsked                = 'settings.reportAsked',
    RoundDelaySkipAsked        = 'settings.roundDelaySkipAsked',
    UnlockLevelsNowAsked       = 'settings.unlockLevelsNowAsked',
    BuyBoxesNowAsked           = 'settings.buyBoxesNowAsked',
    ExportTsumListAsked        = 'settings.exportTsumListAsked',
    Saved                      = 'settings.saved',
    ShareCodeUndecodable       = 'settings.shareCodeUndecodable',
    ShareFieldIgnored          = 'settings.shareFieldIgnored',
    ShareKeyIgnored            = 'settings.shareKeyIgnored',
    ShareNoSlot                = 'settings.shareNoSlot',
    ShareSlotPrivate           = 'settings.shareSlotPrivate',
    ShareSlotRepeated          = 'settings.shareSlotRepeated',
    ShareSlotsOverflow         = 'settings.shareSlotsOverflow',
    StartCommand               = 'settings.startCommand',
    StoreRead                  = 'settings.storeRead',
    /** Took settings changed from GAP Companion (`remoteSettingsTake`). */
    RemoteRead                 = 'settings.remoteRead',
    Unserializable             = 'settings.unserializable',
  }

  /**
   * The Quick Bar -- the strip of live settings above the log.
   *
   * Written from both sides: the engine half (`src/quickbar.ts`) and the page
   * itself, which is its own compilation and carries its own logger, as the
   * settings page does.
   */
  export const enum QuickBar {
    Applied        = 'quickBar.applied',
    ApplyFailed    = 'quickBar.applyFailed',
    PausedRound    = 'quickBar.pausedRound',
    /** `onResume` pressed Continue and the board came back. */
    ResumedRound   = 'quickBar.resumedRound',
    /** `onResume` could not get the board back; the play loop takes over. */
    ResumeFailed   = 'quickBar.resumeFailed',
    /** The whistle: what a round in progress could not take is on now. */
    PendingApplied = 'quickBar.pendingApplied',
    PresetApplied  = 'quickBar.presetApplied',
    UnlockNowAsked = 'quickBar.unlockNowAsked',
    WrapUpAsked    = 'quickBar.wrapUpAsked',
    CopyShareAsked = 'quickBar.copyShareAsked',
    /** The readout chip was tapped: the run's figures went to the clipboard. */
    StatsCopied    = 'quickBar.statsCopied',
    UnknownSetting = 'quickBar.unknownSetting',
    /** An enum setting sent a value it does not have; refused. */
    InvalidValue   = 'quickBar.invalidValue',
  }
}
