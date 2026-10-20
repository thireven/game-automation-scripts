// ---------------------------------------------------------------------------
// Share round stats
//
// Sends new rows of stats/stats_*.csv to the ROUND_STATS_URL env var
// (gap-env.json; the global stats site by default). GAP sends only while the
// user has turned on env vars and network access on this script's Library
// card. The request names the env var (`env:ROUND_STATS_URL`), never the URL.
// Off when the var is blank, when the Share round stats setting is off, or
// when round stats are not recorded (`writeRoundStats` is the one caller).
//
// The first upload carries no key: the site joins this device as a
// contributor and answers with a key (tsum-stats CONTRACT §2.2.1), kept in
// `round_share_key.json` in the device folder with the URL it came from, and
// sent as a Bearer key from then on, only to that URL. A 401 drops it.
//
// The CSV files are the queue. Each row's `id` starts with its round's UTC
// time, so remembering the last id the server accepted per file (the cursor,
// `round_share_cursor.json` beside the CSVs) is enough to know what is left.
// The cursor moves only after the server answers `{"ok": true}`, so a failure
// costs a re-send, never a loss; the server drops duplicates by id.
//
// Sent with `httpRequest`, so the round loop never waits on the server; the
// reply comes back as a network event (`roundShareOnEvent`). One request in
// flight at a time, and a try at most every 15 minutes, so each carries
// several rounds. The site's daily limits wait for 00:00 UTC; any other
// failure backs off: 30s, doubling, up to 30min. Nothing here may throw into
// the round loop.
// ---------------------------------------------------------------------------

const RoundShareSchema = 'gap.round-stats/1';
const RoundShareIntervalMs = 15 * 60 * 1000;
const RoundShareMaxRows = 50;
const RoundShareBackoffMinMs = 30 * 1000;
const RoundShareBackoffMaxMs = 30 * 60 * 1000;
const RoundShareCursorFile = 'round_share_cursor.json';
const RoundShareKeyFile = 'round_share_key.json';
const RoundShareRef = 'env:ROUND_STATS_URL';
/** A reply this late is taken as lost (the host drops queued work on a reload). */
const RoundShareLostMs = 5 * 60 * 1000;

/** Per run: when the last send was tried, and the backoff after failures. */
let gRoundShareLastAt = 0;
let gRoundShareFailures = 0;
let gRoundShareRetryAt = 0;
/** An unexpected throw is logged once a run, not once a round. */
let gRoundShareThrew = false;
/** The request waiting on a reply, and what to remember when it is accepted. */
let gRoundShareInFlight: {
  id: number; at: number; devicePath: string; url: string; source: string;
  /** The cursor before this batch, and the batch's ids in order. */
  after: string; ids: string[];
} | null = null;
/** Said once a run: sharing is on, but GAP is not letting the script send. */
let gRoundShareToldOff = false;
let gRoundShareListening = false;
/**
 * Past days' files found fully sent. Rows only ever land in today's file, so
 * these are not read again; without it every pass re-read the whole history.
 */
let gRoundShareSentFiles: { [source: string]: true } = {};

/** The server's address, if the user set one and the host can send to it. */
function roundShareEnabled(): boolean {
  return typeof getEnv === 'function' && typeof httpRequest === 'function' &&
    typeof addNetworkListener === 'function' && !!getEnv('ROUND_STATS_URL');
}

/** Called after a round's row is written. Sends one batch if one is due. */
function roundShareAfterRow(tsum: Tsum): void {
  if (!tsum.sendRoundStats || !tsum.trackRoundStats) {
    return;
  }
  if (!roundShareEnabled()) {
    if (!gRoundShareToldOff) {
      gRoundShareToldOff = true;
      logWarn(Log.Stats.ShareFailed, 'Share round stats is on, but GAP has env vars or the stats server off for this script');
    }
    return;
  }
  const now = Date.now();
  if (gRoundShareInFlight && now - gRoundShareInFlight.at > RoundShareLostMs) {
    gRoundShareInFlight = null;
  }
  if (gRoundShareInFlight || now - gRoundShareLastAt < RoundShareIntervalMs || now < gRoundShareRetryAt) {
    return;
  }
  gRoundShareLastAt = now;
  try {
    roundShareOnce(tsum.devicePath);
  } catch (e) {
    if (!gRoundShareThrew) {
      gRoundShareThrew = true;
      logWarn(Log.Stats.ShareFailed, 'Could not share round stats', { errorText: '' + e });
    }
  }
}

/**
 * Forgets what was sent; turning sharing off calls this. The key stays, so
 * turning it back on re-sends under the same contributor, which the site
 * answers as unchanged.
 */
