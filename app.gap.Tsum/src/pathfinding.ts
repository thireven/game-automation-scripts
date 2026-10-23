// Utils for Tsum

/** Squared distance -- the callers only ever compare it, so the sqrt is skipped. */
function getDistance(t1: Point, t2: Point): number {
  const dx = t1.x - t2.x;
  const dy = t1.y - t2.y;
  return dx * dx + dy * dy;
}

/**
 * Adjacency list over one colour group: `neighbors[i]` holds the indices of the
 * tsums within linking range of `tsums[i]`.
 *
 * `maxDistSq` is the reach between two normal tsums. A large tsum
 * (`BoardPoint.grow`) is that much wider, so a pair reaches the average of
 * their growths farther: a large tsum bridges gaps normal ones cannot.
 */
function buildTsumNeighbors(tsums: Point[], maxDistSq: number): number[][] {
  const neighbors: number[][] = [];
  const grow: number[] = [];
  for (let i = 0; i < tsums.length; i++) {
    neighbors.push([]);
    grow.push((tsums[i] as BoardPoint).grow || 1);
  }
  for (let i = 0; i < tsums.length; i++) {
    for (let j = i + 1; j < tsums.length; j++) {
      const g = (grow[i] + grow[j]) / 2;
      if (getDistance(tsums[i], tsums[j]) <= (g === 1 ? maxDistSq : maxDistSq * g * g)) {
        neighbors[i].push(j);
        neighbors[j].push(i);
      }
    }
  }
  return neighbors;
}

