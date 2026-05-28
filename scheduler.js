const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const { randomDelay, isWeekend, isMoatzash } = require('./messages');

const GROUP_ID = process.env.GROUP_ID;
const SUPABASE_URL = 'https://oxraakhcpvthlvjvapay.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94cmFha2hjcHZ0aGx2anZhcGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzY4MTUsImV4cCI6MjA5MzY1MjgxNX0.dftK8Qb9zjzwEVGRLv4Q54Pqn2SLrzOxUqydIYf3Xd8';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const PROMPTS_FILE = './prompts.json';
const LOVABLE_URL = process.env.LOVABLE_URL || 'https://id-preview--82197b76-973a-461d-86d9-6790e471f6b6.lovable.app';
const BOT_SECRET = process.env.BOT_WEBHOOK_SECRET || '';
const TEMPLATE_HISTORY_FILE = './template_history.json';

// ── טעינת פרומפטים ──
function loadPrompts() {
  try { if (fs.existsSync(PROMPTS_FILE)) return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8')); } catch(e) {}
  return {};
}

// ── היסטוריית תבניות ──
function loadTemplateHistory() {
  try { if (fs.existsSync(TEMPLATE_HISTORY_FILE)) return JSON.parse(fs.readFileSync(TEMPLATE_HISTORY_FILE, 'utf8')); } catch(e) {}
  return { lastVariant: -1, lastQuestionCount: 0, lastTwoRaffles: false };
}

function saveTemplateHistory(data) {
  fs.writeFileSync(TEMPLATE_HISTORY_FILE, JSON.stringify(data, null, 2));
}

// ── בחר תבנית ברוטציה ──
function chooseTemplate(history) {
  const rotations = [
    { variant: 0, questionCount: 1 },
    { variant: 1, questionCount: 2 },
    { variant: 0, questionCount: 1 },
    { variant: 2, questionCount: 3 },
    { variant: 1, questionCount: 2 },
    { variant: 0, questionCount: 1 },
  ];
  for (let i = 0; i < rotations.length; i++) {
    const r = rotations[i];
    if (r.variant !== history.lastVariant || r.questionCount !== history.lastQuestionCount) {
      return r;
    }
  }
  return { variant: 0, questionCount: 1 };
}

// ── האם לשלוח 2 הגרלות היום? (כ-30% מהימים) ──
function shouldSendTwoRaffles(history) {
  if (history.lastTwoRaffles) return false; // לא יומיים ברצף
  return Math.random() < 0.3; // 30% סיכוי
}

// ── שלוף הגרלות פתוחות מ-Lovable ──
async function getOpenRaffles() {
  try {
    const res = await axios.get(LOVABLE_URL + '/api/public/bot/raffles?locked=false', {
      headers: { 'X-Bot-Secret': BOT_SECRET }
    });
    return res.data || [];
  } catch(err) {
    console.error('❌ שגיאה בשליפת הגרלות:', err.message);
    return [];
  }
}

// ── שנה תבנית ──
async function setTemplate(raffleId, variant, questionCount) {
  try {
    await axios.post(LOVABLE_URL + '/api/public/bot/template', {
      raffleId,
      variant,
      questionCount
    }, { headers: { 'X-Bot-Secret': BOT_SECRET, 'Content-Type': 'application/json' } });
    console.log('✅ תבנית שונתה: variant=' + variant + ', questions=' + questionCount);
    return true;
  } catch(err) {
    console.error('❌ שגיאה בשינוי תבנית:', err.message);
    return false;
  }
}

// ── נעל הגרלה ──
async function lockRaffle(raffleId) {
  try {
    await axios.post(LOVABLE_URL + '/api/public/bot/lock', {
      raffleId
    }, { headers: { 'X-Bot-Secret': BOT_SECRET, 'Content-Type': 'application/json' } });
    console.log('✅ הגרלה ננעלה: ' + raffleId);
    return true;
  } catch(err) {
    console.error('❌ שגיאה בנעילת הגרלה:', err.message);
    return false;
  }
}

// ── נעל והשלח הגרלה אחת ──
async function lockAndSendRaffle(raffles, history) {
  if (!raffles.length) { console.log('אין הגרלות פתוחות'); return false; }
  const raffle = raffles[Math.floor(Math.random() * raffles.length)];
  console.log('🎯 נבחרה: ' + (raffle.match_title || raffle.id));
  const template = chooseTemplate(history);
  await setTemplate(raffle.id, template.variant, template.questionCount);
  const locked = await lockRaffle(raffle.id);
  if (locked) {
    saveTemplateHistory({
      lastVariant: template.variant,
      lastQuestionCount: template.questionCount,
      lastTwoRaffles: false
    });
  }
  return locked;
}

// ── שלח הודעת טקסט ──
async function sendText(text) {
  if (isShabbat() && !isMoatzash()) { console.log('🕌 שבת'); return; }
  if (!text) return;
  try {
    await axios.post(SERVER_URL + '/api/sendText', { chatId: GROUP_ID, content: text });
    console.log('✅ נשלח:', text.substring(0, 40) + '...');
  } catch (err) { console.error('❌ שגיאה:', err.message); }
}

// ── שלח תוצאות ──
async function sendResults(raffle) {
  try {
    if (raffle.results_image_url) {
      await axios.post(SERVER_URL + '/api/sendImage', { chatId: GROUP_ID, url: raffle.results_image_url, caption: raffle.results || '' });
    } else {
      await axios.post(SERVER_URL + '/api/sendText', { chatId: GROUP_ID, content: raffle.results || '' });
    }
    console.log('✅ תוצאות נשלחו');
  } catch (err) { console.error('❌ שגיאה:', err.message); }
}

// ── האם עכשיו שבת? ──
function isShabbat() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 5 && hour >= 17) return true;
  if (day === 6 && hour < 20) return true;
  return false;
}