function roundShareClear(devicePath: string): void {
  const path = roundShareCursorPath(devicePath);
  try {
    const text = readFile(path);
    if (text && text.trim() !== '{}') {
      writeFile(path, '{}');
    }
  } catch (e) {
    // Nothing to clear.
  }
  gRoundShareFailures = 0;
  gRoundShareRetryAt = 0;
  gRoundShareInFlight = null;
  gRoundShareSentFiles = {};
}

function roundShareCursorPath(devicePath: string): string {
  return devicePath + '/' + Config.statsDir + '/' + RoundShareCursorFile;
}

/** One pass: the oldest file with unsent rows gets one request. The reply is handled by `roundShareOnEvent`. */
function roundShareOnce(devicePath: string): void {
  const dir = devicePath + '/' + Config.statsDir;
  // listDir answers sorted names, so the oldest file is simply the first.
  const names = listDir(dir).filter((name) => /^stats_\d+\.csv$/.test(name));
  const cursorPath = roundShareCursorPath(devicePath);
  const cursor = roundShareReadCursor(cursorPath);
  const newest = names[names.length - 1];
  for (const name of names) {
    const source = Config.statsDir + '/' + name;
    if (gRoundShareSentFiles[source]) {
      continue;
    }
    const batch = roundShareRows(readFile(dir + '/' + name), cursor[source] || '');
    if (batch.records.length === 0) {
      if (name !== newest) {
        gRoundShareSentFiles[source] = true;
      }
      continue;
    }
    const body = JSON.stringify({
      schema: RoundShareSchema,
      script: { id: GAP_SCRIPT_ID },
      client: GAP_SCRIPT_ID + '/' + ScriptVersion,
      source: source,
      sentAt: new Date().toISOString(),
      records: batch.records,
    });
    if (!gRoundShareListening) {
      gRoundShareListening = true;
      addNetworkListener(roundShareOnEvent);
    }
    const url = '' + getEnv('ROUND_STATS_URL');
    const headers: { [name: string]: string } = { 'Content-Type': 'application/json' };
    const key = roundShareReadKey(devicePath, url);
    if (key) {
      headers['Authorization'] = 'Bearer ' + key;
    }
    const id = httpRequest('POST', RoundShareRef, body, headers);
    gRoundShareInFlight = {
      id: id, at: Date.now(), devicePath: devicePath, url: url, source: source,
      after: cursor[source] || '', ids: batch.records.map((r) => r.id),
    };
    return;
  }
}

/** The reply to the request in flight: move the cursor on `ok: true`, else back off. */
function roundShareOnEvent(event: NetworkEvent): void {
  const sent = gRoundShareInFlight;
  if (!sent || event.id !== sent.id || (event.type !== 'done' && event.type !== 'failed' && event.type !== 'refused')) {
    return;
  }
  gRoundShareInFlight = null;
  try {
    const text = event.type === 'done' ? event.body || '' : '';
    const reply = roundShareParse(text);
    // A keyless upload's reply carries the new key, even when the batch was refused.
    if (reply && typeof reply.key === 'string' && reply.key !== '') {
      roundShareSaveKey(sent.devicePath, sent.url, reply.key, reply.id);
    }
    if (reply && reply.ok === true) {
      const lastId = roundShareCursorAfter(sent.after, sent.ids, reply.retry);
      if (lastId !== sent.after) {
        roundShareKeep(sent.devicePath, sent.source, lastId);
      }
      gRoundShareFailures = 0;
      gRoundShareRetryAt = 0;
      logInfo(Log.Stats.Shared, 'Shared round stats', {
        source: sent.source, rows: sent.ids.length, accepted: reply.accepted, rejected: reply.rejected,
      });
      return;
    }
    const error = reply && typeof reply.error === 'string' ? reply.error : '';
    let wait: number;
    if (event.status === 401 && error === 'unauthorized') {
      // The key was unlinked or is unknown: the next try joins afresh.
      roundShareForgetKey(sent.devicePath);
      wait = 0;
    } else if (error === 'quota' || error === 'join-limit' || error === 'budget') {
      // The site's daily limits lift at 00:00 UTC.
      const day = 24 * 60 * 60 * 1000;
      wait = day - Date.now() % day;
    } else {
      gRoundShareFailures++;
      wait = Math.min(RoundShareBackoffMaxMs, RoundShareBackoffMinMs * Math.pow(2, gRoundShareFailures - 1));
    }
    gRoundShareRetryAt = Date.now() + wait;
    logWarn(Log.Stats.ShareFailed, 'The stats server did not accept the rows', {
      source: sent.source,
      status: event.status,
      error: event.error || error,
      reply: text.substring(0, 200),
      retryInSec: Math.round(wait / 1000),
    });
  } catch (e) {
    if (!gRoundShareThrew) {
      gRoundShareThrew = true;
      logWarn(Log.Stats.ShareFailed, 'Could not share round stats', { errorText: '' + e });
    }
  }
}