/** Whether the segment `a`-`b` passes within `rSq` (squared) of `p`. */
function segmentNearPoint(a: Point, b: Point, p: Point, rSq: number): boolean {
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
 * Hops a drag can draw over `board` without touching anything else: pairs
 * within `reach` tsum widths, less any hop whose line passes within `cross`
 * tsum widths of a third tsum's centre or inside a bubble. The game links
 * whatever the line crosses, so a hop that clips a third tsum links it out of
 * order. Gaston's route rule, shared with Rapunzel+'s colour-blind chain.
 */
function buildClearHops(board: BoardPoint[], bubbles: GameBubble[], reach: number, cross: number): number[][] {
  const half = Config.tsumWidth / 2;
  const reachPx = Config.tsumWidth * reach;
  const crossPx = Config.tsumWidth * cross;
  const crossSq = crossPx * crossPx;
  const centres: Point[] = [];
  for (let i = 0; i < board.length; i++) { centres.push({ x: board[i].x + half, y: board[i].y + half }); }
  const neighbors = buildTsumNeighbors(centres, reachPx * reachPx);
  for (let i = 0; i < neighbors.length; i++) {
    const kept: number[] = [];
    for (let k = 0; k < neighbors[i].length; k++) {
      const j = neighbors[i][k];
      let clean = true;
      for (let o = 0; o < centres.length && clean; o++) {
        if (o !== i && o !== j && segmentNearPoint(centres[i], centres[j], centres[o], crossSq)) { clean = false; }
      }
      for (let b = 0; b < bubbles.length && clean; b++) {
        if (segmentNearPoint(centres[i], centres[j], bubbles[b], bubbles[b].r * bubbles[b].r)) { clean = false; }
      }
      if (clean) { kept.push(j); }
    }
    neighbors[i] = kept;
  }
  return neighbors;
}

/** The connected components of the adjacency list, each a list of node indices. */
function findTsumComponents(neighbors: number[][]): number[][] {
  const n = neighbors.length;
  const seen: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) { seen[i] = false; }
  const components: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) { continue; }
    const comp: number[] = [];
    const stack = [s];
    seen[s] = true;
    while (stack.length > 0) {
      const v = stack.pop()!;  // guarded by the loop condition
      comp.push(v);
      const nbrs = neighbors[v];
      for (let k = 0; k < nbrs.length; k++) {
        if (!seen[nbrs[k]]) {
          seen[nbrs[k]] = true;
          stack.push(nbrs[k]);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

/** Set bits in a 32-bit integer. */
function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
}

// Total DFS steps one component search may spend, over every start. With the
// memo below the search is exact and normally done in a few hundred steps; this
// only bounds the rare big, dense component (20 same-colour tsums at a wide
// reach). Set off the `worst ms` column of `npm run chain:bench`: a pruned
// step costs ~2.5x a plain one, and 3,000 is where the worst single search on
// QuickJS-ng comes in under the old search's (12 ms against 15) without a
// board in the benchmark losing a tsum to the cut.
const SearchStepBudget = 3000;

// Longest simple path inside one connected component: a depth-first search
// with two prunings that make it exact, rather than a heuristic, on every board
// the benchmark has measured (`npm run chain:bench`):
//
//   - reachability bound -- at depth d with r unvisited tsums still reachable,
//     no chain longer than d + r can follow, so a branch that cannot beat the
//     best is dropped before it is walked;
//   - dead-state memo -- a (visited set, tsum) pair explored to exhaustion is
//     never explored again, from any start. Valid for the rest of the search
//     because the best length only grows. Keyed by bitmask, so n <= 31; a
//     bigger component (Rapunzel+'s whole board) runs without it, and the cap
//     stops that search long before the memo would matter.
//
// Every tsum is tried as a start, most constrained first, and the memo is what
// makes the later starts cheap. `budget` caps the total steps across them.
//
// maxLen caps the chain the search may return (Infinity for no cap). It is a
// stopping condition rather than a post-hoc trim: once a chain of that length
// exists there is nothing better to find, so the search returns immediately —
// which is where the speed-up of a short cap comes from.
//
// `lowFirst`, when given, is the group's own points, and it orders the starts
// by board position as well as degree — see `calculatePaths`' parameter of the
// same name. `startIdx` is the tsum the winning chain grew from, its `path[0]`.
function findLongestTsumPath(
    neighbors: number[][], comp: number[], budget: number, maxLen?: number,
    lowFirst?: Point[]): { path: number[], startIdx: number } {
  // Bound to a const because `dfs` closes over it; a narrowing on the parameter
  // itself would not survive into the closure.
  const cap: number = (maxLen === undefined || !(maxLen > 0)) ? Infinity : maxLen;
  const n = neighbors.length;
  const visited = new Uint8Array(n);
  const path: number[] = [];
  let steps = 0;
  let bestLen = 0;
  let best: number[] = [];
  let stop = false;

  // Order each adjacency list by ascending degree so the search tries the most
  // constrained branches first — dead ends prune quickly and leaves get
  // consumed before they become unreachable.
  const sortedNbrs: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const arr = neighbors[i].slice();
    arr.sort(function(a, b) { return neighbors[a].length - neighbors[b].length; });
    sortedNbrs[i] = arr;
  }

  // Everything below is built on the first backtrack. A search that reaches
  // its cap on the first descent -- the default cap of 3, Rapunzel+'s window --
  // never allocates any of it.
  //
  // For a component of up to 31 tsums the visited set is also kept as a
  // bitmask: it keys the memo, and the reachability sweep runs on masks of the
  // adjacency -- a few dozen integer ops rather than a walk over every edge.
  const maskable = n <= 31;
  let visitedMask = 0;
  let dead: Set<number> | null = null;
  let adjMask: Int32Array | null = null;
  // The list walk, for a component too big for a mask. A stamp marks what one
  // call has queued, so nothing is cleared between calls.
  let stampOf: Int32Array | null = null;
  let queue: Int32Array | null = null;
  let stamp = 0;

  // Unvisited tsums reachable from `v` through unvisited tsums.
  function reach(v: number): number {
    if (maskable) {
      if (adjMask === null) {
        adjMask = new Int32Array(n);
        for (let i = 0; i < n; i++) {
          const nbrs = neighbors[i];
          for (let k = 0; k < nbrs.length; k++) { adjMask[i] |= (1 << nbrs[k]); }
        }
      }
      let frontier = adjMask[v] & ~visitedMask;
      let seen = frontier;
      while (frontier !== 0) {
        const bit = frontier & -frontier;
        frontier ^= bit;
        const add = adjMask[31 - Math.clz32(bit)] & ~visitedMask & ~seen;
        seen |= add;
        frontier |= add;
      }
      return popcount32(seen);
    }
    if (stampOf === null || queue === null) {
      stampOf = new Int32Array(n);
      queue = new Int32Array(n);
    }
    stamp++;
    let head = 0;
    let tail = 0;
    const nbrs = neighbors[v];
    for (let k = 0; k < nbrs.length; k++) {
      const u = nbrs[k];
      if (visited[u] === 0) { stampOf[u] = stamp; queue[tail++] = u; }
    }
    while (head < tail) {
      const wn = neighbors[queue[head++]];
      for (let k = 0; k < wn.length; k++) {
        const u = wn[k];
        if (visited[u] === 0 && stampOf[u] !== stamp) { stampOf[u] = stamp; queue[tail++] = u; }
      }
    }
    return tail;
  }

  function dfs(v: number): void {
    steps++;
    visited[v] = 1;
    if (maskable) { visitedMask |= (1 << v); }
    path.push(v);
    let fresh = false;
    if (path.length > bestLen) {
      bestLen = path.length;
      best = path.slice();
      fresh = true;
      if (bestLen >= cap) { stop = true; }
    }
    if (!stop && steps >= budget) { stop = true; }
    if (!stop) {
      const key = maskable ? visitedMask * 32 + v : 0;
      // A fresh best is neither dead -- nothing reached this depth before --
      // nor prunable: that would need nothing reachable at all.
      if (fresh || dead === null || !dead.has(key)) {
        if (fresh || path.length + reach(v) > bestLen) {
          const nbrs = sortedNbrs[v];
          for (let k = 0; k < nbrs.length; k++) {
            const u = nbrs[k];
            if (visited[u] === 0) {
              dfs(u);
              if (stop) { break; }
            }
          }
        }
        // Only a branch walked to its end is dead; one cut short by the cap or
        // the budget is not.
        if (maskable && !stop) {
          if (dead === null) { dead = new Set<number>(); }
          dead.add(key);
        }
      }
    }
    path.pop();
    visited[v] = 0;
    if (maskable) { visitedMask &= ~(1 << v); }
  }

  // Sort component nodes by ascending degree — true endpoints (degree 1) lie
  // on long paths and make the best DFS starts. `lowFirst` breaks the ties by
  // board position, lowest tsum first: degree is a small integer so equal
  // starts are the common case, and which of them is tried first is what
  // decides where on the board an equally long chain ends up. A tiebreak and
  // not the primary key, so this cannot cost chain length.
  const starts = comp.slice();
  starts.sort(function(a, b) {
    const byDegree = neighbors[a].length - neighbors[b].length;
    if (byDegree !== 0 || !lowFirst) { return byDegree; }
    return lowFirst[b].y - lowFirst[a].y;
  });
  for (let s = 0; s < starts.length && !stop; s++) {
    if (bestLen >= comp.length) { break; }
    dfs(starts[s]);
  }

  return { path: best, startIdx: best.length > 0 ? best[0] : -1 };
}

// The `logs` parameter this used to take is gone: its only job was to hand the
// two debug lines below a translated string, and debug lines are keyed by event
// now rather than translated.
// `maxChain` overrides the "Maximum Chain Number" setting for this call only.
// Coronation Day Elsa is the one caller that passes it: her freeze line is drawn
// between a chain's ends, so while her window is open a long chain is worth much
// more than the setting's usual answer. Passing it beats writing `Config.maxChain`
// for the duration -- a choreography that threw would leave the whole run capped
// at whatever it had set.
// `lowFirst` grows each chain from the lowest tsum the search can start on
// rather than from any equally good one, and tags what comes back with the
// `startY` it grew from. Elsa's freeze window used to be the one caller; it
// now sweeps the board a row at a time and hands this a row's tsums instead,
// so nothing passes it today. Kept because it costs nothing and the
// development toolkit's coverage harness still drives it.
// `linkReach` overrides the "Link reach" setting, in tsum widths, the same way:
// the play loop passes the skill's (`skillLinkReach`).
function calculatePaths(
    board: BoardPoint[],
    myTsumIdx: number, prioritizeMyTsum: boolean, maxChain?: number,
    lowFirst?: boolean, linkReach?: number): TsumPath[] {
  const startTime = Date.now();
  const groups: { [tsumIdx: string]: BoardPoint[] } = {};
  for (const t in board) {
    const tsum = board[t];
    if (groups[tsum.tsumIdx] === undefined) {
      groups[tsum.tsumIdx] = [];
    }
    groups[tsum.tsumIdx].push(tsum);
  }

  // How far apart two tsums of one colour may be and still be linkable. This
  // is the constraint that decides how long a chain can get -- not "Maximum
  // Chain Number", which can only cap what this has already made reachable.
  // Both ends of its range cost something; see `TsumConfig.linkReach`.
  const threshold = tsumSpan() * (linkReach || Config.linkReach);
  const maxDistSq = threshold * threshold;
  const paths: TsumPath[] = [];
  // A cap makes the search stop as soon as a chain that long is found, so short
  // caps also make the scan cheaper — which is the point for tsums that play
  // better on many quick chains than on a few long ones.
  const cap = typeof maxChain === 'number' ? maxChain : Config.maxChain;
  const maxLen = cap > 0 ? cap : Infinity;

  for (const tsumIdx in groups) {
    const group = groups[tsumIdx];
    if (group.length < 3) { continue; }

    const neighbors = buildTsumNeighbors(group, maxDistSq);
    const components = findTsumComponents(neighbors);

    for (let c = 0; c < components.length; c++) {
      const comp = components[c];
      if (comp.length < 3) { continue; }
      const best = findLongestTsumPath(neighbors, comp, SearchStepBudget, maxLen,
        lowFirst ? group : undefined);
      const bestIndices = best.path;
      if (bestIndices.length >= 3) {
        const pathPoints: TsumPath = [];
        for (let p = 0; p < bestIndices.length; p++) {
          pathPoints.push(group[bestIndices[p]]);
        }
        pathPoints.tsumIdx = +tsumIdx;
        pathPoints.startY = group[best.startIdx].y;
        paths.push(pathPoints);
      }
    }
  }

  // With "Link MyTsum first" on, MyTsum chains play first (longest first), then
  // other colors by length. Otherwise, just take the longest available chain
  // regardless of color so anything connectable goes out as soon as possible.
  paths.sort(function(a, b) {
    if (prioritizeMyTsum) {
      const aMy = (myTsumIdx >= 0 && a.tsumIdx === myTsumIdx);
      const bMy = (myTsumIdx >= 0 && b.tsumIdx === myTsumIdx);
      if (aMy !== bMy) { return aMy ? -1 : 1; }
    }
    if (a.length < b.length) { return 1; }
    return -1;
  });
  // Lengths in play order, which is what "Maximum chain length" and "Chains per
  // board scan" are tuned against. Built lazily: a function field is a thunk the
  // logger only calls when the record is really going out.
  logDebug(Log.Board.PathDone, {
    paths: paths.length,
    durationMs: Date.now() - startTime,
    chainLengths: function() {
      const lens: number[] = [];
      for (let i = 0; i < paths.length; i++) { lens.push(paths[i].length); }
      return lens;
    },
  });
  return paths;
}

/**
 * How many of `chain`'s tsums are still standing where the drag left them.
 *
 * A chain the game takes is off the board within a frame of the release, so a
 * later scan that still finds every one of them is a drag that linked nothing.
 * That is the play loop's dead-scan check (`DeadScanTolerancePx`, play.ts) and
 * the same question `lorcanaAuroraBurstCheck` asks of her bubbles -- matched
 * against one later scan rather than followed read to read, because here the
 * two readings are whole board scans a batch apart, not frames.
 *
 * `tolerance` is play-square px: the square is 200 across and tsums sit ~25
 * apart, so a few px is the pile's own jitter and a moved tsum is far outside
 * it.
 */
function boardStillHolds(board: BoardPoint[], chain: BoardPoint[], tolerance: number): number {
  const maxDistSq = tolerance * tolerance;
  let held = 0;
  for (let i = 0; i < chain.length; i++) {
    for (let j = 0; j < board.length; j++) {
      const dx = board[j].x - chain[i].x;
      const dy = board[j].y - chain[i].y;
      if (dx * dx + dy * dy <= maxDistSq) {
        held++;
        break;
      }
    }
  }
  return held;
}

// The longest chain reachable from the tsum nearest to a touch point, in the
// same shape calculatePaths returns. Used by Click Assist: the user points at a
// tsum, this works out which of its color-mates are connected to it and in what
// order to draw them.
function findChainAtTouch(board: BoardPoint[], touchX: number, touchY: number): TsumPath | null {
  if (!board || board.length === 0) { return null; }

  let nearestAllIdx = -1;
  let nearestAllDistSq = Infinity;
  // How near the tap has to land to count as pointing at a tsum -- a bit over
  // one tsum, so a tap between two picks the closer one instead of missing.
  // The multiplier moved 1.8 -> 1.15 when tsumWidth was corrected 16 -> 25, to
  // hold the reach at ~29px; unlike the link radius below, this one was already
  // the size it wanted to be.
  const maxTouchDistSq = (tsumSpan() * 1.15) * (tsumSpan() * 1.15);
  for (let i = 0; i < board.length; i++) {
    const dx = board[i].x - touchX;
    const dy = board[i].y - touchY;
    const d = dx * dx + dy * dy;
    if (d < nearestAllDistSq) {
      nearestAllDistSq = d;
      nearestAllIdx = i;
    }
  }
  if (nearestAllIdx === -1 || nearestAllDistSq > maxTouchDistSq) { return null; }

  const tsumIdx = board[nearestAllIdx].tsumIdx;
  const group: BoardPoint[] = [];
  let nearestInGroup = -1;
  for (let i = 0; i < board.length; i++) {
    if (board[i].tsumIdx === tsumIdx) {
      if (i === nearestAllIdx) { nearestInGroup = group.length; }
      group.push(board[i]);
    }
  }
  if (group.length < 3 || nearestInGroup === -1) { return null; }

  // The same reach the auto-player uses, so Click Assist draws the chain the
  // script would have drawn rather than a different one.
  const threshold = tsumSpan() * Config.linkReach;
  const maxDistSq = threshold * threshold;
  const neighbors = buildTsumNeighbors(group, maxDistSq);

  // Flood fill from the touched tsum: only the component it actually belongs to
  // can be linked, however many same-colored tsums sit elsewhere on the board.
  const n = group.length;
  const seen: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) { seen[i] = false; }
  const queue: number[] = [nearestInGroup];
  seen[nearestInGroup] = true;
  const comp: number[] = [];
  while (queue.length > 0) {
    const v = queue.shift()!;  // guarded by the loop condition
    comp.push(v);
    const nbrs = neighbors[v];
    for (let k = 0; k < nbrs.length; k++) {
      if (!seen[nbrs[k]]) {
        seen[nbrs[k]] = true;
        queue.push(nbrs[k]);
      }
    }
  }
  if (comp.length < 3) { return null; }

  // No cap here: "Maximum chain length" is about how the auto-player paces
  // itself. Click Assist is the user pointing at a chain and asking for it, so
  // it always draws the whole thing.
  const bestIndices = findLongestTsumPath(neighbors, comp, SearchStepBudget, Infinity).path;
  if (bestIndices.length < 3) { return null; }

  const pathPoints: TsumPath = [];
  for (let p = 0; p < bestIndices.length; p++) {
    pathPoints.push(group[bestIndices[p]]);
  }
  pathPoints.tsumIdx = +tsumIdx;
  return pathPoints;
}

