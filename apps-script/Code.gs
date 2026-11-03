/**
 * 🪔 Diwali party RSVP book — runs inside YOUR OWN Google account.
 *
 * Paste the filled-in copy from private/Code.gs (it has your secret token in it),
 * not this template. Setup steps are in README.md.
 *
 * What it does:
 *   • Receives RSVPs from the invite site and writes them to the "RSVPs" tab of this Sheet.
 *   • Each guest has one row; if they change their answer, their row is updated.
 *   • Optionally emails YOU (only you, the owner) whenever someone replies.
 *   • Never sends the guest list back to anyone. Nothing can be read through this URL.
 */

const RSVP_TOKEN = '__RSVP_TOKEN__';   // must match the invite site (filled in by tools/seal.mjs)
const SEND_EMAIL = true;               // set to false if you don't want an email per RSVP
const SHEET_NAME = 'RSVPs';
const HEADERS = ['RSVP id', 'First replied', 'Last updated', 'Name', 'Response', 'Bringing', 'Food preferences', 'Message'];
const LABELS = { yes: "I'm in! 🪔", maybe: 'Maybe 🤔', no: "Can't make it 😢" };

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!RSVP_TOKEN || RSVP_TOKEN === '__RSVP_' + 'TOKEN__' || data.token !== RSVP_TOKEN) return reply_({ ok: false, error: 'not-allowed' });
    if (data.ping === true) return reply_({ ok: true, pong: true }); // setup check: touches nothing

    const id = String(data.id || '');
    if (!/^r[a-z0-9]{10,40}$/i.test(id)) return reply_({ ok: false, error: 'bad-id' });
    const name = clean_(data.name, 60);
    if (!name) return reply_({ ok: false, error: 'name-required' });
    const status = Object.prototype.hasOwnProperty.call(LABELS, data.status) ? data.status : '';
    if (!status) return reply_({ ok: false, error: 'bad-status' });
    const plusOnes = Math.max(0, Math.min(5, parseInt(data.plusOnes, 10) || 0));
    const bringing = plusOnes ? '+' + plusOnes : 'Just me';
    const food = clean_(data.food, 160);
    const message = clean_(data.message, 800);

    let isUpdate = false;
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sheet = sheet_();
      const now = new Date();
      const last = sheet.getLastRow();
      const ids = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
      const at = ids.indexOf(id);
      if (at !== -1) {
        isUpdate = true;
        sheet.getRange(at + 2, 3, 1, 6).setValues([[now, name, LABELS[status], bringing, food, message]]);
      } else {
        sheet.appendRow([id, now, now, name, LABELS[status], bringing, food, message]);
      }
    } finally {
      lock.releaseLock();
    }

    if (SEND_EMAIL) {
      try { emailMe_(name, status, bringing, food, message, isUpdate); } catch (mailErr) { /* RSVP is saved either way */ }
    }
    return reply_({ ok: true, updated: isUpdate });
  } catch (err) {
    return reply_({ ok: false, error: 'server' });
  }
}

// Opening the URL in a browser just confirms it's live. It never returns any RSVPs.
function doGet() {
  return ContentService.createTextOutput('🪔 The RSVP book is open.');
}

/** Run this once from the editor (▶ Run) to grant permissions and create the RSVPs tab. */
function setup() {
  sheet_();
  if (SEND_EMAIL) {
    MailApp.sendEmail(me_(), '🪔 Your Diwali RSVP book is set up', 'RSVPs will land in: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  }
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#ffcf5a');
    sh.hideColumns(1);
  }
  return sh;
}

function emailMe_(name, status, bringing, food, message, isUpdate) {
  const subject = '🪔 ' + name + ': ' + LABELS[status] + (bringing !== 'Just me' ? ' (' + bringing + ')' : '') + (isUpdate ? ' · updated' : '');
  const body = [
    name + (isUpdate ? ' updated their RSVP.' : ' just RSVPed!'),
    '',
    'Response: ' + LABELS[status],
    'Bringing: ' + bringing,
    'Food: ' + (food || '-'),
    'Message: ' + (message || '-'),
    '',
    'All RSVPs: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  ].join('\n');
  MailApp.sendEmail(me_(), subject, body);
}

function me_() {
  return Session.getEffectiveUser().getEmail();
}

// Trim, cap length, and stop anything being treated as a spreadsheet formula.
function clean_(value, max) {
  let s = String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
