const OPERATOR_PAGE_PATH = "/operator/calls";

export const operatorCallReviewHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Call Review · LanternBell</title>
    <link rel="stylesheet" href="${OPERATOR_PAGE_PATH}/styles.css">
    <script src="${OPERATOR_PAGE_PATH}/app.js" defer></script>
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="${OPERATOR_PAGE_PATH}" aria-label="LanternBell call review home">
        <span class="brand-mark" aria-hidden="true">LB</span>
        <span><strong>LanternBell</strong><small>Call review</small></span>
      </a>
      <div class="privacy-note"><span aria-hidden="true">●</span> Redacted operational data</div>
    </header>

    <main>
      <section class="hero" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">Operator console</p>
          <h1 id="page-title">Recent call activity</h1>
          <p>Review workflow state, escalation signals, and the latest audit events without exposing transcripts or caller details.</p>
        </div>
        <div class="connection" id="connection-status" data-state="idle" role="status" aria-live="polite">
          <span class="status-dot" aria-hidden="true"></span>
          <span id="connection-message">Sign in to load activity</span>
        </div>
      </section>

      <section class="access-panel" aria-labelledby="access-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Testing access</p>
            <h2 id="access-title">Connect to a tenant</h2>
          </div>
          <button class="button button-quiet" id="forget-button" type="button">Forget key</button>
        </div>
        <form id="access-form">
          <label>
            Tenant ID
            <input id="tenant-id" name="tenantId" value="fh-demo" autocomplete="organization" required>
          </label>
          <label>
            API key
            <input id="api-key" name="apiKey" type="password" autocomplete="current-password" required>
          </label>
          <label>
            Calls shown
            <select id="result-limit" name="limit">
              <option value="10">10</option>
              <option value="20" selected>20</option>
              <option value="50">50</option>
            </select>
          </label>
          <button class="button button-primary" type="submit">Load activity</button>
        </form>
        <p class="storage-note">The key stays in this browser tab only and is never placed in the address bar.</p>
      </section>

      <section class="summary-grid" aria-label="Call activity summary">
        <article><span>Sessions shown</span><strong id="session-count">—</strong></article>
        <article><span>In progress</span><strong id="active-count">—</strong></article>
        <article><span>Escalated</span><strong id="escalated-count">—</strong></article>
        <article><span>Last update</span><strong class="summary-time" id="latest-update">—</strong></article>
      </section>

      <section class="data-panel" aria-labelledby="sessions-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Workflow</p>
            <h2 id="sessions-title">Call sessions</h2>
          </div>
          <button class="button button-quiet" id="refresh-button" type="button" disabled>Refresh</button>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Updated</th><th>State</th><th>Intent</th><th>Escalation</th><th>Retries</th><th>Session</th></tr></thead>
            <tbody id="sessions-body"><tr><td class="empty" colspan="6">Connect to view recent sessions.</td></tr></tbody>
          </table>
        </div>
      </section>

      <section class="data-panel" aria-labelledby="events-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Audit trail</p>
            <h2 id="events-title">Recent events</h2>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Occurred</th><th>Event</th><th>Redaction</th><th>Correlation</th></tr></thead>
            <tbody id="events-body"><tr><td class="empty" colspan="4">Connect to view recent events.</td></tr></tbody>
          </table>
        </div>
      </section>
    </main>

    <footer>LanternBell Technologies · Operational view only · No raw transcripts</footer>
  </body>