/**
 * The grayscale, blurred copy both Hough passes run on.
 *
 * `findTsums` and `findGameBubbles` hunt circles of different sizes in the same
 * picture, so they want a byte-identical preprocessed image -- and each used to
 * build its own, paying a clone, a colour conversion and a 9x9 Gaussian twice
 * per board scan for the same result.
 *
 * The caller owns the handle and must release it. Both passes take it as a
 * required parameter rather than building one on demand: an optional argument
 * would make ownership conditional, which is the shape that leaks native memory
 * on whichever path forgets.
 */
function buildBoardGray(img: NativeImage): NativeImage {
  const tmpImg = clone(img);
  // Held here until the caller has it: a native throwing between the
  // conversion and the return would otherwise leave the grey copy unreleased,
  // and the caller's own finally never sees a handle it was not handed.
  let grayImg: NativeImage | null = null;
  try {
    grayImg = bgrToGray(tmpImg);
    smooth(grayImg, 2, 9);
    const out = grayImg;
    grayImg = null;
    return out;
  } finally {
    releaseImage(tmpImg);
    if (grayImg !== null) {
      releaseImage(grayImg);
    }
  }
}

// Game bubbles are circles too, just a good deal bigger than a tsum, so they
// come out of the scan's own board gray at a larger radius -- no screenshot and
// no second blur, which is the point: the taps have to land while the chain is
// still going off. Two passes: `param2` over the whole square, and a looser one
// over the bottom band (`bandFrom`) where bubbles pile up, kept only where the
// circle looks like a bubble (`bubbleLooks` on `img`, the scan's colour frame).
//
// `tsums` are that scan's tsum circles (centres, as `findTsums` returns them);
// each bubble is handed the count of them inside its blast, which is what a pop
// of it is worth -- see `GameBubbleConfig.blastReach`.
function findGameBubbles(grayImg: NativeImage, img: NativeImage, tsums: Point[]): GameBubble[] {
  const cfg = GameBubbleConfig;
  // houghCircles returns centres, unlike the board points findTsums feeds the
  // pathfinder (those are shifted to a tsum's top-left corner).
  // Bubbles shrink with the tsums (`Config.boardScale`).
  const found = houghCircles(grayImg, 3, 1, scaledPx(cfg.minDist), cfg.param1, cfg.param2,
                             scaledPx(cfg.minRadius), scaledPx(cfg.maxRadius));
  const out: GameBubble[] = [];
  for (let k = 0; k < found.length; k++) {
    out.push({x: found[k].x, y: found[k].y, r: found[k].radius});
  }
  const bandFrom = getImageSize(grayImg).height * cfg.bandFrom;
  const band = houghCircles(grayImg, 3, 1, scaledPx(cfg.minDist), cfg.param1, cfg.bandParam2,
                            scaledPx(cfg.minRadius), scaledPx(cfg.bandMaxRadius));
  const low: GameBubble[] = [];
  for (let k = 0; k < band.length; k++) {
    const b = band[k];
    if (b.y < bandFrom || bubbleNear(b, out, scaledPx(cfg.minDist))) { continue; }
    low.push({x: b.x, y: b.y, r: b.radius, band: true});
  }
  const kept = bubbleLooks(img, low);
  for (let k = 0; k < kept.length; k++) { out.push(kept[k]); }
  const reachBase = cfg.blastReach * tsumSpan();
  for (let k = 0; k < out.length; k++) {
    const b = out[k];
    const reach = b.r + reachBase;
    let near = 0;
    for (let i = 0; i < tsums.length; i++) {
      const dx = tsums[i].x - b.x;
      const dy = tsums[i].y - b.y;
      if (dx * dx + dy * dy <= reach * reach) { near++; }
    }
    b.near = near;
  }
  return out;
}

