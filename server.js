const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || '';
const WHAPI_URL = 'https://gate.whapi.cloud';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const raffleMessages = {};
const PROMPTS_FILE = './prompts.json';

function loadPrompts() {
  try { if (fs.existsSync(PROMPTS_FILE)) return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8')); } catch(e) {}
  return {};
}
function savePrompts(data) { fs.writeFileSync(PROMPTS_FILE, JSON.stringify(data, null, 2)); }

// ── יצירת הודעה עם AI ──
async function generateMessage(type, config) {
  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayName = dayNames[new Date().getDay()];
  
  const bonusMap = {
    morning: 'אין בונוס בבוקר',
    noon: 'אין בונוס בצהריים',
    afternoon: 'אין בונוס אחה"צ',
    evening: `יש בונוס ערב: ${config.bonusRules?.monday_wednesday || '30% הפקדה'}`,
    lateEvening: '70% קזינו 40% ספורט לשעות הלילה',
    midnight: 'קזינו פתוח 24/6',
    lateNight: 'ציפורי לילה מרוויחות יותר',
    veryLateNight: 'שעתיים לפנות בוקר הקזינו בוער',
    weekend: `סופ"ש: ${config.bonusRules?.weekend || '100% קזינו 50% ספורט'}`,
    motzash: 'מוצאי שבת חוזרים לאקשן',
    afterRaffle: 'הגרלה זה עתה נשלחה',
  };

  const promptTemplate = config.prompts?.[type] || `אתה ${config.agentName || 'רובי'}, סוכן הימורים. כתוב הודעה קצרה לקהילה בסגנון חברותי. סיים עם wa.me/972${config.agentPhone || '547554270'}`;
  const bonusInstruction = bonusMap[type] || '';
  
  const prompt = promptTemplate
    .replace(/{agentName}/g, config.agentName || 'רובי')
    .replace(/{agentPhone}/g, config.agentPhone || '547554270')
    .replace(/{day}/g, dayName)
    .replace(/{baseRules}/g, config.baseRules || '')
    .replace(/{bonusInstruction}/g, bonusInstruction);

  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }]
  }, {
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
  });
  return res.data.content[0].text;
}

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => { try { res.sendFile(__dirname + '/panel.html'); } catch(e) { res.send('Panel not found'); } });
app.get('/qr', (req, res) => res.send(`<html dir="rtl"><head><meta charset="utf-8"><title>BetON</title><style>body{background:#07070F;color:#f0f0f5;font-family:sans-serif;text-align:center;padding:3rem}h1{color:#F5C842}.ok{background:#0f2a1a;border:2px solid #22c55e;border-radius:12px;padding:2rem;display:inline-block;color:#22c55e;font-size:1.3rem;margin-top:1rem}</style></head><body><h1>💎 BetON Bot</h1><div class="ok">✅ Whapi מחובר ומוכן!<br><small style="font-size:14px;margin-top:8px;display:block">התזמון האוטומטי פעיל 📅</small></div></body></html>`));

