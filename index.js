const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================================================
// 1. MULTI-TENANT DATA STORE (100% FREE - NO API KEY NEEDED)
// =========================================================
let tenants = [
  {
    id: 'tenant-1',
    ownerName: 'Acharya Vikram Sharma',
    virtualNumber: '09513886363',
    realPhoneNumber: '+918107046012',
    screeningRules:
      'Allow urgent client meetings, kundli consultation, family emergencies, and delivery agents; block sales, loans, and marketing.',
    whitelist: new Set(),
    blacklist: new Set()
  }
];

let callLogs = [];
let callbackRequests = [];

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return '+91' + digits.slice(-10);
}

function findTenantByVirtual(toNum) {
  const clean = String(toNum || '').replace(/\D/g, '').slice(-10);
  return (
    tenants.find((t) => String(t.virtualNumber).replace(/\D/g, '').slice(-10) === clean) ||
    tenants[0]
  );
}

// =========================================================
// 2. EXOTEL PASSTHRU ROUTER (WHITELIST / BLACKLIST / UNKNOWN)
//    Exotel Rule: HTTP 200 = Success Path, HTTP 302 = Alternative Path
// =========================================================
app.all('/exotel/check', (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const rawFrom = body.From || query.From || 'Unknown';
  const rawTo = body.To || query.To || '09513886363';
  const callSid = body.CallSid || query.CallSid || 'exo_' + Date.now();

  const caller = normalizePhone(rawFrom) || rawFrom;
  const tenant = findTenantByVirtual(rawTo);

  console.log(`[Exotel Check] From: ${caller} -> Virtual: ${rawTo}`);

  // CASE A: BLACKLIST -> Return 403 so Exotel drops call
  if (tenant.blacklist.has(caller)) {
    callLogs.unshift({
      id: callSid,
      caller,
      callerName: 'Blocked Contact',
      astrologer: tenant.ownerName,
      reason: 'Blocked automatically (Blacklist)',
      status: 'REJECTED_BLACKLIST',
      recordingUrl: null,
      timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
    });
    io.emit('state_update', getPublicState());
    return res.status(403).send('BLACKLISTED');
  }

  // CASE B: WHITELIST -> Return 302 so Exotel skips Greeting and goes straight to Connect
  if (tenant.whitelist.has(caller)) {
    callLogs.unshift({
      id: callSid,
      caller,
      callerName: 'Saved Contact',
      astrologer: tenant.ownerName,
      reason: 'Whitelisted Contact (AI Screener Bypassed)',
      status: 'WHITELIST_BYPASS',
      recordingUrl: null,
      timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
    });
    io.emit('state_update', getPublicState());
    return res.status(302).send('WHITELIST_BYPASS');
  }

  // CASE C: UNKNOWN CALLER -> Return 200 so Exotel plays Hindi AI Greeting + Records Reason
  callLogs.unshift({
    id: callSid,
    caller,
    callerName: 'Unknown Caller',
    astrologer: tenant.ownerName,
    reason: 'Hindi AI Receptionist asking Name & Reason...',
    status: 'SCREENING',
    recordingUrl: null,
    timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
  });
  io.emit('state_update', getPublicState());
  return res.status(200).send('UNKNOWN_SCREEN');
});

// =========================================================
// 3. EXOTEL RECORDING CALLBACK (CAPTURES CALLER NAME & REASON)
// =========================================================
app.all('/exotel/recording', (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const callSid = body.CallSid || query.CallSid || '';
  const rawFrom = body.From || query.From || 'Unknown';
  const recordingUrl = body.RecordingUrl || query.RecordingUrl || body.DialCallRecordingUrl || '';
  const caller = normalizePhone(rawFrom) || rawFrom;

  console.log(`[Exotel Recording] CallSid: ${callSid}, URL: ${recordingUrl}`);

  const log = callLogs.find((c) => c.id === callSid) || callLogs[0];
  if (log) {
    log.reason = recordingUrl
      ? 'Voice Intro Recorded — Forwarded to Acharya Ji'
      : 'Screened by Hindi AI — Forwarded to Acharya Ji';
    log.status = 'FORWARDED';
    if (recordingUrl) log.recordingUrl = recordingUrl;
  }

  callbackRequests.unshift({
    id: 'cb_' + Date.now(),
    callSid,
    callerNumber: caller,
    callerName: 'Screened Caller',
    reason: 'Voice Name & Consultation Reason Recorded',
    recordingUrl,
    timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
  });

  io.emit('state_update', getPublicState());
  return res.status(200).send('OK');
});