/** Whether `p` lies within `dist` of any of `bubbles`. */
function bubbleNear(p: Point, bubbles: GameBubble[], dist: number): boolean {
  for (let k = 0; k < bubbles.length; k++) {
    const dx = bubbles[k].x - p.x;
    const dy = bubbles[k].y - p.y;
    if (dx * dx + dy * dy < dist * dist) { return true; }
  }
  return false;
}

/**
 * `circles` less those that don't look like a bubble inside: too much dark
 * (a tsum's hair or outline) or near-white (a pale tsum) in the disc at 0.7 of
 * the radius. See `GameBubbleConfig.darkMax`/`whiteMax`. One colour read for
 * all of them.
 */
function bubbleLooks(img: NativeImage, circles: GameBubble[]): GameBubble[] {
  const cfg = GameBubbleConfig;
  const size = getImageSize(img);
  const pts: Point[] = [];
  const per: number[] = [];
  for (let k = 0; k < circles.length; k++) {
    const c = circles[k];
    const r = 0.7 * (c.r || cfg.minRadius);
    let n = 0;
    for (let dx = -r; dx <= r; dx += 2) {
      for (let dy = -r; dy <= r; dy += 2) {
        if (dx * dx + dy * dy > r * r) { continue; }
        const x = Math.round(c.x + dx);
        const y = Math.round(c.y + dy);
        if (x < 0 || y < 0 || x >= size.width || y >= size.height) { continue; }
        pts.push({ x: x, y: y });
        n++;
      }
    }
    per.push(n);
  }
  if (pts.length === 0) { return circles; }
  const colors = getImageColors(img, pts);
  const out: GameBubble[] = [];
  let at = 0;
  for (let k = 0; k < circles.length; k++) {
    let dark = 0;
    let white = 0;
    for (let n = 0; n < per[k]; n++) {
      const c = colors[at + n];
      const hi = Math.max(c.r, c.g, c.b);
      const lo = Math.min(c.r, c.g, c.b);
      if (hi < 64) { dark++; }
      if (hi > 217 && hi - lo < 0.25 * hi) { white++; }
    }
    at += per[k];
    if (per[k] === 0 || (dark <= cfg.darkMax * per[k] && white <= cfg.whiteMax * per[k])) {
      out.push(circles[k]);
    }
  }
  return out;
}

// A tsum's circle in the 200px play square `findTsums` works in. Hoisted out of
// it because `findTsumCount` runs the same pass for the count alone, and two
// copies of these would drift the first time one was retuned.
// The box blur behind `TsumPoint.local`: wide enough to flatten a face's
// features at the centre cross, narrow enough (a fifth of a tsum) to keep the
// neighbours out. The 22px smear the clustering samples is the other extreme.
const LocalSampleBlur = 5;
// The heavy blur the clustering samples: a whole tsum, so faces flatten to one
// colour. A skill may narrow it (`SkillHandler.colorBlur`).
const TsumColorBlur = 22;

var TsumCircle = {
  dp: 1,           // accumulator resolution (lower = finer)
  minDist: 22,     // min gap between circle centers
  param1: 20,      // Canny high threshold
  param2: 10,      // accumulator vote threshold
  minRadius: 8,
  maxRadius: 14,
};

// Large tsums: about 1.85x a normal tsum across (radius ~24 in the play square,
// measured off a recording), so neither circle pass can return one -- the tsum
// pass stops at 14, the bubble pass at 22 -- and a Hough pass at that size is
// too noisy to trust. What gives one away is that it is one flat colour from
// its middle nearly to its rim, which two normal tsums side by side are not.
// `findLargeTsums` looks for exactly that.
var LargeTsum = {
  radius: 24,
  // Its size against a normal tsum: how much farther it reaches
  // (`buildTsumNeighbors`). The game accepted a large-to-small link of 1.77x
  // the two radii; a normal pair at `Config.linkReach` is 1.7x.
  grow: 1.85,
  // The colour grid is read every `step` px and centres tried every other cell.
  step: 4,
  // Colour distance (BGR) inside which a sample counts as the tsum's own
  // colour, and the share of the two inner rings (0.55 and 0.8 of the radius)
  // that has to be.
  tolerance: 55,
  minFlat: 0.82,
  // The ring at 1.3 radii has to differ from it for at least this share: a
  // tsum ends, a patch of board does not.
  minEdge: 0.5,
  // Dimmer than this (max channel) is a hole in the board or a pile of dark
  // tsums, not a flat tsum. Costs a large *dark* tsum, which goes unseen.
  minValue: 150,
  // Normal tsum circles within 0.8 of the radius of a large one. A face is
  // found once at most; more is a cluster of small ones.
  maxInside: 1,
  dupReach: 0.8,
  // Detection is skipped this long after a skill activation (`scanBoardQuick`).
  skillQuietMs: 1500,
  // A hit repeats the last scan's within this many px (`scanBoardQuick`).
  sameSpot: 8,
  // Scans in a row a hit has to repeat before it is used.
  confirmScans: 3,
  // With nothing found on the last read, read only every this many scans. A
  // large tsum stays put until linked, so its confirmation starting a few scans
  // late costs nothing, and most reads find nothing: it is ~5ms a scan.
  idleEvery: 4,
};

// Ring offsets from a centre, in grid steps of `LargeTsum.step` (4px), so
// every sample is a lookup into the one colour grid. Inner: radius ~13 and ~19;
// outer: ~31.
const LargeRingInner: number[][] = [
  [3, 1], [1, 3], [-1, 3], [-3, 1], [-3, -1], [-1, -3], [1, -3], [3, -1], [2, 2], [-2, 2], [-2, -2], [2, -2],
  [4, 2], [2, 4], [-2, 4], [-4, 2], [-4, -2], [-2, -4], [2, -4], [4, -2], [5, 0], [0, 5], [-5, 0], [0, -5],
];
const LargeRingOuter: number[][] = [
  [6, 5], [5, 6], [-5, 6], [-6, 5], [-6, -5], [-5, -6], [5, -6], [6, -5], [8, 0], [0, 8], [-8, 0], [0, -8],
];

