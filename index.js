const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multi-Tenant Database
let clients = [
  {
    id: 'client_1',
    businessName: 'Apna Astro Kendra (Self)',
    ownerName: 'Ajeet',
    virtualNumber: '+911414001111',
    forwardToNumber: '+919876500001',
    monthlyFee: 0,
    status: 'Active',
    lists: {
      whitelist: [
        {
          name: 'Ramesh Sharma',
          number: '+919876543210',
          reason: 'Regular Kundli Client',
          aiNote: 'Verified Old Client',
        },
      ],
      blacklist: [
        {
          name: 'Spam Caller',
          number: '+919999900000',
          reason: 'Credit card loan offer',
          aiNote: 'AI Blocked: Spam/Telemarketing',
        },
      ],
      other: [],
    },
  },
  {
    id: 'client_2',
    businessName: 'Pandit Sharma Jyotish',
    ownerName: 'Pt. Suresh Sharma',
    virtualNumber: '+911414002222',
    forwardToNumber: '+919876500002',
    monthlyFee: 1499,
    status: 'Active',
    lists: { whitelist: [], blacklist: [], other: [] },
  },
];

// =========================================================================
// AUTONOMOUS AI DECISION ENGINE (Khud decide karega: REAL, SPAM, ya UNCLEAR)
// =========================================================================
async function analyzeCallWithAI(name, reason) {
  const text = `${name} ${reason}`.toLowerCase();

  // Optional: Agar aapke paas OpenAI API Key hai toh asli GPT model use karega
  if (process.env.OPENAI_API_KEY) {
    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  'You are an AI receptionist for an Astrology center. Analyze caller name and reason. Reply ONLY in JSON: {"decision": "REAL" | "SPAM" | "UNCLEAR", "aiNote": "short reason in Hinglish"}',
              },
              {
                role: 'user',
                content: `Caller Name: ${name}, Reason: ${reason}`,
              },
            ],
          }),
        }
      );
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (e) {
      console.log('Fallback to built-in AI rules');
    }
  }

  // Built-in Smart Hindi/Hinglish AI Classifier
  const spamKeywords = [
    'loan',
    'credit card',
    'insurance',
    'bank',
    'offer',
    'lottery',
    'prize',
    'timepass',
    'mazak',
    'prank',
    'free',
    'company',
    'marketing',
    'sell',
    'bechna',
    'survey',
    'bakwas',
    'test',
    'faltu',
    'gaali',
    'sim',
    'recharge',
  ];

  const realAstroKeywords = [
    'astro',
    'astrology',
    'kundli',
    'kundali',
    'jyotish',
    'shaadi',
    'shadi',
    'marriage',
    'vivah',
    'job',
    'naukri',
    'career',
    'business',
    'vyapar',
    'love',
    'pyar',
    'breakup',
    'problem',
    'samasya',
    'pareshan',
    'upay',
    'pooja',
    'puja',
    'vastu',
    'grah',
    'shani',
    'mangal',
    'rahu',
    'ketu',
    'appointment',
    'baat karni',
    'consult',
    'guruji',
    'pandit',
    'bhavishya',
    'future',
    'health',
    'paisa',
    'dhan',
    'horoscope',
    'match',
    'milan',
  ];

  if (spamKeywords.some((word) => text.includes(word))) {
    return {
      decision: 'SPAM',
      aiNote: '🤖 AI Auto-Blocked: Spam / Telemarketing / Prank detected',
    };
  }

  if (realAstroKeywords.some((word) => text.includes(word))) {
    return {
      decision: 'REAL',
      aiNote: '🤖 AI Auto-Approved: Genuine Astrology Consultation',
    };
  }

  // Agar bahut chota ya samajh na aane wala reason ho
  if (reason.trim().length < 4) {
    return {
      decision: 'SPAM',
      aiNote: '🤖 AI Auto-Blocked: Bina valid reason ke call',
    };
  }

  return {
    decision: 'UNCLEAR',
    aiNote: '🤖 AI Review Needed: Reason spasht nahi hai',
  };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/clients', (req, res) => {
  res.json(clients);
});