// ── בונוס לפי יום ──
function getTodayBonus() {
  const day = new Date().getDay();
  if (day === 1 || day === 3) return '30deposit';
  if (day === 2 || day === 4) return '100casino';
  if (day === 4 || day === 5) return 'weekend';
  return 'none';
}

// ── יצירת הודעה עם AI ──
async function generateMessage(type) {
  const config = loadPrompts();
  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayName = dayNames[new Date().getDay()];
  const bonus = getTodayBonus();
  const br = config.bonusRules || {};

  let bonusInstruction = 'אין בונוס מיוחד היום, שמור על טבעי.';
  if (bonus === '30deposit') bonusInstruction = 'היום יש ' + (br.monday_wednesday || '30% הפקדה לא מקוזז') + '. הזכר פעם אחת בלבד בערב.';
  if (bonus === '100casino') bonusInstruction = 'היום יש ' + (br.tuesday_thursday || '100% קזינו ו-50% ספורט') + '. הזכר פעם אחת בלבד בערב.';
  if (bonus === 'weekend') bonusInstruction = 'סופ"ש! שווק חזק: ' + (br.weekend || '100% קזינו ו-50% ספורט') + ' 100₪ מתנה בהפקדה!';

  const promptTemplate = (config.prompts && config.prompts[type]) || ('אתה ' + (config.agentName || 'רובי') + ', סוכן הימורים. כתוב הודעה קצרה לקהילה. סיים עם wa.me/972' + (config.agentPhone || '547554270'));
  const prompt = promptTemplate
    .replace(/{agentName}/g, config.agentName || 'רובי')
    .replace(/{agentPhone}/g, config.agentPhone || '547554270')
    .replace(/{day}/g, dayName)
    .replace(/{baseRules}/g, config.baseRules || '')
    .replace(/{bonusInstruction}/g, bonusInstruction);

  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    }, { headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } });
    return res.data.content[0].text;
  } catch (err) {
    console.error('❌ שגיאה ב-AI:', err.message);
    return null;
  }
}

async function sendWithDelay(fn, maxMinutes) {
  const delay = randomDelay(maxMinutes || 10);
  await new Promise(r => setTimeout(r, delay));
  await fn();
}