/**
 * Large tsums on the board, centres and `LargeTsum.grow`.
 *
 * One batched colour read of the light-blurred frame on a 4px grid, then each
 * candidate centre (every 8px) is tested on that grid: flat colour at 0.55 and
 * 0.8 of the radius, a different colour past the rim, bright enough to be a
 * tsum, and at most `maxInside` of `circles` (the normal tsum pass) inside it.
 * Neighbouring hits are merged, best first. Skipped on a shrunk board
 * (`Config.boardScale`), where the radius would be wrong.
 */
function findLargeTsums(img: NativeImage, circles: HoughCircle[]): LargeCircle[] {
  const L = LargeTsum;
  if (Config.boardScale < 0.95) { return []; }
  const size = getImageSize(img);
  const cols = Math.floor(size.width / L.step);
  const rows = Math.floor(size.height / L.step);
  const blurred = clone(img);
  let grid: Color[];
  try {
    smooth(blurred, 1, LocalSampleBlur);
    const pts: Point[] = [];
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) { pts.push({x: gx * L.step, y: gy * L.step}); }
    }
    grid = getImageColors(blurred, pts);
  } finally {
    releaseImage(blurred);
  }
  const tolSq = L.tolerance * L.tolerance;

  // The grid as one typed array per channel, and the rings as offset arrays:
  // in QuickJS that is several times cheaper than reading {r, g, b} objects,
  // and a typed array sorts numerically without a comparator callback. The
  // tests, their order and the result are what the object version gave.
  const cells = rows * cols;
  const gb = new Int16Array(cells), gg = new Int16Array(cells), gr = new Int16Array(cells);
  for (let i = 0; i < cells; i++) { const c = grid[i]; gb[i] = c.b; gg[i] = c.g; gr[i] = c.r; }
  const nIn = LargeRingInner.length, nOut = LargeRingOuter.length;
  const inX = new Int8Array(nIn), inY = new Int8Array(nIn);
  const outX = new Int8Array(nOut), outY = new Int8Array(nOut);
  for (let k = 0; k < nIn; k++) { inX[k] = LargeRingInner[k][0]; inY[k] = LargeRingInner[k][1]; }
  for (let k = 0; k < nOut; k++) { outX[k] = LargeRingOuter[k][0]; outY[k] = LargeRingOuter[k][1]; }
  // One centre's in-bounds inner samples: their cells, and copies to sort.
  const idx = new Int32Array(nIn);
  const vb = new Int16Array(nIn), vg = new Int16Array(nIn), vr = new Int16Array(nIn);

  const hits: { score: number, gx: number, gy: number }[] = [];
  for (let gy = 5; gy < rows; gy += 2) {
    for (let gx = 5; gx < cols; gx += 2) {
      let n = 0;
      for (let k = 0; k < nIn; k++) {
        const x = gx + inX[k], y = gy + inY[k];
        if (x < 0 || y < 0 || x >= cols || y >= rows) { continue; }
        const i = y * cols + x;
        idx[n] = i; vb[n] = gb[i]; vg[n] = gg[i]; vr[n] = gr[i];
        n++;
      }
      if (n < nIn * 0.8) { continue; }
      // The reference colour: the median of the inner ring, per channel. Most
      // centres have the whole ring on the frame, and sort it without a view.
      const whole = n === nIn;
      const rb = (whole ? vb : vb.subarray(0, n)).sort()[n >> 1];
      const rg = (whole ? vg : vg.subarray(0, n)).sort()[n >> 1];
      const rr = (whole ? vr : vr.subarray(0, n)).sort()[n >> 1];
      if (Math.max(rb, rg, rr) < L.minValue) { continue; }
      // Flat: the share of the inner samples within `tolerance` of it.
      let near = 0;
      for (let k = 0; k < n; k++) {
        const i = idx[k];
        const db = gb[i] - rb, dg = gg[i] - rg, dr = gr[i] - rr;
        if (db * db + dg * dg + dr * dr <= tolSq) { near++; }
      }
      const flat = near / n;
      if (flat < L.minFlat) { continue; }
      // Edge: the share of the outer ring past it, when enough of it is on
      // the frame to say.
      let on = 0, far = 0;
      for (let k = 0; k < nOut; k++) {
        const x = gx + outX[k], y = gy + outY[k];
        if (x < 0 || y < 0 || x >= cols || y >= rows) { continue; }
        const i = y * cols + x;
        const db = gb[i] - rb, dg = gg[i] - rg, dr = gr[i] - rr;
        on++;
        if (db * db + dg * dg + dr * dr > tolSq) { far++; }
      }
      if (on < nOut * 0.8 || far / on < L.minEdge) { continue; }
      hits.push({score: flat, gx: gx, gy: gy});
    }
  }
  hits.sort(function(a, b) { return b.score - a.score; });

  const out: LargeCircle[] = [];
  const apart = (L.radius + 2) * (L.radius + 2);
  const inside = L.dupReach * L.radius;
  for (let h = 0; h < hits.length; h++) {
    const x = hits[h].gx * L.step, y = hits[h].gy * L.step;
    let near = false;
    for (let i = 0; i < out.length && !near; i++) {
      const dx = out[i].x - x, dy = out[i].y - y;
      near = dx * dx + dy * dy < apart;
    }
    if (near) { continue; }
    let faces = 0;
    for (let i = 0; i < circles.length; i++) {
      const dx = circles[i].x - x, dy = circles[i].y - y;
      if (dx * dx + dy * dy <= inside * inside) { faces++; }
    }
    if (faces > L.maxInside) { continue; }
    out.push({x: x, y: y, radius: L.radius, grow: L.grow});
  }
  return out;
}

/** `circles` less those that sit inside one of `large`. */
function dropInsideLarge(circles: HoughCircle[], large: LargeCircle[]): HoughCircle[] {
  if (large.length === 0) { return circles; }
  return circles.filter(function(c) {
    return !pointInLarge(c, large, LargeTsum.dupReach);
  });
}

/** Whether `p` lies within `reach` of a large tsum's radius from its centre. */
function pointInLarge(p: Point, large: LargeCircle[], reach: number): boolean {
  for (let i = 0; i < large.length; i++) {
    const r = reach * large[i].radius;
    const dx = p.x - large[i].x;
    const dy = p.y - large[i].y;
    if (dx * dx + dy * dy <= r * r) { return true; }
  }
  return false;
}

/** A size in play-square px, scaled to the tsums on this board. */
function scaledPx(px: number): number {
  return Math.max(1, Math.round(px * Config.boardScale));
}

/** Centre-to-centre distance of two touching tsums on this board. */
function tsumSpan(): number {
  return Config.tsumWidth * Config.boardScale;
}

// Reading the tsums' size off the board (`readBoardScale`).
//
// HOUGH_GRADIENT_ALT rather than the tsum pass's HOUGH_GRADIENT: it keeps only
// near-perfect circles, so what it finds sits on real tsums and the median
// nearest-neighbour gap between them is the tsum spacing. Measured on NBC Set
// recordings: 25px on a normal board, ~22 after the first shrink, 19 late in
// the round. Normal boards (Gaston, Villains Set) never read below 0.95.
var BoardScaleRead = {
  method: 4,       // cv::HOUGH_GRADIENT_ALT
  minDist: 8,
  param1: 60,
  param2: 0.6,     // circle perfectness, 0..1
  minRadius: 5,
  maxRadius: 15,
  // Fewer circles than this is a board mid-clear or under an animation, where
  // the gaps are holes rather than neighbours.
  minCircles: 25,
  // A sparse board can go by the circles' median radius instead, so a shrunk
  // board that a skill empties and refills at full size is noticed (NBC's
  // Oogie). Noisy and low mid-clear (a full-size board reads 0.8-1.1), so only
  // asked for when the tsums can only be growing.
  minRadiusCircles: 8,
  // A full-size tsum's circle radius against `Config.tsumWidth`.
  radiusPerWidth: 0.45,
};