app.post('/api/clients', (req, res) => {
  const {
    businessName,
    ownerName,
    virtualNumber,
    forwardToNumber,
    monthlyFee,
  } = req.body;
  const newClient = {
    id: 'client_' + Date.now(),
    businessName,
    ownerName,
    virtualNumber,
    forwardToNumber,
    monthlyFee: Number(monthlyFee) || 999,
    status: 'Active',
    lists: { whitelist: [], blacklist: [], other: [] },
  };
  clients.push(newClient);
  io.emit('sync_clients', clients);
  res.json({ success: true, client: newClient });
});

app.delete('/api/clients/:id', (req, res) => {
  clients = clients.filter((c) => c.id !== req.params.id);
  io.emit('sync_clients', clients);
  res.json({ success: true });
});

// =========================================================================
// 1. ASLI INCOMING CALL WEBHOOK (AI Robot Call Pick Karega)
// =========================================================================
app.post('/voice/incoming', (req, res) => {
  const callerNumber = req.body.From || req.body.caller_id;
  const dialedVirtualNumber = req.body.To || req.body.virtual_number;
  const client =
    clients.find((c) => c.virtualNumber === dialedVirtualNumber) || clients[0];

  // Check 1: Pehle se Blacklist mein hai toh turant cut
  if (client.lists.blacklist.find((c) => c.number === callerNumber)) {
    res.type('text/xml');
    return res.send(`<Response><Reject reason="busy"/></Response>`);
  }

  // Check 2: Pehle se Whitelist mein hai toh seedha Astro ko forward
  if (client.lists.whitelist.find((c) => c.number === callerNumber)) {
    res.type('text/xml');
    return res.send(`
      <Response>
        <Say language="hi-IN">Aapki call seedha astrologer se jodi ja rahi hai.</Say>
        <Dial>${client.forwardToNumber}</Dial>
      </Response>
    `);
  }

  // Check 3: Unknown Caller -> AI Robot Call Pick Karega aur Reason Puchega
  res.type('text/xml');
  res.send(`
    <Response>
      <Gather input="speech" action="/voice/ai-decide?clientId=${client.id}" language="hi-IN" timeout="5">
        <Say language="hi-IN">Namaste! ${client.businessName} mein aapka swagat hai. Main AI assistant bol raha hoon. Kripya apna naam aur call karne ka karan batayein.</Say>
      </Gather>
      <Say language="hi-IN">Aapki awaaz nahi aayi. Dhanyawad.</Say>
    </Response>
  `);
});

// =========================================================================
// 2. AI KHUD DECIDE KAREGA AUR ASTRO KO CALL BHEJEGA YA BLOCK KAREGA
// =========================================================================
app.post('/voice/ai-decide', async (req, res) => {
  const clientId = req.query.clientId;
  const client = clients.find((c) => c.id === clientId) || clients[0];
  const callerNumber = req.body.From || 'Unknown';
  const speechText = req.body.SpeechResult || '';

  const aiResult = await analyzeCallWithAI('Voice Caller', speechText);

  const callRecord = {
    id: Date.now().toString(),
    name: 'AI Screened Client',
    number: callerNumber,
    reason: speechText || 'No speech',
    aiNote: aiResult.aiNote,
  };

  res.type('text/xml');

  if (aiResult.decision === 'REAL') {
    // Whitelist mein add karein aur SEEDHA ASTRO KO CALL CONNECT KAREIN
    client.lists.whitelist.unshift(callRecord);
    io.emit('ai_live_event', {
      type: 'APPROVED',
      clientName: client.businessName,
      call: callRecord,
    });
    io.emit('sync_clients', clients);

    return res.send(`
      <Response>
        <Say language="hi-IN">Dhanyawad. Aapka karan verify ho gaya hai. Main aapki call abhi astrologer ko transfer kar raha hoon.</Say>
        <Dial>${client.forwardToNumber}</Dial>
      </Response>
    `);
  } else if (aiResult.decision === 'SPAM') {
    // Blacklist mein add karein aur CALL CUT KAREIN
    client.lists.blacklist.unshift(callRecord);
    io.emit('ai_live_event', {
      type: 'BLOCKED',
      clientName: client.businessName,
      call: callRecord,
    });
    io.emit('sync_clients', clients);

    return res.send(`
      <Response>
        <Say language="hi-IN">Maaf kijiye, yeh number keval astrology consultation ke liye hai. Aapki call aage transfer nahi ki ja sakti.</Say>
        <Hangup/>
      </Response>
    `);
  } else {
    // Other list mein rakhein
    client.lists.other.unshift(callRecord);
    io.emit('ai_live_event', {
      type: 'REVIEW',
      clientName: client.businessName,
      call: callRecord,
    });
    io.emit('sync_clients', clients);

    return res.send(`
      <Response>
        <Say language="hi-IN">Dhanyawad, aapki jankari note kar li gayi hai. Hamari team aapko wapas call karegi.</Say>
        <Hangup/>
      </Response>
    `);
  }
});