</html>`;

export const operatorCallReviewCss = `:root {
  color: #1d2925;
  background: #f4f2eb;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; background: radial-gradient(circle at 82% -10%, #d7e5da 0, transparent 34rem), #f4f2eb; }
button, input, select { font: inherit; }
.site-header { display: flex; align-items: center; justify-content: space-between; padding: 1.1rem clamp(1rem, 5vw, 4rem); border-bottom: 1px solid #d8d7ce; background: rgba(250, 249, 244, .82); backdrop-filter: blur(12px); }
.brand { display: flex; align-items: center; gap: .75rem; color: inherit; text-decoration: none; }
.brand-mark { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: 50% 50% 45% 45%; background: #23483d; color: #fff9e8; font: 700 .78rem/1 Georgia, serif; letter-spacing: .08em; box-shadow: inset 0 0 0 4px #315e50; }
.brand strong, .brand small { display: block; }
.brand strong { font: 600 1.05rem/1.2 Georgia, serif; letter-spacing: .02em; }
.brand small { margin-top: .15rem; color: #66736e; font-size: .72rem; text-transform: uppercase; letter-spacing: .12em; }
.privacy-note { display: flex; gap: .45rem; align-items: center; color: #52615c; font-size: .8rem; }
.privacy-note span { color: #4f8067; font-size: .6rem; }
main { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: clamp(2rem, 5vw, 4.5rem) 0 4rem; }
.hero { display: flex; align-items: end; justify-content: space-between; gap: 2rem; margin-bottom: 2rem; }
.eyebrow { margin: 0 0 .45rem; color: #8a5b30; font-size: .72rem; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
h1, h2 { margin: 0; color: #18392f; font-family: Georgia, "Times New Roman", serif; font-weight: 500; }
h1 { font-size: clamp(2.2rem, 5vw, 4.25rem); line-height: .98; letter-spacing: -.035em; }
h2 { font-size: 1.45rem; }
.hero p:not(.eyebrow) { max-width: 45rem; margin: 1rem 0 0; color: #5d6965; font-size: 1rem; line-height: 1.6; }
.connection { display: flex; align-items: center; flex: 0 0 auto; gap: .55rem; padding: .7rem .9rem; border: 1px solid #d8d7ce; border-radius: 999px; background: #fbfaf6; color: #5d6965; font-size: .82rem; box-shadow: 0 8px 25px rgba(28, 49, 41, .06); }
.status-dot { width: .55rem; height: .55rem; border-radius: 50%; background: #9ca5a1; }
.connection[data-state="loading"] .status-dot { background: #c08841; animation: pulse 1.2s infinite; }
.connection[data-state="success"] .status-dot { background: #438363; }
.connection[data-state="error"] .status-dot { background: #b85045; }
@keyframes pulse { 50% { opacity: .35; } }
.access-panel, .data-panel { margin-top: 1rem; border: 1px solid #d8d7ce; border-radius: 1rem; background: rgba(252, 251, 247, .92); box-shadow: 0 16px 45px rgba(37, 55, 48, .06); }
.access-panel { padding: 1.35rem; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.2rem 1.35rem; }
.access-panel .panel-heading { padding: 0 0 1rem; }
form { display: grid; grid-template-columns: 1fr 1.5fr .7fr auto; gap: .8rem; align-items: end; }
label { display: grid; gap: .4rem; color: #4d5b56; font-size: .76rem; font-weight: 700; letter-spacing: .04em; }
input, select { width: 100%; min-height: 2.8rem; border: 1px solid #c9cbc3; border-radius: .55rem; padding: .65rem .75rem; background: #fff; color: #1d2925; outline: none; }
input:focus, select:focus { border-color: #3e7561; box-shadow: 0 0 0 3px rgba(62, 117, 97, .14); }
.button { min-height: 2.8rem; border: 0; border-radius: .55rem; padding: .65rem 1rem; cursor: pointer; font-weight: 750; }
.button:disabled { cursor: not-allowed; opacity: .45; }
.button-primary { background: #23483d; color: #fff; box-shadow: 0 6px 16px rgba(35, 72, 61, .2); }
.button-primary:hover { background: #18392f; }
.button-quiet { min-height: auto; border: 1px solid #d4d5cf; background: #fff; color: #43524d; }
.button-quiet:hover:not(:disabled) { border-color: #aeb5b1; background: #f6f6f2; }
.storage-note { margin: .8rem 0 0; color: #79827f; font-size: .75rem; }
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin: 1rem 0; }
.summary-grid article { min-height: 7.5rem; padding: 1.2rem; border: 1px solid #d8d7ce; border-radius: .85rem; background: #fbfaf6; }
.summary-grid span { display: block; color: #6d7773; font-size: .76rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.summary-grid strong { display: block; margin-top: 1.15rem; color: #23483d; font: 500 2.25rem/1 Georgia, serif; }
.summary-grid .summary-time { font: 650 .98rem/1.35 ui-sans-serif, system-ui, sans-serif; }
.table-scroll { overflow-x: auto; border-top: 1px solid #deded7; }
table { width: 100%; border-collapse: collapse; white-space: nowrap; }
th, td { padding: .82rem 1.35rem; border-bottom: 1px solid #e7e6df; text-align: left; font-size: .8rem; }
th { color: #68736f; background: #f6f5f0; font-size: .68rem; letter-spacing: .08em; text-transform: uppercase; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td:not(.empty) { background: #faf9f4; }
.empty { height: 5.5rem; color: #7b8581; text-align: center; }
.pill { display: inline-flex; align-items: center; padding: .25rem .55rem; border-radius: 999px; background: #e9eeeb; color: #345448; font-size: .7rem; font-weight: 800; letter-spacing: .04em; }
.pill[data-state="ESCALATE"] { background: #f7dfdb; color: #8b342c; }
.pill[data-state="END_CALL"] { background: #e3ebe6; color: #37674e; }
.pill[data-state="RESOLVE_REQUEST"] { background: #f3e8cf; color: #795820; }
.identifier { color: #65716c; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .72rem; }
.score-high { color: #a33d34; font-weight: 800; }
footer { padding: 1.6rem 1rem 2.5rem; color: #7a827e; text-align: center; font-size: .72rem; letter-spacing: .04em; }
@media (max-width: 850px) { form { grid-template-columns: 1fr 1fr; } .summary-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 600px) { .privacy-note { display: none; } .hero { align-items: start; flex-direction: column; } .connection { width: 100%; } form, .summary-grid { grid-template-columns: 1fr; } .summary-grid article { min-height: 5.5rem; } .summary-grid strong { margin-top: .75rem; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; animation: none !important; } }
`;

export const operatorCallReviewJavaScript = `'use strict';

const form = document.querySelector('#access-form');
const tenantInput = document.querySelector('#tenant-id');
const apiKeyInput = document.querySelector('#api-key');
const limitInput = document.querySelector('#result-limit');
const forgetButton = document.querySelector('#forget-button');
const refreshButton = document.querySelector('#refresh-button');
const connectionStatus = document.querySelector('#connection-status');
const connectionMessage = document.querySelector('#connection-message');
const sessionsBody = document.querySelector('#sessions-body');
const eventsBody = document.querySelector('#events-body');

const storedTenant = sessionStorage.getItem('lanternbell.operator.tenant');
const storedKey = sessionStorage.getItem('lanternbell.operator.key');
if (storedTenant) tenantInput.value = storedTenant;
if (storedKey) apiKeyInput.value = storedKey;

form.addEventListener('submit', function (event) {
  event.preventDefault();
  sessionStorage.setItem('lanternbell.operator.tenant', tenantInput.value.trim());
  sessionStorage.setItem('lanternbell.operator.key', apiKeyInput.value);
  loadActivity();
});

refreshButton.addEventListener('click', loadActivity);
forgetButton.addEventListener('click', function () {
  sessionStorage.removeItem('lanternbell.operator.tenant');
  sessionStorage.removeItem('lanternbell.operator.key');
  apiKeyInput.value = '';
  refreshButton.disabled = true;
  resetSummary();
  replaceWithMessage(sessionsBody, 6, 'Connect to view recent sessions.');
  replaceWithMessage(eventsBody, 4, 'Connect to view recent events.');
  setConnection('idle', 'Key forgotten');
  apiKeyInput.focus();
});

async function loadActivity() {
  const tenantId = tenantInput.value.trim();
  const apiKey = apiKeyInput.value;
  if (!tenantId || !apiKey) {
    setConnection('error', 'Tenant ID and API key are required');
    return;
  }

  setConnection('loading', 'Loading activity…');
  refreshButton.disabled = true;
  try {
    const endpoint = '/v1/tenants/' + encodeURIComponent(tenantId) + '/diagnostics/activity?limit=' + encodeURIComponent(limitInput.value);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + apiKey },
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || payload.error || 'Unable to load activity.');
    renderActivity(payload);
    setConnection('success', 'Connected · ' + formatDate(new Date().toISOString()));
    refreshButton.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load activity.';
    setConnection('error', message);
    refreshButton.disabled = false;
  }
}

function renderActivity(activity) {
  const sessions = Array.isArray(activity.sessions) ? activity.sessions : [];
  const events = Array.isArray(activity.recentEvents) ? activity.recentEvents : [];
  document.querySelector('#session-count').textContent = String(sessions.length);
  document.querySelector('#active-count').textContent = String(sessions.filter(function (item) { return item.currentState !== 'END_CALL'; }).length);
  document.querySelector('#escalated-count').textContent = String(sessions.filter(function (item) { return item.currentState === 'ESCALATE'; }).length);
  document.querySelector('#latest-update').textContent = sessions.length ? formatDate(sessions[0].updatedAt) : 'No calls yet';

  sessionsBody.replaceChildren();
  if (!sessions.length) replaceWithMessage(sessionsBody, 6, 'No sessions found for this tenant.');
  sessions.forEach(function (session) {
    const row = document.createElement('tr');
    appendCell(row, formatDate(session.updatedAt));
    const stateCell = document.createElement('td');
    const state = document.createElement('span');
    state.className = 'pill';
    state.dataset.state = session.currentState;
    state.textContent = friendlyLabel(session.currentState);
    stateCell.append(state);
    row.append(stateCell);
    appendCell(row, session.intent ? friendlyLabel(session.intent) : 'Not identified');
    const scoreCell = appendCell(row, String(session.escalationScore));
    if (Number(session.escalationScore) >= 50) scoreCell.classList.add('score-high');
    appendCell(row, String(session.retryCount));
    const idCell = appendCell(row, shorten(session.sessionId));
    idCell.classList.add('identifier');
    idCell.title = session.sessionId;
    sessionsBody.append(row);
  });

  eventsBody.replaceChildren();
  if (!events.length) replaceWithMessage(eventsBody, 4, 'No recent events found for this tenant.');
  events.forEach(function (event) {
    const row = document.createElement('tr');
    appendCell(row, formatDate(event.occurredAt));
    appendCell(row, friendlyLabel(event.eventType));
    appendCell(row, friendlyLabel(event.redactionStatus));
    const idCell = appendCell(row, shorten(event.correlationId));
    idCell.classList.add('identifier');
    idCell.title = event.correlationId;
    eventsBody.append(row);
  });
}

function appendCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  row.append(cell);
  return cell;
}

function replaceWithMessage(body, columns, message) {
  body.replaceChildren();
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.className = 'empty';
  cell.colSpan = columns;
  cell.textContent = message;
  row.append(cell);
  body.append(row);
}

function setConnection(state, message) {
  connectionStatus.dataset.state = state;
  connectionMessage.textContent = message;
}

function resetSummary() {
  ['#session-count', '#active-count', '#escalated-count', '#latest-update'].forEach(function (selector) {
    document.querySelector(selector).textContent = '—';
  });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit'
  }).format(date);
}

function friendlyLabel(value) {
  return String(value || 'unknown').toLowerCase().split('_').map(function (part) {
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}

function shorten(value) {
  const text = String(value || '');
  return text.length > 16 ? text.slice(0, 8) + '…' + text.slice(-5) : text;
}

if (storedTenant && storedKey) loadActivity();
`;

export const operatorPageSecurityHeaders: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

export type OperatorPageAsset = {
  body: string;
  contentType: string;
};

export function operatorPageAsset(path: string): OperatorPageAsset | undefined {
  if (path === OPERATOR_PAGE_PATH || path === `${OPERATOR_PAGE_PATH}/`) {
    return { body: operatorCallReviewHtml, contentType: "text/html; charset=utf-8" };
  }
  if (path === `${OPERATOR_PAGE_PATH}/styles.css`) {
    return { body: operatorCallReviewCss, contentType: "text/css; charset=utf-8" };
  }
  if (path === `${OPERATOR_PAGE_PATH}/app.js`) {
    return { body: operatorCallReviewJavaScript, contentType: "text/javascript; charset=utf-8" };
  }
  return undefined;
}

export function isOperatorPagePath(method: string, path: string): boolean {
  return method === "GET" && operatorPageAsset(path) !== undefined;
}
