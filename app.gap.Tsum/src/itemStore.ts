// ===========================================================================
// Buy 5▸4 Tickets -- buying the 5▸4 Ticket ×1 from the store's Item Store tab.
//
// Open the Tsum Tsum Store, switch to the Item Store tab, and find the item by
// tapping each tile and reading the detail panel (`readItemDetail`): the 5▸4
// badge, and one ticket rather than a stack (the ×3 packs share the badge).
// The game adds and reorders items, so a tile's position is never trusted, and
// the panel counts only once the tapped tile has turned gold.
//
// One purchase is Buy, OK on "Item Purchase", then a tap on "Purchase
// complete". The store comes back with the same tile selected, so only the
// first purchase walks the grid; each later one re-reads the panel first.
//
// It pays in Medals. The run ends at the count asked for, on a Buy button
// gone blue (sold out), on `OutOfMedals`, or after `BuyItemMaxMisses` failed
// purchases in a row. The geometry and the item's fingerprint are `ItemStore`
// in data.ts.
// ===========================================================================

/** Failed purchases in a row before the run gives up. */
const BuyItemMaxMisses = 3;
/** How long each purchase's counter holds the banner. */
const BuyItemBannerMs = 4000;
/** How long the purchase confirmation gets to open after Buy. */
const BuyItemDialogWaitMs = 6000;
/** How long "Purchase complete" gets to come and go after OK. */
const BuyItemToastWaitMs = 10 * 1000;
/** After OK, how long a store with no toast in front is still waited on. */
const BuyItemToastGraceMs = 2500;
/** How long one Item Store tab tap gets to show the Item Store. */
const BuyItemTabWaitMs = 3000;
/** How long the grid's tiles get to arrive once the tab is open. */
const BuyItemLoadWaitMs = 8000;
/** Between two looks while waiting. */
const BuyItemPollMs = 250;
// Budgets for `settleScreen`; each ends as soon as the screen holds still.
/** A tab, a tile or a page arrow taking effect. */
const BuyItemTapSettleMs = 2000;
/** The confirmation arriving or leaving, the toast leaving. */
const BuyItemDialogSettleMs = 2000;

/** Tile states, as `readItemGrid` reads them. */
const enum ItemTile {
  Item = 'item',
  Selected = 'selected',
  Empty = 'empty',
}

/** `ItemStore.badge` decoded, once. */
let gItemBadge: Color[] | null = null;

function itemBadgeTemplate(): Color[] {
  if (gItemBadge === null) {
    const hex = ItemStore.badge;
    const out: Color[] = [];
    for (let i = 0; i + 6 <= hex.length; i += 6) {
      out.push({
        r: parseInt(hex.slice(i, i + 2), 16),
        g: parseInt(hex.slice(i + 2, i + 4), 16),
        b: parseInt(hex.slice(i + 4, i + 6), 16),
      });
    }
    gItemBadge = out;
  }
  return gItemBadge;
}

/** How many of `points` read within `diff` of `color`. */
function itemVotes(colors: Color[], from: number, count: number, color: ColorLike, diff: number): number {
  let n = 0;
  for (let i = from; i < from + count; i++) {
    if (isSameColor(color, colors[i], diff)) {
      n++;
    }
  }
  return n;
}

/**
 * The grid as drawn: each tile's state, which one is selected, and whether
 * there is a page either way. One capture, one `getColors`.
 */
Tsum.prototype.readItemGrid = function(img) {
  const own = img === undefined;
  const frame = own ? this.screenshot() : img!;
  const points: Coord[] = [];
  for (const y of ItemStore.tileY) {
    for (const x of ItemStore.tileX) {
      for (const e of ItemStore.tileEdge) {
        points.push({x: x + e.x, y: y + e.y});
      }
    }
  }
  const arrowsAt = points.length;
  points.push(...ItemStore.prevArrow, ...ItemStore.nextArrow);
  let read: Color[];
  try {
    read = this.getColors(frame, points);
  } finally {
    if (own) {
      releaseImage(frame);
    }
  }
  const per = ItemStore.tileEdge.length;
  const votes = Math.ceil(per / 2);
  const tiles: ItemTile[] = [];
  let selected = -1;
  for (let t = 0; t * per < arrowsAt; t++) {
    if (itemVotes(read, t * per, per, ItemStore.tileSelectedColor, ItemStore.tileDiff) >= votes) {
      tiles.push(ItemTile.Selected);
      selected = t;
    } else if (itemVotes(read, t * per, per, ItemStore.tileColor, ItemStore.tileDiff) >= votes) {
      tiles.push(ItemTile.Item);
    } else {
      tiles.push(ItemTile.Empty);
    }
  }
  const arrow = ItemStore.prevArrow.length;
  return {
    tiles: tiles,
    selected: selected,
    prev: itemVotes(read, arrowsAt, arrow, ItemStore.arrowColor, ItemStore.arrowDiff) >= 2,
    next: itemVotes(read, arrowsAt + arrow, arrow, ItemStore.arrowColor, ItemStore.arrowDiff) >= 2,
  };
}

