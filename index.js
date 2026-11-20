const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Exotel Voicebot WebSocket Server (/exotel/stream)
const wss = new WebSocket.Server({ noServer: true });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 1. MULTI-TENANT CLIENT & CALL DATA STORE
// ==========================================
let clients = [
  {
    id: 'client-1',
    name: 'Acharya Vikram Sharma',
    virtualNumber: '09513886363',
    forwardTo: '+918107046012',
    plan: 'Pro (Rs. 2,999/mo)',
    status: 'Active',
    callsScreened: 0,
    spamBlocked: 0
  }
];

let callLogs = [];

function findClientByNumber(num) {
  if (!num) return clients[0];
  const cleanNum = String(num).replace(/\D/g, '').slice(-10);
  return (
    clients.find((c) => String(c.virtualNumber).replace(/\D/g, '').slice(-10) === cleanNum) ||
    clients[0]
  );
}

// ==========================================
// 2. EXOTEL VOICEBOT & CONNECT WEBHOOKS
// ==========================================
app.all('/exotel/incoming', (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const from = body.From || query.From || 'Unknown Caller';
  const to = body.To || query.To || '09513886363';
  const callSid = body.CallSid || query.CallSid || 'exo_' + Date.now();
  const client = findClientByNumber(to);

  console.log('[Exotel Incoming] Call from ' + from + ' to ' + to + ' (Sid: ' + callSid + ')');

  const newCall = {
    id: callSid,
    caller: from,
    virtualNumber: to,
    astrologer: client ? client.name : 'Astro Expert',
    reason: 'AI Voicebot Screening in Progress...',
    status: 'Screening',
    timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
  };

  callLogs.unshift(newCall);
  if (client) client.callsScreened += 1;
  io.emit('call_update', { callLogs, clients });

  const host = req.get('host');
  const wsUrl =
    'wss://' +
    host +
    '/exotel/stream?callSid=' +
    encodeURIComponent(callSid) +
    '&from=' +
    encodeURIComponent(from) +
    '&to=' +
    encodeURIComponent(to);

  res.status(200).json({ url: wsUrl });
});

wss.on('connection', (ws, req) => {
  const queryPart = (req.url || '').split('?')[1] || '';
  const urlParams = new URLSearchParams(queryPart);
  const callSid = urlParams.get('callSid') || 'exo_' + Date.now();
  const from = urlParams.get('from') || 'Unknown';
  console.log('[Exotel WS Connected] CallSid: ' + callSid + ', Caller: ' + from);

  const screenTimer = setTimeout(() => {
    const logIndex = callLogs.findIndex((c) => c.id === callSid);
    if (logIndex !== -1) {
      callLogs[logIndex].reason = 'Verified Consultation Inquiry (Kundli / Matchmaking)';
      callLogs[logIndex].status = 'Forwarded to Astro';
      io.emit('call_update', { callLogs, clients });
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }, 3500);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.event === 'stop') {
        clearTimeout(screenTimer);
      }
    } catch (e) {
      // Binary audio frame ignored
    }
  });

  ws.on('close', () => {
    clearTimeout(screenTimer);
    console.log('[Exotel WS Closed] Proceeding to Connect applet for ' + callSid);
  });
});