// =========================================================================
// 3. SIMULATE AI ROBOT CALL (Testing ke liye)
// =========================================================================
app.post('/api/simulate-call', async (req, res) => {
  const { clientId, name, number, reason } = req.body;
  const client = clients.find((c) => c.id === clientId);
  if (!client)
    return res.json({ status: 'ERROR', message: 'Client nahi mila' });

  // Pehle se Blacklist mein hai
  if (client.lists.blacklist.find((c) => c.number === number)) {
    return res.json({
      decision: 'ALREADY_BLOCKED',
      title: '🚫 Pehle se Blacklist mein hai',
      message:
        'AI ne call pick hi nahi ki, server par hi auto-reject kar diya!',
    });
  }

  // Pehle se Whitelist mein hai
  if (client.lists.whitelist.find((c) => c.number === number)) {
    return res.json({
      decision: 'ALREADY_WHITELISTED',
      title: '✅ Pehle se Whitelist mein hai',
      message: `Bina kisi rukawat ke call seedha ${client.forwardToNumber} (Astrologer) ko bhej di gayi!`,
    });
  }

  // Naya Number -> AI Robot Call Pick Karega aur Khud Decide Karega!
  const aiResult = await analyzeCallWithAI(
    name || 'Unknown Caller',
    reason || ''
  );

  const callRecord = {
    id: Date.now().toString(),
    name: name || 'Unknown Caller',
    number,
    reason: reason || 'No reason given',
    aiNote: aiResult.aiNote,
  };

  if (aiResult.decision === 'REAL') {
    client.lists.whitelist.unshift(callRecord);
    io.emit('sync_clients', clients);
    return res.json({
      decision: 'REAL',
      title: '🤖 AI Robot Decision: REAL CALL ✅',
      message: `AI ne "${reason}" suna aur isse genuine client maankar Whitelist mein add kiya, aur call seedha Astrologer (${client.forwardToNumber}) ko transfer kar di!`,
    });
  } else if (aiResult.decision === 'SPAM') {
    client.lists.blacklist.unshift(callRecord);
    io.emit('sync_clients', clients);
    return res.json({
      decision: 'SPAM',
      title: '🤖 AI Robot Decision: SPAM / FAKE CALL 🚫',
      message: `AI ne "${reason}" suna aur isse spam samajhkar call cut kar di aur number ko Blacklist mein daal diya!`,
    });
  } else {
    client.lists.other.unshift(callRecord);
    io.emit('sync_clients', clients);
    return res.json({
      decision: 'UNCLEAR',
      title: '🤖 AI Robot Decision: UNCLEAR (Other List) ⚠️',
      message: `Reason "${reason}" se AI ko confirm nahi hua ki yeh astrology call hai ya nahi, isliye isse 'Other' column mein rakha gaya hai.`,
    });
  }
});

// Manual Move / Delete
app.post('/api/move-number', (req, res) => {
  const { clientId, fromList, toList, number } = req.body;
  const client = clients.find((c) => c.id === clientId);
  if (client) {
    const idx = client.lists[fromList].findIndex((i) => i.number === number);
    if (idx > -1) {
      const item = client.lists[fromList][idx];
      client.lists[fromList].splice(idx, 1);
      item.aiNote = 'Manually moved by Astrologer';
      client.lists[toList].unshift(item);
      io.emit('sync_clients', clients);
    }
  }
  res.json({ success: true });
});

app.post('/api/delete-number', (req, res) => {
  const { clientId, listName, number } = req.body;
  const client = clients.find((c) => c.id === clientId);
  if (client) {
    client.lists[listName] = client.lists[listName].filter(
      (item) => item.number !== number
    );
    io.emit('sync_clients', clients);
  }
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Autonomous Astro AI Gatekeeper running on port ${PORT}`)
);