/**
 * What the detail panel shows: is it one ticket, and how far its badge is from
 * the 5▸4 one (best of the vertical shifts, since the badge bobs).
 */
Tsum.prototype.readItemDetail = function(img) {
  const single = this.getColors(img, ItemStore.single);
  let isSingle = true;
  for (let i = 0; i < single.length; i++) {
    if (!isSameColor(ItemStore.single[i], single[i], ItemStore.singleDiff)) {
      isSingle = false;
    }
  }

  const template = itemBadgeTemplate();
  const cells = ItemStore.badgeCols * ItemStore.badgeRows;
  const shifts = 2 * ItemStore.badgeShift + 1;
  const points: Coord[] = [];
  for (let s = -ItemStore.badgeShift; s <= ItemStore.badgeShift; s++) {
    for (let row = 0; row < ItemStore.badgeRows; row++) {
      for (let col = 0; col < ItemStore.badgeCols; col++) {
        points.push({
          x: ItemStore.badgeX + col * ItemStore.badgeStep,
          // One shift is one capture pixel: a third of a step.
          y: ItemStore.badgeY + row * ItemStore.badgeStep + s * ItemStore.badgeStep / 3,
        });
      }
    }
  }
  const read = this.getColors(img, points);
  let badge = Infinity;
  for (let s = 0; s < shifts; s++) {
    let sum = 0;
    for (let i = 0; i < cells; i++) {
      const c = read[s * cells + i];
      const t = template[i];
      sum += Math.abs(c.r - t.r) + Math.abs(c.g - t.g) + Math.abs(c.b - t.b);
    }
    badge = Math.min(badge, sum / (cells * 3));
  }
  return {single: isSingle, badge: Math.round(badge * 10) / 10};
}

/** Is the panel on this frame the 5▸4 Ticket ×1? */
Tsum.prototype.readItemIs5to4 = function(img) {
  const d = this.readItemDetail(img);
  return d.single && d.badge <= ItemStore.badgeMaxDistance;
}

/** Wait for the grid's tiles to be drawn. False when none came in `timeoutMs`. */
Tsum.prototype.awaitItemGrid = function(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const grid = this.readItemGrid();
    if (grid.tiles.some((t) => t !== ItemTile.Empty)) {
      return true;
    }
    if (!this.isRunning || Date.now() >= deadline) {
      logWarn(Log.Item.GridEmpty, 'The Item Store showed no items');
      return false;
    }
    this.sleep(BuyItemPollMs);
  }
}

/**
 * Put the store on its Item Store tab, with its items drawn.
 *
 * From anywhere else this goes to the Tsum Tsum Store first (its route runs
 * through the collection) and taps the tab.
 *
 * The store is recognised ~1.5s before its contents arrive and holds still
 * meanwhile, so a settle passes at once and a tab tap then is swallowed: the
 * box row is waited for first (`awaitBoxTabs`, as Box Buying does), and each
 * tap gets `BuyItemTabWaitMs` to show the Item Store before the next.
 */
Tsum.prototype.openItemStore = function() {
  for (let attempt = 0; attempt < BuyItemMaxMisses && this.isRunning; attempt++) {
    if (gPages.matches(PageName.ItemStorePage)) {
      return this.awaitItemGrid(BuyItemLoadWaitMs);
    }
    if (!gPages.matches(PageName.TsumTsumStorePage)) {
      gPages.navigate(PageName.TsumTsumStorePage);
    }
    this.awaitBoxTabs(BuyBoxLoadWaitMs);
    this.tap(ItemStore.tab);
    const deadline = Date.now() + BuyItemTabWaitMs;
    while (this.isRunning && Date.now() < deadline && !gPages.matches(PageName.ItemStorePage)) {
      this.sleep(BuyItemPollMs);
    }
  }
  if (this.isRunning && gPages.matches(PageName.ItemStorePage)) {
    return this.awaitItemGrid(BuyItemLoadWaitMs);
  }
  if (this.isRunning) {
    const seen = gPages.peek(1, 500);
    logWarn(Log.Item.StoreMissed, 'The Item Store would not open',
      {saw: seen === null ? 'nothing' : seen.name});
  }
  return false;
}

/**
 * Tap tile `index` of the page in front, and say whether the panel then shows
 * the 5▸4 Ticket ×1. Tapped again once if the tile did not turn gold.
 */
