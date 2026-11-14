/**
 * Supabase sync — Phase 1 (dual-write)
 * -----------------------------------------------------------------------------
 * Sends the Sheet's Transactions, Card events, App data and Plan tabs to the new app's database after
 * every hourly collection. The Sheet stays the source of truth: rows you or the daily check add, edit or
 * delete here are mirrored there on the next run.
 *
 * Setup, once:
 *   1. Add this as a NEW file in the Apps Script project (+ next to Files → Script, name it "supabase-sync").
 *   2. Project Settings (gear) → Script Properties → Add script property:
 *        Property: ingestSecret     Value: the sync secret Claude gave you
 *      The secret lives there, never in the code.
 *   3. Back in the editor pick setupSupabaseSync in the function list and press Run. The log shows the result.
 *   4. Pick installRefreshCheck and press Run once: the app's Refresh button then runs the collector within a minute.
 *
 * From Phase 3 the app owns your settings, planner choices, card payments, goals and payee rules. Each sync brings
 * the app's copy back and writes it into the App data tab, so the old dashboard and the daily check see your changes.
 */

var INGEST_URL = 'https://ftnxpufopkosqrtjtkhi.supabase.co/functions/v1/ingest';

/** Run once after adding the ingestSecret property: does a first sync and logs the result. */
function setupSupabaseSync() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) PropertiesService.getScriptProperties().setProperty('sheetId', ss.getId());
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var r;
  try { r = syncToSupabase('first sync from Apps Script'); } finally { lock.releaseLock(); }
  console.log(r);
  return r;
}

/** Called by the collector after each run, and from the Money menu. Never throws. */
function syncToSupabase(runMessage) {
  try {
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('ingestSecret');
    if (!secret) return 'Supabase sync is not set up yet.';
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(props.getProperty('sheetId'));
    var tab = function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 1) return [];
      return sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    };
    var body = JSON.stringify({
      sentAt: new Date().toISOString(),
      sheetId: ss.getId(),             // the endpoint refuses any other spreadsheet (e.g. the baseline copy)
      complete: true,
      tabs: { transactions: tab('Transactions'), cardEvents: tab('Card events'), appData: tab('App data'), plan: tab('Plan') },
      run: { message: runMessage || 'manual sync' }
    });
    var time = String(Date.now());
    var sig = Utilities.computeHmacSha256Signature(time + '.' + body, secret, Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    var res = UrlFetchApp.fetch(INGEST_URL, {
      method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true,
      headers: { 'x-money-time': time, 'x-money-signature': sig }
    });
    var code = res.getResponseCode(), out = {};
    try { out = JSON.parse(res.getContentText()); } catch (e) {}
    var msg = code === 200
      ? 'Synced to the new app: ' + (out.counts ? out.counts.transactions : '?') + ' transactions'
      : 'Sync to the new app failed (' + code + '): ' + (out.error || res.getContentText()).slice(0, 200);
    if (code === 200 && out.appData && typeof writeAppData_ === 'function') {
      writeAppData_(out.appData);                     // the app's settings, back into the App data tab
      msg += ' · app settings v' + out.appVersion + ' copied to App data';
    }
    props.setProperty('lastSync', JSON.stringify({ at: time, code: code, msg: msg }));
    return msg;
  } catch (err) {
    return 'Sync to the new app failed: ' + err;
  }
}

/** Every minute: has the app's Refresh button asked for a run? If so, collect now (which also syncs). */
function checkRefresh() {
  var secret = PropertiesService.getScriptProperties().getProperty('ingestSecret');
  if (!secret) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('sheetId'));
  var body = JSON.stringify({ kind: 'poll', sheetId: ss.getId(), sentAt: new Date().toISOString() });
  var time = String(Date.now());
  var sig = Utilities.computeHmacSha256Signature(time + '.' + body, secret, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  try {
    var res = UrlFetchApp.fetch(INGEST_URL, { method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true,
      headers: { 'x-money-time': time, 'x-money-signature': sig } });
    var out = JSON.parse(res.getContentText() || '{}');
    if (out.refresh) collect();
  } catch (e) { console.warn('refresh check: ' + e); }
}

/** Run once: installs the every-minute refresh check. */
function installRefreshCheck() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkRefresh') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkRefresh').timeBased().everyMinutes(1).create();
  console.log('Refresh check installed: the app can now ask the collector to run.');
  return 'ok';
}

function syncNow() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'The collector is running; try again in a minute.';
  var r;
  try { r = syncToSupabase('manual sync from the menu'); } finally { lock.releaseLock(); }
  try { SpreadsheetApp.getUi().alert(r); } catch (e) {}
  return r;
}