/**
 * The tsums' size against `Config.tsumWidth` from one board gray, or null when
 * too few clean circles were found to say. Spacing on a full board; radius on a
 * sparse one when `sparse`.
 */
function readBoardScale(grayImg: NativeImage, sparse: boolean): number | null {
  const c = BoardScaleRead;
  const found = houghCircles(grayImg, c.method, 1, c.minDist, c.param1, c.param2,
    c.minRadius, c.maxRadius);
  if (found.length < (sparse ? c.minRadiusCircles : c.minCircles)) { return null; }
  if (found.length < c.minCircles) {
    const radii = found.map(function(f) { return f.radius; });
    return skillMedian(radii) / (c.radiusPerWidth * Config.tsumWidth);
  }
  const gaps: number[] = [];
  for (let i = 0; i < found.length; i++) {
    let best = Infinity;
    for (let j = 0; j < found.length; j++) {
      if (i === j) { continue; }
      const dx = found[i].x - found[j].x;
      const dy = found[i].y - found[j].y;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; }
    }
    gaps.push(Math.sqrt(best));
  }
  gaps.sort(function(a, b) { return a - b; });
  return gaps[gaps.length >> 1] / Config.tsumWidth;
}

/**
 * How many tsums the board is showing -- `findTsums`' circle pass, counted and
 * nothing else, so no clone, no blur and no colour conversion.
 *
 * What it is for is telling a board that has finished clearing from one that is
 * still going: outside a fever the game removes a big clear's tsums slowly, and
 * that is motion too small for `Tsum.settleBoard`'s grid to call moving while
 * being most of the board a burst wants. `grayImg` is the caller's.
 */
function findTsumCount(grayImg: NativeImage): number {
  const c = TsumCircle;
  return houghCircles(grayImg, 3, c.dp, scaledPx(c.minDist), c.param1, c.param2,
    scaledPx(c.minRadius), scaledPx(c.maxRadius)).length;
}

/**
 * Locate the tsums on the board and sample each one's colour.
 *
 * `grayImg` is the shared board gray from `buildBoardGray`, which the caller
 * owns -- circle detection runs on a plain grayscale copy, NOT a colour mask.
 * The old HSV outRange masks filtered blue tsums out before detection, so their
 * circles were never found and blue chains went unplayed. Grayscale is
 * colour-agnostic: it detects every tsum, and colour is then sampled from the
 * HSV image and clustered separately in classifyTsums. The same gray is read a
 * second time for each tsum's texture -- see the texture axes below.
 */
function findTsumCircles(img: NativeImage, grayImg: NativeImage): HoughCircle[] {
  const minRadius = scaledPx(TsumCircle.minRadius);
  const points = houghCircles(grayImg, 3, TsumCircle.dp, scaledPx(TsumCircle.minDist),
    TsumCircle.param1, TsumCircle.param2, minRadius, scaledPx(TsumCircle.maxRadius));
  if (ts!.debug) {
    const debugImg = clone(img);
    try {
      for (let d = 0; d < points.length; d++) {
        const pt = points[d];
        drawCircle(debugImg, pt.x, pt.y, minRadius, 255, 0, 0, 1);
      }
      saveImage(debugImg, ts!.devicePath + "/tmp/" + ts!.runTimes + "-detectedHoughCircles.jpg");
    } finally {
      releaseImage(debugImg);
    }
  }
  return points;
}

/**
 * Sample each circle's colour and texture: `circles` from `findTsumCircles`,
 * then the large tsums from `findLargeTsums`, which carry their `grow`.
 */
function findTsums(img: NativeImage, grayImg: NativeImage,
                   circles: HoughCircle[], large: LargeCircle[]): TsumPoint[] {
  // Every native image allocated here must be released even when a native
  // call throws mid-scan: the task controller swallows task errors and
  // retries, so a leak on this hot path would silently recur on every scan.
  // `grayImg` is deliberately not on that list -- the caller allocated it.
  const hsvImg = clone(img);
  let localImg: NativeImage | null = null;
  try {
    const points: HoughCircle[] = circles.concat(large);

    // Heavy blur to smear out face features, then a 5-pixel cross average at
    // the circle center.
    //
    // Blur first, convert second, and that order matters. Blurring an image
    // that is already HSV averages hue linearly, but hue is a circle: red sits
    // at both 0 and 179, so a red tsum's blurred hue landed near 90 -- on top
    // of green. Blurring in BGR averages three linear channels and converts
    // once, which leaves red at 0. See `chromaFeature` for the rest of it.
    smooth(hsvImg, 1, scaledPx(skillColorBlur(ts!)));
    convertColor(hsvImg, 40);

    // One crossing for the whole board instead of up to five per circle. A
    // typical board is 40-60 tsums, so this was 200-300 separate reads of the
    // same image every scan; the sampling was never the cost, the crossings
    // were (the same reason `Tsum.getColors` and page scoring batch theirs).
    //
    // Every circle contributes exactly five points, in cross order, so circle
    // `i` owns samples[i*5 .. i*5+4] with no bookkeeping. A neighbour that
    // would fall off the edge is replaced by the centre coordinate rather than
    // dropped, which is precisely what the old code's `hsvN = hsv1` default
    // did: the skipped neighbour contributed the centre colour to the average.
    // Passing the out-of-range point instead would not do -- those read back as
    // transparent black and would drag the mean toward zero.
    const CrossPoints = 5;
    const pts: Point[] = [];
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      pts.push({x: p.x, y: p.y});
      pts.push({x: p.x - 1 >= 0 ? p.x - 1 : p.x, y: p.y});
      pts.push({x: p.x + 1 < Config.screenResize ? p.x + 1 : p.x, y: p.y});
      pts.push({x: p.x, y: p.y - 1 >= 0 ? p.y - 1 : p.y});
      pts.push({x: p.x, y: p.y + 1 < Config.screenResize ? p.y + 1 : p.y});
    }
    const samples = pts.length > 0 ? getImageColors(hsvImg, pts) : [];
    // The same cross off a light blur: the tsum's own centre colour, with
    // its neighbours kept out of it. The heavy blur above spans a whole tsum
    // and reads a tsum ringed by pale ice as pale itself; this read does not,
    // which is what tells an overlay on one tsum from the tsum next to it.
    localImg = clone(img);
    smooth(localImg, 1, scaledPx(LocalSampleBlur));
    convertColor(localImg, 40);
    const locals = pts.length > 0 ? getImageColors(localImg, pts) : [];
    // The texture read, off the gray the Hough pass already has.
    const textures = readTextures(grayImg, points);

    const results: TsumPoint[] = [];
    const chromaCap = skillChromaCap(ts!);
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      const base = k * CrossPoints;
      let sumb = 0, sumg = 0, sumr = 0;
      let lb = 0, lg = 0, lr = 0;
      for (let s = 0; s < CrossPoints; s++) {
        const c = samples[base + s];
        sumb += c.b; sumg += c.g; sumr += c.r;
        const l = locals[base + s];
        lb += l.b; lg += l.g; lr += l.r;
      }
      const c = chromaFeature({
        b: sumb / CrossPoints,
        g: Math.min(chromaCap, sumg / CrossPoints),
        r: sumr / CrossPoints
      });
      results.push({
        // `z` is the circle's radius, and `radius` is the native's field name
        // -- see `HoughCircle`. This read `p.r`, so `z` was `undefined` on
        // every tsum; nothing reads it, which is why nothing noticed.
        x: p.x, y: p.y, z: p.radius,
        b: c.b, g: c.g, r: c.r,
        contrast: textures[k].contrast, peak: textures[k].peak,
        local: {b: lb / CrossPoints, g: lg / CrossPoints, r: lr / CrossPoints},
        grow: (p as LargeCircle).grow,
      });
    }

    if (ts!.debug) {
      saveImage(hsvImg, ts!.devicePath + "/tmp/" + ts!.runTimes + "-hsvImg.jpg");
    }

    return results;
  } finally {
    if (localImg != null) { releaseImage(localImg); }
    releaseImage(hsvImg);
  }
}