Tsum.prototype.selectItemTile = function(page, index) {
  const at = {
    x: ItemStore.tileX[index % ItemStore.tileX.length],
    y: ItemStore.tileY[Math.floor(index / ItemStore.tileX.length)],
  };
  for (let attempt = 0; attempt < 2 && this.isRunning; attempt++) {
    this.tap(at);
    this.settleScreen(BuyItemTapSettleMs);
    // Twice when it is a single ticket that missed on the badge: a frame
    // caught while the panel redrew would read that way.
    for (let look = 0; look < 2; look++) {
      const img = this.screenshot();
      try {
        if (this.readItemGrid(img).selected !== index) {
          break;
        }
        const d = this.readItemDetail(img);
        const found = d.single && d.badge <= ItemStore.badgeMaxDistance;
        logDebug(Log.Item.TileRead, {page: page, tile: index, single: d.single, badge: d.badge, found: found});
        if (found || !d.single || look === 1) {
          return found;
        }
      } finally {
        releaseImage(img);
      }
      this.sleep(BuyItemPollMs);
    }
  }
  logWarn(Log.Item.TileNotTaken, 'An Item Store tile would not select', {page: page, tile: index});
  return false;
}

/**
 * Select the 5▸4 Ticket ×1, and say whether it is selected.
 *
 * The tile already gold is checked first: after a purchase the store keeps
 * it. Otherwise every item is tapped from the first page on.
 */
Tsum.prototype.selectItem5to4 = function() {
  const img = this.screenshot();
  try {
    if (this.readItemGrid(img).selected >= 0 && this.readItemIs5to4(img)) {
      return true;
    }
  } finally {
    releaseImage(img);
  }

  for (let i = 0; i < ItemStore.maxPages && this.isRunning && this.readItemGrid().prev; i++) {
    this.tap(ItemStore.prevTap);
    this.settleScreen(BuyItemTapSettleMs);
  }
  for (let page = 0; page < ItemStore.maxPages && this.isRunning; page++) {
    const grid = this.readItemGrid();
    for (let t = 0; t < grid.tiles.length && this.isRunning; t++) {
      if (grid.tiles[t] !== ItemTile.Empty && this.selectItemTile(page, t)) {
        logInfo(Log.Item.Found, {page: page, tile: t});
        return true;
      }
    }
    if (!grid.next) {
      break;
    }
    this.tap(ItemStore.nextTap);
    this.settleScreen(BuyItemTapSettleMs);
  }
  if (this.isRunning) {
    logWarn(Log.Item.NotFound, 'No 5▸4 Ticket ×1 in the Item Store');
  }
  return false;
}

/**
 * After OK: tap "Purchase complete" away and say how it went. 'bought' once
 * the store is back behind it; 'stuck' when it came but the store did not
 * (the Medals are spent either way); 'missed' when no toast came.
 */
Tsum.prototype.leaveItemToast = function() {
  const startedAt = Date.now();
  let seen = false;
  let taps = 0;
  while (this.isRunning && Date.now() - startedAt < BuyItemToastWaitMs) {
    const img = this.screenshot();
    let toast = false;
    let store = false;
    let confirm = false;
    let medals = false;
    try {
      toast = gPages.matches(PageName.ItemPurchased, img);
      store = !toast && gPages.matches(PageName.ItemStorePage, img);
      confirm = !toast && !store && gPages.matches(PageName.ItemPurchaseConfirm, img);
      medals = !toast && !store && !confirm && gPages.matches(PageName.OutOfMedals, img);
    } finally {
      releaseImage(img);
    }
    if (toast) {
      seen = true;
      this.tap(Page.ItemPurchased.back);
      taps++;
      this.settleScreen(BuyItemDialogSettleMs);
      continue;
    }
    if (store && (seen || Date.now() - startedAt > BuyItemToastGraceMs)) {
      return seen ? 'bought' : 'missed';
    }
    if (confirm) {
      // OK did not land, so nothing was bought yet.
      this.tap(Page.ItemPurchaseConfirm.next);
      this.settleScreen(BuyItemDialogSettleMs);
      continue;
    }
    if (medals) {
      this.tap(Page.OutOfMedals.back);
      this.settleScreen(BuyItemDialogSettleMs);
      return 'noMedals';
    }
    this.sleep(BuyItemPollMs);
  }
  if (!this.isRunning) {
    return seen ? 'stuck' : 'missed';
  }
  const stuck = gPages.peek(1, 500);
  logWarn(Log.Item.ToastStuck, 'The purchase did not finish',
    {saw: stuck === null ? 'nothing' : stuck.name, toast: seen, taps: taps});
  return seen ? 'stuck' : 'missed';
}