// =========================================================
// 4. EXOTEL CONNECT WEBHOOK (FORWARDS CALL TO OWNER)
// =========================================================
app.all('/exotel/connect', (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const to = body.To || query.To || '09513886363';
  const tenant = findTenantByVirtual(to);

  console.log(`[Exotel Connect] Forwarding call to: ${tenant.realPhoneNumber}`);
  return res.status(200).json({
    fetch_after_attempt: false,
    destination: {
      numbers: [tenant.realPhoneNumber]
    },
    outgoing_call_cid: to,
    record: true
  });
});

// =========================================================
// 5. MOBILE APP & ADMIN API ENDPOINTS
// =========================================================
function getPublicState() {
  return {
    tenants: tenants.map((t) => ({
      id: t.id,
      ownerName: t.ownerName,
      virtualNumber: t.virtualNumber,
      realPhoneNumber: t.realPhoneNumber,
      screeningRules: t.screeningRules,
      whitelistCount: t.whitelist.size,
      blacklistCount: t.blacklist.size
    })),
    callLogs,
    callbackRequests
  };
}

app.get('/api/state', (req, res) => res.json(getPublicState()));

app.post('/api/v1/contacts/sync', (req, res) => {
  const { contacts = [] } = req.body || {};
  const tenant = tenants[0];
  contacts.forEach((c) => {
    const phone = normalizePhone(c.phone || c.phoneE164);
    if (!phone) return;
    if (c.status === 'BLACKLIST') {
      tenant.whitelist.delete(phone);
      tenant.blacklist.add(phone);
    } else {
      tenant.blacklist.delete(phone);
      tenant.whitelist.add(phone);
    }
  });
  io.emit('state_update', getPublicState());
  res.json({ success: true });
});

app.post('/api/v1/tenant/rules', (req, res) => {
  const { ownerName, realPhoneNumber, screeningRules } = req.body || {};
  const tenant = tenants[0];
  if (ownerName) tenant.ownerName = ownerName;
  if (realPhoneNumber) tenant.realPhoneNumber = normalizePhone(realPhoneNumber);
  if (screeningRules) tenant.screeningRules = screeningRules;
  io.emit('state_update', getPublicState());
  res.json({ success: true });
});

