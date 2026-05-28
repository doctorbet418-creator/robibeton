const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const WHAPI_TOKEN = process.env.WHAPI_TOKEN || '';
const WHAPI_URL = 'https://gate.whapi.cloud';

const raffleMessages = {};

async function getStatus() {
  try {
    const res = await axios.get(`${WHAPI_URL}/health`, {
      headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}` }
    });
    return res.data;
  } catch (err) {
    return { error: err.message };
  }
}

app.get('/', (req, res) => res.redirect('/qr'));

app.get('/admin', (req, res) => {
  try { res.sendFile(__dirname + '/panel.html'); }
  catch(e) { res.send('Panel not found'); }
});

app.get('/qr', async (req, res) => {
  res.send(`<html dir="rtl"><head><meta charset="utf-8"><title>CrownBet</title><style>body{background:#0a0a0f;color:#f0f0f5;font-family:sans-serif;text-align:center;padding:3rem}h1{color:#f5c842}.ok{background:#0f2a1a;border:2px solid #22c55e;border-radius:12px;padding:2rem;display:inline-block;color:#22c55e;font-size:1.3rem;margin-top:1rem}</style></head><body><h1>👑 CrownBet WA Server</h1><div class="ok">✅ Whapi מחובר ומוכן לשליחה!<br><small style="font-size:14px;margin-top:8px;display:block">התזמון האוטומטי פעיל 📅</small></div></body></html>`);
});

app.get('/api/status', async (req, res) => {
  try {
    const status = await getStatus();
    res.json({ ready: true, status });
  } catch(err) {
    res.json({ ready: false, error: err.message });
  }
});

app.post('/api/sendText', async (req, res) => {
  const { chatId, content } = req.body;
  try {
    const sent = await axios.post(`${WHAPI_URL}/messages/text`, {
      to: chatId,
      body: content
    }, {
      headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' }
    });
    console.log('✅ הודעה נשלחה:', content.substring(0, 40) + '...');
    res.json({ success: true, messageId: sent.data?.id });
  } catch (err) {
    console.error('❌ שגיאה:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sendImage', async (req, res) => {
  const { chatId, url, caption, raffleId } = req.body;
  try {
    const sent = await axios.post(`${WHAPI_URL}/messages/image`, {
      to: chatId,
      media: url,
      caption: caption || ''
    }, {
      headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' }
    });
    if (raffleId) {
      raffleMessages[raffleId] = sent.data?.id;
      console.log(`💾 נשמר messageId להגרלה ${raffleId}`);
    }
    console.log('✅ תמונה נשלחה');
    res.json({ success: true, messageId: sent.data?.id });
  } catch (err) {
    console.error('❌ שגיאה:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sendTextWithId', async (req, res) => {
  const { chatId, content, raffleId } = req.body;
  try {
    const sent = await axios.post(`${WHAPI_URL}/messages/text`, {
      to: chatId,
      body: content
    }, {
      headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' }
    });
    if (raffleId) {
      raffleMessages[raffleId] = sent.data?.id;
      console.log(`💾 נשמר messageId להגרלה ${raffleId}`);
    }
    res.json({ success: true, messageId: sent.data?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/getMessageReplies', async (req, res) => {
  const { messageId } = req.query;
  if (!messageId) return res.status(400).json({ error: 'חסר messageId' });
  try {
    const GROUP_ID = process.env.GROUP_ID;
    const response = await axios.get(`${WHAPI_URL}/messages/list/${GROUP_ID}`, {
      headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}` },
      params: { count: 1000 }
    });
    const messages = response.data?.messages || [];
    const replies = messages.filter(m =>
      m.context?.quoted_id === messageId
    ).map(m => ({
      senderName: m.from_name || m.from,
      senderId: m.from,
      body: m.text?.body || m.body || '',
      timestamp: m.timestamp
    }));
    res.json({ replies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/getRaffleMessageId', (req, res) => {
  const { raffleId } = req.query;
  res.json({ messageId: raffleMessages[raffleId] || null });
});

app.post('/api/findWinners', async (req, res) => {
  const { raffleId } = req.body;
  if (!raffleId) return res.status(400).json({ error: 'חסר raffleId' });
  try {
    const messageId = raffleMessages[raffleId];
    if (!messageId) return res.status(404).json({ error: 'לא נמצא messageId' });
    const { findWinners } = require('./winner-finder');
    const result = await findWinners(raffleId, messageId);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/getGroups', async (req, res) => {
  try {
    const response = await axios.get(`${WHAPI_URL}/groups`, {
      headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}` }
    });
    const groups = response.data?.groups || [];
    res.json({ groups: groups.map(g => ({ id: g.id, name: g.name })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 שרת פועל על פורט ${PORT}`);
  setTimeout(() => {
    require('./scheduler');
    console.log('📅 תזמון אוטומטי פעיל!');
  }, 5000);
});