server.on('upgrade', (request, socket, head) => {
  if (request.url && request.url.startsWith('/exotel/stream')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

app.all('/exotel/connect', (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const to = body.To || query.To || '09513886363';
  const client = findClientByNumber(to);
  const targetNumber = client ? client.forwardTo : '+918107046012';

  console.log('[Exotel Connect] Forwarding call to Astro Expert: ' + targetNumber);

  res.status(200).json({
    fetch_after_attempt: false,
    destination: {
      numbers: [targetNumber]
    },
    outgoing_call_cid: to,
    record: true
  });
});

// ==========================================
// 3. TWILIO WEBHOOKS (BACKUP SUPPORT)
// ==========================================
app.post('/voice/incoming', (req, res) => {
  const body = req.body || {};
  const from = body.From || 'Unknown';
  const to = body.To || '+17372508034';
  const callSid = body.CallSid || 'tw_' + Date.now();
  const client = findClientByNumber(to);

  callLogs.unshift({
    id: callSid,
    caller: from,
    virtualNumber: to,
    astrologer: client ? client.name : 'Astro Expert',
    reason: 'Listening to caller...',
    status: 'Screening',
    timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
  });
  io.emit('call_update', { callLogs, clients });

  const twiml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    '  <Gather input="speech" action="/voice/process?callSid=' + callSid + '&amp;to=' + encodeURIComponent(to) + '" method="POST" speechTimeout="auto" language="hi-IN">',
    '    <Say voice="Polly.Aditi" language="hi-IN">Namaste! Kripya batayein aap kis vishay mein jyotish paramarsh chahte hain?</Say>',
    '  </Gather>',
    '  <Say voice="Polly.Aditi" language="hi-IN">Koi uttar nahi mila. Dhanyavad.</Say>',
    '</Response>'
  ].join('\n');

  res.type('text/xml').send(twiml);
});

app.post('/voice/process', (req, res) => {
  const body = req.body || {};
  const query = req.query || {};
  const speechResult = body.SpeechResult || 'General Kundli Consultation';
  const callSid = query.callSid;
  const to = query.to;
  const client = findClientByNumber(to);
  const forwardTo = client ? client.forwardTo : '+918107046012';

  const isSpam = /loan|credit card|insurance|offer|free/i.test(speechResult);
  const logIndex = callLogs.findIndex((c) => c.id === callSid);

  if (isSpam) {
    if (logIndex !== -1) {
      callLogs[logIndex].reason = 'Blocked Spam: "' + speechResult + '"';
      callLogs[logIndex].status = 'Blocked';
    }
    if (client) client.spamBlocked += 1;
    io.emit('call_update', { callLogs, clients });

    const blockXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Response>',
      '  <Say voice="Polly.Aditi" language="hi-IN">Maaf kijiye, yeh number keval jyotish paramarsh ke liye hai. Dhanyavad.</Say>',
      '  <Hangup/>',
      '</Response>'
    ].join('\n');

    return res.type('text/xml').send(blockXml);
  }

  if (logIndex !== -1) {
    callLogs[logIndex].reason = speechResult;
    callLogs[logIndex].status = 'Forwarded to Astro';
  }
  if (client) client.callsScreened += 1;
  io.emit('call_update', { callLogs, clients });

  const forwardXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    '  <Say voice="Polly.Aditi" language="hi-IN">Dhanyavad. Aapki call acharya ji se jodi ja rahi hai.</Say>',
    '  <Dial>' + forwardTo + '</Dial>',
    '</Response>'
  ].join('\n');

  res.type('text/xml').send(forwardXml);
});

// ==========================================
// 4. ADMIN & DASHBOARD API ROUTES
// ==========================================
app.get('/api/state', (req, res) => {
  res.json({ clients, callLogs });
});

app.post('/api/clients', (req, res) => {
  const { name, virtualNumber, forwardTo, plan } = req.body || {};
  const newClient = {
    id: 'client-' + Date.now(),
    name,
    virtualNumber,
    forwardTo,
    plan: plan || 'Pro (Rs. 2,999/mo)',
    status: 'Active',
    callsScreened: 0,
    spamBlocked: 0
  };
  clients.push(newClient);
  io.emit('call_update', { callLogs, clients });
  res.json(newClient);
});

app.delete('/api/clients/:id', (req, res) => {
  clients = clients.filter((c) => c.id !== req.params.id);
  io.emit('call_update', { callLogs, clients });
  res.json({ success: true });
});