/**
 * Buy one 5▸4 Ticket ×1, already selected. `purchase` / `limit` are log
 * fields only; the loop counts.
 */
Tsum.prototype.buyOneItem = function(purchase, limit) {
  const img = this.screenshot();
  let ready: number;
  try {
    ready = itemVotes(this.getColors(img, ItemStore.buyProbes), 0, ItemStore.buyProbes.length,
      ItemStore.buyColor, ItemStore.buyDiff);
  } finally {
    releaseImage(img);
  }
  if (ready < ItemStore.buyProbes.length - 1) {
    logInfo(Log.Item.SoldOut);
    return 'soldOut';
  }

  logDebug(Log.Item.Buying, {purchase: purchase, limit: limit});
  this.tap(ItemStore.buy);
  const deadline = Date.now() + BuyItemDialogWaitMs;
  for (;;) {
    const frame = this.screenshot();
    let confirm = false;
    let medals = false;
    try {
      confirm = gPages.matches(PageName.ItemPurchaseConfirm, frame);
      medals = !confirm && gPages.matches(PageName.OutOfMedals, frame);
    } finally {
      releaseImage(frame);
    }
    if (confirm) {
      break;
    }
    if (medals) {
      this.tap(Page.OutOfMedals.back);
      this.settleScreen(BuyItemDialogSettleMs);
      logInfo(Log.Item.NoMedals);
      return 'noMedals';
    }
    if (!this.isRunning) {
      return 'missed';
    }
    if (Date.now() >= deadline) {
      const seen = gPages.peek(1, 500);
      logWarn(Log.Item.DialogMissing, 'The purchase confirmation did not open',
        {saw: seen === null ? 'nothing' : seen.name});
      return 'missed';
    }
    this.sleep(BuyItemPollMs);
  }

  this.settleScreen(BuyItemDialogSettleMs);
  this.tap(Page.ItemPurchaseConfirm.next);
  this.settleScreen(BuyItemDialogSettleMs);
  const outcome = this.leaveItemToast();
  if (outcome === 'noMedals') {
    logInfo(Log.Item.NoMedals);
  } else if (outcome !== 'missed') {
    logInfo(Log.Item.Bought, {purchase: purchase, limit: limit, cleared: outcome === 'bought'});
  }
  return outcome;
}

/**
 * Buy `count` 5▸4 Ticket ×1, or until the store or the Medals say stop.
 * Returns the fields for `Log.Item.End`, or null when the run stopped.
 */
Tsum.prototype.buy5to4 = function(count) {
  const limit = Math.min(Math.max(Math.round(count) || 0, 1), Buy5to4Max);
  let bought = 0;
  let misses = 0;

  while (this.mayContinue() && bought < limit) {
    // One message per purchase, retired after it (`plays` 1), as Box Buying's.
    this.banner('Buying 5▸4 Tickets ' + (bought + 1) + '/' + limit, BuyItemBannerMs, 1);
    // Either can fail because the run is stopping, which is not an ending to report.
    if (!this.openItemStore()) {
      return this.isRunning ? {bought: bought, reason: 'store not open'} : null;
    }
    if (!this.selectItem5to4()) {
      return this.isRunning ? {bought: bought, reason: 'item not found'} : null;
    }
    const outcome = this.buyOneItem(bought + 1, limit);
    if (outcome === 'bought') {
      misses = 0;
      bought++;
      continue;
    }
    if (outcome === 'soldOut') {
      return {bought: bought, reason: 'sold out'};
    }
    if (outcome === 'noMedals') {
      return {bought: bought, reason: 'not enough medals'};
    }
    if (outcome === 'stuck') {
      // OK was pressed, so it counts against the limit.
      bought++;
    }
    misses++;
    if (misses >= BuyItemMaxMisses) {
      return {bought: bought, misses: misses, reason: 'purchase failed'};
    }
    logInfo(Log.Item.Retrying, {misses: misses});
  }

  if (!this.isRunning) {
    return null;
  }
  if (bought >= limit) {
    logInfo(Log.Item.PurchaseLimit, {bought: bought, limit: limit});
    return {bought: bought, reason: 'purchase limit'};
  }
  return {bought: bought, reason: 'stood aside'};
}

// False only when it stood aside for a round in progress, as `taskBuyBoxes`.
Tsum.prototype.taskBuy5to4 = function() {
  if (roundInProgress()) {
    return false;
  }
  logInfo(Log.Item.Start, {count: this.buy5to4Count});
  const outcome = this.buy5to4(this.buy5to4Count);
  this.lastChore = outcome;
  if (outcome !== null) {
    logInfo(Log.Item.End, outcome);
  }
  return true;
}