// --- the board colour model ------------------------------------------------
//
// How a sampled tsum becomes three numbers to cluster on.
//
// Hue is an angle, and the model this replaced treated it as an ordinary
// number twice over: `cv::blur` averaged it linearly across the 0/179 wrap,
// and `classifyTsums` averaged it again into a running cluster mean. Both are
// wrong at the wrap, and red lives there. Measured over 674 red tsums on one
// recorded round, 3% of them read within 15 of red's true hue; the rest spread
// over the whole wheel with a mean of 82.6, which is where green reads (81.2).
// A red tsum was merged with a green one 22% of the time -- about as often as
// with another red (35%).
//
// So hue and saturation go down as one vector on the chroma plane, and value
// is carried separately at a weight:
//
//     (S * cos H, S * sin H, ChromaValueWeight * V)
//
// which fixes both averages at once -- there is no wrap to cross, and the mean
// of several vectors is a vector. It also disarms the other failure: a washed
// out tsum has a tiny radius rather than a wild angle, so the koalas stop
// scattering (same-colour agreement 23% -> 45%). Plain BGR was tried and is
// better than either on an evenly lit board, but it ties colour to brightness
// and collapses when the board dims -- which is what a fever stage does.
const ChromaValueWeight = 0.5;

// What counts as the same colour on the chroma plane -- the old model's 15 does
// not carry over, because the axes are not the same lengths.
//
// Swept over three hand-labelled boards (same-type and different-type tsum
// pairs) and every second of one recorded round, against the old model at its
// own 15, which merged 52.0% of same-type pairs and 2.9% of different-type
// ones for a longest chain of 4.05 and a 4+ chain on 40% of boards:
//
//     40   63.7% same   2.2% wrong   chain 4.39   4+ on 57%
//     45   67.0% same   3.4% wrong   chain 4.91   4+ on 69%
//     50   70.9% same   5.1% wrong   chain 5.75   4+ on 84%
//
// 40 is the point that beats the old model on *both* counts rather than trading
// one for the other. A wrong merge is a drag the game will not link, so the
// higher rows are worth having only if live play says those cost little.
const ChromaMergeDistance = 40;

// --- the texture axes -------------------------------------------------------
//
// What the chroma plane cannot do is tell two greys apart. A silver helmet, a
// black-and-white rabbit and a black-and-white dog all blur to a colour of
// chroma radius 7-19 -- the origin of the plane -- and differ only in value,
// at half weight: the Mandalorian, Oswald and Goofy read 22, 33 and 54 apart
// by `distance3D`, so the first two always merge and the third often joins
// them. 117 of the library's 765 tsums sit below saturation 60, where hue means
// nothing, so any roster holding two of them is exposed the same way.
//
// What does tell them apart is the picture inside the circle, in grey: how
// much it varies (a white face against black ears, or an even silver) and how
// bright it gets (a white face reaches ~250, silver ~220, the dog's muzzle
// ~230). Both are read off the board gray the Hough pass already built, from
// `TextureDisc` -- 57 points on four rings inside the head -- and carried on
// the point as `contrast` and `peak`. Measured over composite piles of the
// game's own board art: the contrast reads 36 / 62 / 52 for those three at a
// spread of 3-5, the peak 220 / 250 / 229 at a spread of 1-2; on real captures
// a pure grey cluster spreads 4-9 on the contrast and 4-7 on the peak, twice
// that under a fever or last-seconds tint. At weight 2 apiece the helmet sits
// 80 from the rabbit and the rabbit 46 from the dog; the helmet is 38 from the
// dog, still inside the merge distance, and that pair is the residual.
//
// GATED, not simply added. Sampled over every board in the corpus at these
// weights, a saturated tsum's texture varies with its tilt and its neighbours
// enough to split a real cluster in half, and a saturated colour never needed
// the help. So the axes count in full only between two samples both under a
// chroma radius of `TextureGateFull`, fade to nothing by `TextureGateOff`, and
// a chromatic tsum's distance is exactly what it was. Over the twenty-one
// in-round captures this changes four: two merges it undoes (a white Buzz from
// a grey elephant, a black-and-white face from Donald) and two where one tsum
// moves. On composite piles of the roster above the play loop's refused drags
// go from 26% to 4% at the default chain cap of 3, 35% to 13% at 5. On six
// phone captures of Mandalorian boards -- beside Oswald, a penguin, Mickey and
// Baymax, two of them in fever -- the plain distance merged the helmet with
// the black-and-white tsum on every one (20-33 of ~40 circles in one cluster);
// with the axes the helmet's cluster is pure on all six, and what remains
// merged is two black-and-white tsums on one board (Goofy with Oswald, Goofy
// with Mickey). A colour carrying no texture -- a library colour, a palette
// entry, the studio's synthetic points -- gets the plain distance.
const TextureContrastWeight = 2;
const TexturePeakWeight = 2;
/** Chroma radius at and below which the texture axes count in full. */
const TextureGateFull = 20;
/** Chroma radius at and above which they are ignored. */
const TextureGateOff = 35;
/**
 * Where the gray is read inside a circle, as offsets from its centre: the
 * centre and rings of 8, 12, 16 and 20 points at radii 3, 6, 8 and 10, all
 * inside a head of radius ~12. Denser than the colour cross because these are
 * distribution statistics: on 21 points the helmet and the rabbit sit a third
 * closer in contrast for the same spread.
 */
const TextureDisc: Point[] = (function() {
  const disc: Point[] = [{x: 0, y: 0}];
  const rings = [[3, 8], [6, 12], [8, 16], [10, 20]];
  for (let r = 0; r < rings.length; r++) {
    const radius = rings[r][0], count = rings[r][1];
    for (let k = 0; k < count; k++) {
      const a = 2 * Math.PI * k / count;
      disc.push({x: Math.round(radius * Math.cos(a)), y: Math.round(radius * Math.sin(a))});
    }
  }
  return disc;
})();

/**
 * Each circle's texture: `TextureDisc` read off the board gray in one batched
 * crossing, then the population spread and the brightest sample. A point off
 * the square is clamped onto it, the cross's own edge rule. `grayImg` is one
 * channel, which the native reports as r = g = b.
 */