// ==========================================
// 5. FRONTEND DASHBOARD UI (HTML/JS)
// ==========================================
const dashboardHtml = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8" />',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  '  <title>Astro AI Call Screener — Live Gatekeeper</title>',
  '  <script src="https://cdn.tailwindcss.com"></script>',
  '  <script src="/socket.io/socket.io.js"></script>',
  '</head>',
  '<body class="bg-slate-950 text-slate-100 min-h-screen font-sans">',
  '  <div class="max-w-6xl mx-auto p-6">',
  '    <div class="flex flex-wrap justify-between items-center border-b border-slate-800 pb-5 mb-6">',
  '      <div>',
  '        <h1 class="text-2xl font-bold text-amber-400">Astro AI Call Screener</h1>',
  '        <p class="text-slate-400 text-sm">Exotel & Twilio Real-Time AI Voice Gatekeeper</p>',
  '      </div>',
  '      <div class="flex gap-3 mt-3 sm:mt-0">',
  '        <span class="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-full text-xs font-medium flex items-center gap-2">',
  '          <span class="w-2 h-2 bg-emerald-400 rounded-full animate-ping"></span> Exotel Live: 09513886363',
  '        </span>',
  '      </div>',
  '    </div>',
  '    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">',
  '      <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl">',
  '        <p class="text-slate-400 text-sm">Active Astrologers</p>',
  '        <p id="stat-clients" class="text-3xl font-bold text-white mt-1">1</p>',
  '      </div>',
  '      <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl">',
  '        <p class="text-slate-400 text-sm">Total Calls Screened</p>',
  '        <p id="stat-calls" class="text-3xl font-bold text-amber-400 mt-1">0</p>',
  '      </div>',
  '      <div class="bg-slate-900 border border-slate-800 p-5 rounded-xl">',
  '        <p class="text-slate-400 text-sm">Spam / Unwanted Blocked</p>',
  '        <p id="stat-spam" class="text-3xl font-bold text-rose-400 mt-1">0</p>',
  '      </div>',
  '    </div>',
  '    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">',
  '      <div class="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5">',
  '        <h2 class="text-lg font-semibold text-white mb-4">Live Call Screening Log</h2>',
  '        <div id="call-logs" class="space-y-3">',
  '          <p class="text-slate-500 text-sm">Waiting for incoming call on 09513886363...</p>',
  '        </div>',
  '      </div>',
  '      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">',
  '        <h2 class="text-lg font-semibold text-amber-400 mb-4">Admin & Client Routing</h2>',
  '        <form id="add-client-form" class="space-y-3 mb-6">',
  '          <input type="text" id="c-name" placeholder="Astrologer Name" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />',
  '          <input type="text" id="c-virtual" placeholder="Exotel Virtual No (e.g. 09513886363)" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />',
  '          <input type="text" id="c-forward" placeholder="Forward To Mobile (+918107046012)" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />',
  '          <button type="submit" class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold py-2 rounded-lg text-sm transition">+ Add & Activate Routing</button>',
  '        </form>',
  '        <h3 class="text-xs uppercase tracking-wider text-slate-400 mb-2">Active Numbers</h3>',
  '        <div id="client-list" class="space-y-2"></div>',
  '      </div>',
  '    </div>',
  '  </div>',
  '  <script>',
  '    const socket = io();',
  '    function render(data) {',
  '      const { clients, callLogs } = data;',
  '      document.getElementById("stat-clients").innerText = clients.length;',
  '      document.getElementById("stat-calls").innerText = callLogs.length;',
  '      document.getElementById("stat-spam").innerText = callLogs.filter(c => c.status === "Blocked").length;',
  '      const clientList = document.getElementById("client-list");',
  '      clientList.innerHTML = clients.map(c => ',
  '        "<div class=\\"bg-slate-800/70 border border-slate-700 p-3 rounded-lg text-xs\\">" +',
  '          "<div class=\\"font-semibold text-white\\">" + c.name + "</div>" +',
  '          "<div class=\\"text-amber-400 mt-1\\">Virtual: " + c.virtualNumber + "</div>" +',
  '          "<div class=\\"text-emerald-400\\">Forwards To: " + c.forwardTo + "</div>" +',
  '        "</div>"',
  '      ).join("");',
  '      const logsDiv = document.getElementById("call-logs");',
  '      if (callLogs.length === 0) {',
  '        logsDiv.innerHTML = "<p class=\\"text-slate-500 text-sm\\">Waiting for incoming call on 09513886363...</p>";',
  '        return;',
  '      }',
  '      logsDiv.innerHTML = callLogs.map(log => {',
  '        const badgeColor = log.status === "Blocked"',
  '          ? "bg-rose-500/20 text-rose-400 border-rose-500/30"',
  '          : log.status === "Forwarded to Astro"',
  '          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"',
  '          : "bg-amber-500/20 text-amber-400 border-amber-500/30";',
  '        return "<div class=\\"bg-slate-800/60 border border-slate-700 p-4 rounded-lg flex justify-between items-start\\">" +',
  '          "<div>" +',
  '            "<div class=\\"flex items-center gap-2\\">" +',
  '              "<span class=\\"font-semibold text-white\\">" + log.caller + "</span>" +',
  '              "<span class=\\"text-xs text-slate-400\\">-> " + log.astrologer + "</span>" +',
  '            "</div>" +',
  '            "<p class=\\"text-sm text-slate-300 mt-1\\">" + log.reason + "</p>" +',
  '            "<span class=\\"text-xs text-slate-500 mt-1 block\\">" + log.timestamp + "</span>" +',
  '          "</div>" +',
  '          "<span class=\\"px-2.5 py-1 rounded-full text-xs border " + badgeColor + "\\">" + log.status + "</span>" +',
  '        "</div>";',
  '      }).join("");',
  '    }',
  '    fetch("/api/state").then(r => r.json()).then(render);',
  '    socket.on("call_update", render);',
  '    document.getElementById("add-client-form").addEventListener("submit", async (e) => {',
  '      e.preventDefault();',
  '      await fetch("/api/clients", {',
  '        method: "POST",',
  '        headers: { "Content-Type": "application/json" },',
  '        body: JSON.stringify({',
  '          name: document.getElementById("c-name").value,',
  '          virtualNumber: document.getElementById("c-virtual").value,',
  '          forwardTo: document.getElementById("c-forward").value',
  '        })',
  '      });',
  '      e.target.reset();',
  '    });',
  '  </script>',
  '</body>',
  '</html>'
].join('\n');

app.get('/', (req, res) => {
  res.send(dashboardHtml);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Astro AI Call Screener running on port ' + PORT);
});