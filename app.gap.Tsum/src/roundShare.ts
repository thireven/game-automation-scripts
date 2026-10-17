// ---------------------------------------------------------------------------
// Share round stats
//
// Sends new rows of stats/stats_*.csv to the ROUND_STATS_URL env var
// (gap-env.json), which the user sets on this script's Library card in GAP,
// where network access has to be allowed too. The request names the env var
// (`env:ROUND_STATS_URL`), never the URL. Off when the var is blank, when
// the Share round stats setting is off, or when round stats are not recorded
// (nothing calls it then: `writeRoundStats` is the one caller).
//
// The CSV files are the queue. Each row's `id` starts with its round's UTC
// time, so remembering the last id the server accepted per file (the cursor,
// `round_share_cursor.json` beside the CSVs) is enough to know what is left.
// The cursor moves only after the server answers `{"ok": true}`, so a failure
// costs a re-send, never a loss; the server drops duplicates by id.
//
// Sent with `httpRequest`, so the round loop never waits on the server; the
// reply comes back as a network event (`roundShareOnEvent`). One request in
// flight at a time, and a try at most once a minute. Anything but `ok: true`
// backs off: 30s, doubling, up to 30min. Nothing here may throw into the
// round loop.
// ---------------------------------------------------------------------------

const RoundShareSchema = 'gap.round-stats/1';
const RoundShareIntervalMs = 60 * 1000;
const RoundShareMaxRows = 50;
const RoundShareBackoffMinMs = 30 * 1000;
const RoundShareBackoffMaxMs = 30 * 60 * 1000;
const RoundShareCursorFile = 'round_share_cursor.json';
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
  id: number; at: number; devicePath: string; source: string; lastId: string; rows: number;
} | null = null;
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
  if (!tsum.sendRoundStats || !tsum.trackRoundStats || !roundShareEnabled()) {
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

/** Forgets what was sent; turning sharing off calls this. */
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
      source: source,
      sentAt: new Date().toISOString(),
      records: batch.records,
    });
    if (!gRoundShareListening) {
      gRoundShareListening = true;
      addNetworkListener(roundShareOnEvent);
    }
    const id = httpRequest('POST', RoundShareRef, body, { 'Content-Type': 'application/json' });
    gRoundShareInFlight = { id: id, at: Date.now(), devicePath: devicePath, source: source, lastId: batch.lastId, rows: batch.records.length };
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
    const reply = event.type === 'done' ? event.body || '' : '';
    if (roundShareAccepted(reply)) {
      roundShareKeep(sent.devicePath, sent.source, sent.lastId);
      gRoundShareFailures = 0;
      gRoundShareRetryAt = 0;
      logInfo(Log.Stats.Shared, 'Shared round stats', { source: sent.source, rows: sent.rows });
      return;
    }
    gRoundShareFailures++;
    const wait = Math.min(RoundShareBackoffMaxMs,
      RoundShareBackoffMinMs * Math.pow(2, gRoundShareFailures - 1));
    gRoundShareRetryAt = Date.now() + wait;
    logWarn(Log.Stats.ShareFailed, 'The stats server did not accept the rows', {
      source: sent.source,
      status: event.status,
      error: event.error || '',
      reply: reply.substring(0, 200),
      retryInSec: Math.round(wait / 1000),
    });
  } catch (e) {
    if (!gRoundShareThrew) {
      gRoundShareThrew = true;
      logWarn(Log.Stats.ShareFailed, 'Could not share round stats', { errorText: '' + e });
    }
  }
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

/** Accepted only when the reply is JSON carrying `ok: true`. */
function roundShareAccepted(reply: string): boolean {
  try {
    const parsed = JSON.parse(reply);
    return !!parsed && parsed.ok === true;
  } catch (e) {
    return false;
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