app.get('/api/status', async (req, res) => {
  try { const r = await axios.get(`${WHAPI_URL}/health`, { headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}` } }); res.json({ ready: true, status: r.data }); }
  catch(err) { res.json({ ready: false }); }
});

app.get('/api/prompts', (req, res) => res.json(loadPrompts()));
app.post('/api/prompts', (req, res) => { try { savePrompts(req.body); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });

app.post('/api/sendText', async (req, res) => {
  const { chatId, content } = req.body;
  try {
    const sent = await axios.post(`${WHAPI_URL}/messages/text`, { to: chatId, body: content }, { headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' } });
    console.log('✅ נשלח:', content.substring(0, 40) + '...');
    res.json({ success: true, messageId: sent.data?.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sendImage', async (req, res) => {
  const { chatId, url, caption, raffleId } = req.body;
  try {
    const sent = await axios.post(`${WHAPI_URL}/messages/image`, { to: chatId, media: url, caption: caption || '' }, { headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' } });
    if (raffleId) raffleMessages[raffleId] = sent.data?.id;
    res.json({ success: true, messageId: sent.data?.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sendTextWithId', async (req, res) => {
  const { chatId, content, raffleId } = req.body;
  try {
    const sent = await axios.post(`${WHAPI_URL}/messages/text`, { to: chatId, body: content }, { headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' } });
    if (raffleId) raffleMessages[raffleId] = sent.data?.id;
    res.json({ success: true, messageId: sent.data?.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/getMessageReplies', async (req, res) => {
  const { messageId } = req.query;
  if (!messageId) return res.status(400).json({ error: 'חסר messageId' });
  try {
    const GROUP_ID = process.env.GROUP_ID;
    const response = await axios.get(`${WHAPI_URL}/messages/list/${GROUP_ID}`, { headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}` }, params: { count: 1000 } });
    const messages = response.data?.messages || [];
    const replies = messages.filter(m => m.context?.quoted_id === messageId).map(m => ({ senderName: m.from_name || m.from, senderId: m.from, body: m.text?.body || '', timestamp: m.timestamp }));
    res.json({ replies });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/getRaffleMessageId', (req, res) => res.json({ messageId: raffleMessages[req.query.raffleId] || null }));

app.post('/api/findWinners', async (req, res) => {
  const { raffleId } = req.body;
  if (!raffleId) return res.status(400).json({ error: 'חסר raffleId' });
  try {
    const messageId = raffleMessages[raffleId];
    if (!messageId) return res.status(404).json({ error: 'לא נמצא messageId' });
    const { findWinners } = require('./winner-finder');
    const result = await findWinners(raffleId, messageId);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/getGroups', async (req, res) => {
  try {
    const response = await axios.get(`${WHAPI_URL}/groups`, { headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}` } });
    res.json({ groups: (response.data?.groups || []).map(g => ({ id: g.id, name: g.name })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── טסט: יצור הודעה לפי פרומפט ──
app.post('/api/generateTest', async (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).json({ error: 'חסר type' });
  try {
    const config = loadPrompts();
    const msg = await generateMessage(type, config);
    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── טסט: שלח כל ההודעות לקבוצה ──
app.post('/api/runFullTest', async (req, res) => {
  const { chatId, delaySeconds } = req.body;
  if (!chatId) return res.status(400).json({ error: 'חסר chatId' });
  
  res.json({ success: true, message: 'טסט התחיל! הודעות יישלחו בזה אחר זה.' });
  
  const types = ['morning', 'noon', 'afternoon', 'evening', 'lateEvening', 'midnight', 'weekend', 'afterRaffle'];
  const labels = ['☀️ בוקר', '🌤 צהריים', '⛅ אחה"צ', '🌆 ערב', '🌙 לילה', '🕛 חצות', '🎉 סופ"ש', '🎯 אחרי הגרלה'];
  const delay = (delaySeconds || 30) * 1000;
  const config = loadPrompts();

  for (let i = 0; i < types.length; i++) {
    try {
      await new Promise(r => setTimeout(r, i === 0 ? 1000 : delay));
      const msg = await generateMessage(types[i], config);
      if (!msg) continue;
      const header = `━━━━━━━━━━━━━━━\n🧪 *טסט: ${labels[i]}*\n━━━━━━━━━━━━━━━\n\n`;
      await axios.post(`${WHAPI_URL}/messages/text`, { to: chatId, body: header + msg }, {
        headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' }
      });
      console.log(`✅ טסט נשלח: ${types[i]}`);
    } catch(err) {
      console.error(`❌ שגיאה בטסט ${types[i]}:`, err.message);
    }
  }
  console.log('✅ טסט הושלם!');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BetON Bot פועל על פורט ${PORT}`);
  setTimeout(() => { require('./scheduler'); console.log('📅 תזמון אוטומטי פעיל!'); }, 5000);
});