/**
 * The cursor once a batch is accepted: its last id, or, when the site asked
 * for some rows again later (`retry`: the device clock is ahead of the
 * site's), the last id before the first of them, so they go out next pass.
 */
function roundShareCursorAfter(after: string, ids: string[], retry: unknown): string {
  const again = Array.isArray(retry) ? retry.filter((id) => typeof id === 'string') as string[] : [];
  let last = after;
  for (const id of ids) {
    if (again.indexOf(id) >= 0) {
      break;
    }
    last = id;
  }
  return last;
}

function roundShareKeyPath(devicePath: string): string {
  return devicePath + '/' + RoundShareKeyFile;
}

/** The saved key, if it came from `url`: a key is never sent to another server. */
function roundShareReadKey(devicePath: string, url: string): string {
  try {
    const saved = JSON.parse(readFile(roundShareKeyPath(devicePath)) || '{}');
    return saved && saved.url === url && typeof saved.key === 'string' ? saved.key : '';
  } catch (e) {
    return '';
  }
}

function roundShareSaveKey(devicePath: string, url: string, key: string, id: unknown): void {
  writeFile(roundShareKeyPath(devicePath), JSON.stringify({ url: url, id: id, key: key }));
}

function roundShareForgetKey(devicePath: string): void {
  writeFile(roundShareKeyPath(devicePath), '{}');
}

/** Records `lastId` as accepted for `source`, dropping files that are gone so the cursor stays small. */
function roundShareKeep(devicePath: string, source: string, lastId: string): void {
  const dir = devicePath + '/' + Config.statsDir;
  const names = listDir(dir);
  const cursorPath = roundShareCursorPath(devicePath);
  const cursor = roundShareReadCursor(cursorPath);
  const kept: { [source: string]: string } = {};
  for (const name of names) {
    const key = Config.statsDir + '/' + name;
    if (cursor[key]) {
      kept[key] = cursor[key];
    }
  }
  kept[source] = lastId;
  writeFile(cursorPath, JSON.stringify(kept));
}

/** The cursor file: source path -> last id accepted. Empty when unreadable. */
function roundShareReadCursor(path: string): { [source: string]: string } {
  try {
    const parsed = JSON.parse(readFile(path) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

/** The reply as a JSON object, or null when it is not one. */
function roundShareParse(reply: string): { [field: string]: any } | null {
  try {
    const parsed = JSON.parse(reply);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * Rows newer than `after`, keyed by the file's own header, up to
 * `RoundShareMaxRows`. A last line with no newline may be half written, so it
 * waits for the next pass.
 */
function roundShareRows(text: string, after: string): { records: { [column: string]: string }[]; lastId: string } {
  const records: { [column: string]: string }[] = [];
  let lastId = after;
  text = text || '';
  const headerEnd = text.indexOf('\n');
  if (headerEnd < 0) {
    return { records: records, lastId: lastId };
  }
  const header = statsParseCsvLine(text.substring(0, headerEnd).replace(/\r$/, ''));
  const idColumn = header.indexOf('id');
  if (idColumn < 0) {
    return { records: records, lastId: lastId };
  }
  // Rows are appended in id order, so a file whose last row is already sent has
  // nothing newer: answer off that one line instead of parsing the whole file.
  const lastRow = roundShareLastRowId(text, idColumn);
  if (after !== '' && lastRow !== '' && lastRow <= after) {
    return { records: records, lastId: lastId };
  }
  const lines = text.split('\n');
  if (!text.endsWith('\n')) {
    lines.pop();
  }
  for (let i = 1; i < lines.length && records.length < RoundShareMaxRows; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (line === '') {
      continue;
    }
    const cells = statsParseCsvLine(line);
    const id = cells[idColumn] || '';
    // Ids sort by time, so a string compare is "newer than".
    if (id === '' || id <= lastId) {
      continue;
    }
    const record: { [column: string]: string } = {};
    header.forEach((column, at) => {
      if (column !== '') {
        record[column] = cells[at] !== undefined ? cells[at] : '';
      }
    });
    records.push(record);
    lastId = id;
  }
  return { records: records, lastId: lastId };
}

/** The id on the last complete row, or '' when there is no row after the header. */
function roundShareLastRowId(text: string, idColumn: number): string {
  let end = text.lastIndexOf('\n');
  while (end > 0) {
    const start = text.lastIndexOf('\n', end - 1) + 1;
    if (start === 0) {
      return '';
    }
    const line = text.substring(start, end).replace(/\r$/, '');
    if (line !== '') {
      return statsParseCsvLine(line)[idColumn] || '';
    }
    end = start - 1;
  }
  return '';
}