// ── שלוף תוצאות אתמול ──
async function getYesterdayResults() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  const res = await axios.get(SUPABASE_URL + '/rest/v1/raffles?raffle_date=eq.' + dateStr + '&results=not.is.null&is_finished=eq.true', { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } });
  return res.data;
}

// ══════════════════════════════════════
// ── לוח הזמנים ──
// ══════════════════════════════════════

// 09:00 — תוצאות אתמול
cron.schedule('0 9 * * *', async () => {
  console.log('⏰ 09:00');
  const results = await getYesterdayResults();
  for (const r of results) { await sendResults(r); await new Promise(res => setTimeout(res, 3000)); }
}, { timezone: 'Asia/Jerusalem' });

// 10:00 — הודעת בוקר
cron.schedule('0 10 * * *', async () => {
  console.log('⏰ 10:00');
  await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'morning'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

// 12:00 — הודעת צהריים
cron.schedule('0 12 * * *', async () => {
  console.log('⏰ 12:00');
  await sendWithDelay(async () => {
    const type = isMoatzash() ? 'motzash' : isWeekend() ? 'weekend' : 'noon';
    const msg = await generateMessage(type);
    await sendText(msg);
  });
}, { timezone: 'Asia/Jerusalem' });

// 14:30 — נעל הגרלות (webhook יאחסן בתור ממתינות)
cron.schedule('30 14 * * *', async () => {
  console.log('⏰ 14:30 — נועל הגרלות ליום...');
  if (isShabbat() || isMoatzash()) { console.log('שבת/מוצ"ש — לא נועל'); return; }
  const history = loadTemplateHistory();
  const raffles = await getOpenRaffles();
  if (!raffles.length) { console.log('אין הגרלות פתוחות'); return; }
  const twoRaffles = shouldSendTwoRaffles(history);
  console.log('📋 היום ' + (twoRaffles ? '2 הגרלות' : 'הגרלה אחת'));
  if (twoRaffles && raffles.length >= 2) {
    const football = raffles.find(function(r) { return r.sport === 'football'; }) || raffles[0];
    const basketball = raffles.find(function(r) { return r.sport === 'basketball' && r.id !== football.id; }) || raffles[1];
    const t1 = chooseTemplate(history);
    await setTemplate(football.id, t1.variant, t1.questionCount);
    await lockRaffle(football.id);
    const t2 = chooseTemplate({ lastVariant: t1.variant, lastQuestionCount: t1.questionCount });
    await setTemplate(basketball.id, t2.variant, t2.questionCount);
    await lockRaffle(basketball.id);
    saveTemplateHistory({ lastVariant: t2.variant, lastQuestionCount: t2.questionCount, lastTwoRaffles: true });
  } else {
    await lockAndSendRaffle(raffles, history);
    saveTemplateHistory({ ...loadTemplateHistory(), lastTwoRaffles: false });
  }
}, { timezone: 'Asia/Jerusalem' });

// 15:00 — הודעת אחר הצהריים
cron.schedule('0 15 * * *', async () => {
  console.log('⏰ 15:00');
  await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'afternoon'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

// 18:00 — הודעת ערב

  console.log('⏰ 18:00');
  await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'evening'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });



// 22:00 — הודעת לילה
cron.schedule('0 22 * * *', async () => {
  console.log('⏰ 22:00');
  await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'lateEvening'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

// 00:00 — הודעת חצות
cron.schedule('0 0 * * *', async () => {
  console.log('⏰ 00:00');
  await sendWithDelay(async () => { const msg = await generateMessage('midnight'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

// 01:00 — לילה מאוחר
cron.schedule('0 1 * * *', async () => {
  console.log('⏰ 01:00');
  await sendWithDelay(async () => { const msg = await generateMessage('lateNight'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

// 02:00 — שעתיים לפנות בוקר
cron.schedule('0 2 * * *', async () => {
  console.log('⏰ 02:00');
  await sendWithDelay(async () => { const msg = await generateMessage('veryLateNight'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

// פונקציה שנדרשת מ-server.js
function shouldSendTwoRaffles(history) {
  if (history.lastTwoRaffles) return false;
  return Math.random() < 0.3;
}

console.log('📅 תזמון אוטומטי פעיל — שעון ישראל');