function readTextures(grayImg: NativeImage, circles: Point[]): TsumTexture[] {
  const DiscPoints = TextureDisc.length;
  const edge = Config.screenResize - 1;
  // The disc shrinks with the tsums so it stays inside one head.
  const s = Config.boardScale;
  const pts: Point[] = [];
  for (let k = 0; k < circles.length; k++) {
    const p = circles[k];
    for (let d = 0; d < DiscPoints; d++) {
      const x = p.x + Math.round(TextureDisc[d].x * s);
      const y = p.y + Math.round(TextureDisc[d].y * s);
      pts.push({
        x: x < 0 ? 0 : (x > edge ? edge : x),
        y: y < 0 ? 0 : (y > edge ? edge : y),
      });
    }
  }
  const grays = pts.length > 0 ? getImageColors(grayImg, pts) : [];
  const out: TsumTexture[] = [];
  for (let k = 0; k < circles.length; k++) {
    const base = k * DiscPoints;
    let sum = 0, sumSq = 0, peak = 0;
    for (let d = 0; d < DiscPoints; d++) {
      const v = grays[base + d].r;
      sum += v; sumSq += v * v;
      if (v > peak) { peak = v; }
    }
    const mean = sum / DiscPoints;
    const variance = sumSq / DiscPoints - mean * mean;
    out.push({ contrast: variance > 0 ? Math.sqrt(variance) : 0, peak: peak });
  }
  return out;
}

/** How much of the texture axes a colour this far from grey gets: 1 down to 0. */
function textureGate(c: Color): number {
  const radius = Math.sqrt(c.b * c.b + c.g * c.g);
  if (radius <= TextureGateFull) { return 1; }
  if (radius >= TextureGateOff) { return 0; }
  return (TextureGateOff - radius) / (TextureGateOff - TextureGateFull);
}

/** An HSV sample as the board model clusters it. */
function chromaFeature(hsv: Color): Color {
  // OpenCV packs hue as degrees/2 into 0..179, so the angle is 2h degrees.
  const a = hsv.b * (Math.PI / 90);
  return {
    b: hsv.g * Math.cos(a),
    g: hsv.g * Math.sin(a),
    r: ChromaValueWeight * hsv.r
  };
}

/**
 * A cluster centre back as hue/saturation/value.
 *
 * Everything downstream of the scan reads `ts.boardClusters` as HSV -- Elsa's
 * frozen box and Formal Beast's two hue families both do -- so the model
 * changed how tsums are grouped and not what a group is then called.
 */
function chromaToHsv(c: Color): Color {
  let h = Math.atan2(c.g, c.b) * (90 / Math.PI);
  if (h < 0) { h += 180; }
  return {b: h, g: Math.sqrt(c.b * c.b + c.g * c.g), r: c.r / ChromaValueWeight};
}

// Distance between two tsum colours on the chroma plane, which is an ordinary
// Euclidean space. The HSV model this replaced needed three rebates on top of
// the same formula -- near hues, near saturations, and a dark pair -- and each
// of them was patching a pathology the plane does not have.
//
// Plus the texture axes, when both sides carry them and both are near grey --
// the block above `TextureContrastWeight` is the reasoning.
function distance3D(p1: Color & Partial<TsumTexture>, p2: Color & Partial<TsumTexture>): number {
  const db = p1.b - p2.b, dg = p1.g - p2.g, dr = p1.r - p2.r;
  let d2 = db * db + dg * dg + dr * dr;
  if (p1.contrast !== undefined && p1.peak !== undefined
      && p2.contrast !== undefined && p2.peak !== undefined) {
    const gate = textureGate(p1) * textureGate(p2);
    if (gate > 0) {
      const dc = TextureContrastWeight * (p1.contrast - p2.contrast);
      const dp = TexturePeakWeight * (p1.peak - p2.peak);
      d2 += gate * (dc * dc + dp * dp);
    }
  }
  return Math.sqrt(d2);
}

/** A cluster over `points`, its sums and means from scratch. */
function clusterOf(points: TsumPoint[]): TsumCluster {
  const c: TsumCluster = {
    sumb: 0, sumg: 0, sumr: 0, sumContrast: 0, sumPeak: 0,
    b: 0, g: 0, r: 0, contrast: 0, peak: 0, points: points,
  };
  for (let i = 0; i < points.length; i++) { clusterAdd(c, points[i], i + 1); }
  return c;
}

/** Fold `p` into the sums and means of `c`, `count` being how many it holds with `p`. */
function clusterAdd(c: TsumCluster, p: TsumPoint, count: number): void {
  // A point with no texture read -- the development tools' Board Studio feeds
  // colour-only points -- clusters on colour alone; zero here keeps the
  // running means finite and `distance3D` skips the axes for it anyway.
  c.sumb += p.b; c.sumg += p.g; c.sumr += p.r;
  c.sumContrast += p.contrast !== undefined ? p.contrast : 0;
  c.sumPeak += p.peak !== undefined ? p.peak : 0;
  c.b = c.sumb / count; c.g = c.sumg / count; c.r = c.sumr / count;
  c.contrast = c.sumContrast / count;
  c.peak = c.sumPeak / count;
}

// Greedy single pass against a drifting running mean, fixed merge threshold,
// unbounded cluster count. Each point joins the CLOSEST cluster within the
// threshold rather than the first one found: when two clusters both fall inside
// the merge distance (common once blue variants are detected), first-match
// could bleed a point into the wrong colour and drift both means; nearest-match
// keeps the assignment stable.
function classifyTsums(points: TsumPoint[]): TsumCluster[] {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  const clusters: TsumCluster[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    let bestCluster: TsumCluster | null = null;
    let minDistance = Infinity;

    // Find the closest existing cluster within threshold.
    for (let j = 0; j < clusters.length; j++) {
      const cluster = clusters[j];
      const d = distance3D(cluster, p);
      if (d < ChromaMergeDistance && d < minDistance) {
        minDistance = d;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      // Add to the nearest cluster and update its running means.
      bestCluster.points.push(p);
      clusterAdd(bestCluster, p, bestCluster.points.length);
    } else {
      clusters.push(clusterOf([p]));
    }
  }
  return clusters;
}

function detectOffsetYInGame() {
  const img = getScreenshot();
  try {
    const size = getImageSize(img);
    const centerY = Math.floor(size.height / 2);

    // find top black
    let topBlackY = 0;
    let y: number;
    let color: Color;
    for (y = centerY; y >= 0; y--) {
      color = getImageColor(img, size.width*0.9, y);
      if (isSameColor({r: 0, g: 0, b: 0}, color, 6)) {
        // black color found
        topBlackY = y;
        break;
      }
    }
    let bottomBlackY = size.height;
    for (y = centerY; y < size.height; y++) {
      color = getImageColor(img, size.width*0.9, y);
      if (isSameColor({r: 0, g: 0, b: 0}, color, 6)) {
        // black color found
        bottomBlackY = y;
        break;
      }
    }
    // One record rather than the four separate numbers this used to print:
    // they are one measurement, and reading them apart never made sense.
    logInfo(Log.Screen.DetectOffset, 'Detected the game area inside the device screen', {
      deviceWidth: size.width,
      deviceHeight: size.height,
      topBlackY: topBlackY,
      bottomBlackY: bottomBlackY,
      screenHeight: bottomBlackY - topBlackY + 1,
    });
    return -topBlackY;
  } finally {
    releaseImage(img);
  }
}

// Tsum struct