// =========================================================
// 6. LIVE SAAS CONTROL DASHBOARD UI
// =========================================================
const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Call Screener — 15-Day Live Exotel Edition</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="/socket.io/socket.io.js"></script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen font-sans">
  <div class="max-w-7xl mx-auto p-6">
    <div class="flex flex-wrap justify-between items-center border-b border-slate-800 pb-5 mb-6">
      <div>
        <h1 class="text-2xl font-bold text-amber-400">Astro AI Call Screener & Smart Router</h1>
        <p class="text-slate-400 text-sm">Exotel Hindi Voice AI Receptionist + Whitelist/Blacklist Routing (Zero API Cost)</p>
      </div>
      <span class="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-full text-xs font-medium flex items-center gap-2">
        <span class="w-2 h-2 bg-emerald-400 rounded-full animate-ping"></span> Exotel Live: 09513886363
      </span>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <p class="text-slate-400 text-xs">Whitelisted Contacts</p>
        <p id="stat-wl" class="text-2xl font-bold text-emerald-400 mt-1">0</p>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <p class="text-slate-400 text-xs">Blacklisted Numbers</p>
        <p id="stat-bl" class="text-2xl font-bold text-rose-400 mt-1">0</p>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <p class="text-slate-400 text-xs">Total Calls Screened</p>
        <p id="stat-calls" class="text-2xl font-bold text-amber-400 mt-1">0</p>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <p class="text-slate-400 text-xs">Recorded Voice Intros</p>
        <p id="stat-cb" class="text-2xl font-bold text-sky-400 mt-1">0</p>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-white mb-4">Live Call Screening & Voice Recordings</h2>
        <div id="call-logs" class="space-y-3">
          <p class="text-slate-500 text-sm">Waiting for incoming call on 09513886363...</p>
        </div>
      </div>

      <div class="space-y-6">
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 class="text-base font-semibold text-amber-400 mb-3">Routing & Forward Number</h2>
          <form id="rules-form" class="space-y-3">
            <input type="text" id="t-owner" placeholder="Owner Name" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <input type="text" id="t-forward" placeholder="Forward To (+91...)" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <textarea id="t-rules" rows="2" placeholder="Screening Rules..." class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"></textarea>
            <button type="submit" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold py-2 rounded-lg text-sm">Save Routing</button>
          </form>
        </div>

        <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 class="text-base font-semibold text-emerald-400 mb-3">Add Whitelist / Blacklist Number</h2>
          <form id="contact-form" class="space-y-3">
            <input type="text" id="c-phone" placeholder="Mobile (+919876543210)" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            <select id="c-status" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="WHITELIST">WHITELIST (Direct Forward)</option>
              <option value="BLACKLIST">BLACKLIST (Auto Block)</option>
            </select>
            <button type="submit" class="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold py-2 rounded-lg text-sm">Save Number</button>
          </form>
        </div>
      </div>
    </div>
  </div>

  <script>
    const socket = io();
    let initialized = false;

    function render(state) {
      const t = state.tenants[0];
      document.getElementById('stat-wl').innerText = t.whitelistCount;
      document.getElementById('stat-bl').innerText = t.blacklistCount;
      document.getElementById('stat-calls').innerText = state.callLogs.length;
      document.getElementById('stat-cb').innerText = state.callbackRequests.length;

      if (!initialized) {
        document.getElementById('t-owner').value = t.ownerName;
        document.getElementById('t-forward').value = t.realPhoneNumber;
        document.getElementById('t-rules').value = t.screeningRules;
        initialized = true;
      }

      const logsDiv = document.getElementById('call-logs');
      logsDiv.innerHTML = state.callLogs.length === 0
        ? '<p class="text-slate-500 text-sm">Waiting for incoming call on 09513886363...</p>'
        : state.callLogs.map(l => '<div class="bg-slate-800/70 border border-slate-700 p-3 rounded-lg flex justify-between items-start">' +
            '<div><div class="font-semibold text-white text-sm">' + l.callerName + ' (' + l.caller + ')</div>' +
            '<div class="text-xs text-slate-300 mt-1">' + l.reason + '</div>' +
            (l.recordingUrl ? '<audio controls class="mt-2 h-8"><source src="' + l.recordingUrl + '" type="audio/mpeg"></audio>' : '') +
            '<div class="text-[11px] text-slate-500 mt-1">' + l.timestamp + '</div></div>' +
            '<span class="px-2 py-1 rounded text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30">' + l.status + '</span>' +
          '</div>').join('');
    }

    fetch('/api/state').then(r => r.json()).then(render);
    socket.on('state_update', render);

    document.getElementById('rules-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await fetch('/api/v1/tenant/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerName: document.getElementById('t-owner').value,
          realPhoneNumber: document.getElementById('t-forward').value,
          screeningRules: document.getElementById('t-rules').value
        })
      });
      alert('Saved!');
    });

    document.getElementById('contact-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await fetch('/api/v1/contacts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contacts: [{
            phone: document.getElementById('c-phone').value,
            status: document.getElementById('c-status').value
          }]
        })
      });
      e.target.reset();
    });
  </script>
</body>
</html>`;

app.get('/', (req, res) => res.send(dashboardHtml));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Free Exotel Hindi AI Screener running on port ' + PORT));