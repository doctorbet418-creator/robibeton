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

function isShabbat() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 5 && hour >= 17) return true;
  if (day === 6 && hour < 20) return true;
  return false;
}

function getTodayBonus() {
  const day = new Date().getDay();
  if (day === 1 || day === 3) return '30deposit';
  if (day === 2 || day === 4) return '100casino';
  if (day === 4 || day === 5) return 'weekend';
  return 'none';
}

function loadPrompts() {
  try {
    if (fs.existsSync(PROMPTS_FILE)) return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
  } catch(e) {}
  return getDefaultPrompts();
}

function getDefaultPrompts() {
  return {
    agentName: 'רובי',
    agentPhone: '547554270',
    baseRules: `כתוב בסגנון חברותי וחם כמו חבר טוב שכותב לחברים שלו
השתמש באימוג'ים בצורה טבעית — לא יותר מדי ולא פחות מדי
אל תשתמש במקפים ארוכים (—) בכלל
תהיה ספציפי וישיר — אל תדבר על משחקים שאתה לא יודע עליהם
אל תמציא שמות קבוצות או תוצאות
תמיד סיים עם קישור ליצירת קשר`,
    bonusRules: {
      monday_wednesday: 'בונוס הפקדה 30% לא מקוזז',
      tuesday_thursday: 'בונוס 100% קזינו ו-50% ספורט',
      weekend: '100% קזינו ו-50% ספורט'
    },
    prompts: {
      morning: `אתה {agentName}, סוכן הימורים של BetON עם קהילת VIP בוואטסאפ.
כתוב הודעת בוקר קצרה לקהילה. יום: {day}.

חוקים:
{baseRules}
אל תזכיר בונוסים ספציפיים בבוקר
אל תדבר על משחקים ספציפיים שאתה לא יודע עליהם
אורך: 2-3 שורות קצרות
סיים עם: wa.me/972{agentPhone} | {agentName} 🎰`,

      noon: `אתה {agentName}, סוכן הימורים של BetON.
כתוב הודעת צהריים קצרה לקהילה. יום: {day}.

חוקים:
{baseRules}
הזכר לפעמים שהמחלקה הפיננסית פתוחה עד 18:00 למשיכות
אל תזכיר בונוסים בצהריים
אורך: 2-3 שורות
סיים עם: wa.me/972{agentPhone} | {agentName} 🎰`,

      afternoon: `אתה {agentName}, סוכן הימורים של BetON.
כתוב הודעת אחר צהריים לקהילה. יום: {day}.

חוקים:
{baseRules}
אפשר לרמוז שיש משחקים בערב בלי לפרט אותם
אל תזכיר בונוסים עדיין
אורך: 2-3 שורות
סיים עם: wa.me/972{agentPhone} | {agentName} 🎰`,

      evening: `אתה {agentName}, סוכן הימורים של BetON.
כתוב הודעת ערב לקהילה. יום: {day}.

חוקים:
{baseRules}
{bonusInstruction}
אם יש בונוס היום — הצג אותו בצורה ברורה ומפתה עם אימוג'ים
ציין שהבונוס לא מקוזז במשיכה — זה חשוב מאוד!
אורך: 4-7 שורות
סיים עם: wa.me/972{agentPhone} | {agentName} 🎰`,

      lateEvening: `אתה {agentName}, סוכן הימורים של BetON.
כתוב הודעת לילה (22:00) לקהילה. יום: {day}.

חוקים:
{baseRules}
דבר על קזינו ומשחקי לילה בצורה מרגשת
אפשר להציע בונוס קזינו לשעות הלילה
אורך: 4-6 שורות
סיים עם: wa.me/972{agentPhone} | {agentName} 🎰`,

      midnight: `אתה {agentName}, סוכן הימורים של BetON.
כתוב הודעת חצות לקהילה.

חוקים:
{baseRules}
{agentName} ער 24/6 ומחכה להפקדות
אפשר לציין בונוס לשעות הלילה
אורך: 2-4 שורות
סיים עם: wa.me/972{agentPhone} | {agentName} 🎰`,

      lateNight: `אתה {agentName}, סוכן הימורים של BetON.
כתוב הודעת 01:00 לקהילה.

חוקים:
{baseRules}
שעות קטנות — ציפורי לילה מרוויחות יותר
קצר מאוד, 2-3 שורות
סיים עם: wa.me/972{agentPhone} | {agentName} 🎰`,

      veryLateNight: `אתה {agentName}, סוכן הימורים של BetON.
כתוב הודעת 02:00 לקהילה.

חוקים:
{baseRules}
שעתיים לפנות בוקר — הקזינו לא עוצר
קצר מאוד, 2 שורות
סיים עם: wa.me/972{agentPhone} | {agentName} 🎰`,

      weekend: `אתה {agentName}, סוכן הימורים של BetON.
כתוב הודעת סופ"ש לקהילה. יום: {day}.

חוקים:
{baseRules}
זה סופ"ש! תשתגע עם הבונוסים:
🎰 100% בונוס קזינו
⚽ 50% בונוס ספורט
הדגש שהבונוסים לא מקוזזים במשיכה
אפשר לציין בונוסים מיוחדים להפקדות גדולות
אורך: 5-8 שורות מושקעות
סיים עם: wa.me/972{agentPhone} | {agentName} 🎰`,

      motzash: `אתה {agentName}, סוכן הימורים של BetON.
כתוב הודעת מוצאי שבת לקהילה.

חוקים:
{baseRules}
שבת יצאה — חוזרים לאקשן!
שבוע טוב לכולם, עכשיו מתחילים שבוע חדש
אורך: 3-4 שורות
סיים עם: wa.me/972{agentPhone} | {agentName} 🎰`,

      afterRaffle: `אתה {agentName}, סוכן הימורים של BetON.
הרגע שלחת הגרלה לקהילה. כתוב הודעת עידוד קצרה.

חוקים:
{baseRules}
עודד להגיב עם הניחוש
הזכר שרק מי שהפקיד אצל {agentName} זכאי לזכות
אורך: 2-3 שורות קצרות
סיים עם {agentName} 🎰`,
    }
  };
}

async function generateMessage(type) {
  const config = loadPrompts();
  const now = new Date();
  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayName = dayNames[now.getDay()];
  const bonus = getTodayBonus();

  let bonusInstruction = 'אין בונוס מיוחד היום — שמור על הודעה טבעית ומעניינת בלי להבטיח כלום.';
  const br = config.bonusRules || {};
  if (bonus === '30deposit') bonusInstruction = `היום יש ${br.monday_wednesday || 'בונוס הפקדה 30% לא מקוזז'}. הזכר את זה פעם אחת בלבד בערב.`;
  if (bonus === '100casino') bonusInstruction = `היום יש ${br.tuesday_thursday || 'בונוס 100% קזינו ו-50% ספורט'}. הזכר את זה פעם אחת בלבד בערב.`;
  if (bonus === 'weekend') bonusInstruction = `סופ"ש! תשווק חזק: ${br.weekend || '100% קזינו ו-50% ספורט'} — לא מקוזז במשיכה!`;

  const promptTemplate = config.prompts?.[type] || config.prompts?.morning || '';
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
    }, {
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    });
    return res.data.content[0].text;
  } catch (err) {
    console.error('❌ שגיאה ב-AI:', err.message);
    return null;
  }
}

async function sendWithDelay(fn, maxMinutes = 10) {
  const delay = randomDelay(maxMinutes);
  await new Promise(resolve => setTimeout(resolve, delay));
  await fn();
}

async function sendText(text) {
  if (isShabbat() && !isMoatzash()) { console.log('🕌 שבת'); return; }
  if (!text) return;
  try {
    await axios.post(`${SERVER_URL}/api/sendText`, { chatId: GROUP_ID, content: text });
    console.log('✅ נשלח:', text.substring(0, 40) + '...');
  } catch (err) { console.error('❌ שגיאה:', err.message); }
}

async function sendRaffle(raffle) {
  if (isShabbat() && !isMoatzash()) return false;
  try {
    if (raffle.image_url) {
      await axios.post(`${SERVER_URL}/api/sendImage`, { chatId: GROUP_ID, url: raffle.image_url, caption: raffle.raffle_text || '', raffleId: raffle.id });
    } else {
      await axios.post(`${SERVER_URL}/api/sendTextWithId`, { chatId: GROUP_ID, content: raffle.raffle_text || '', raffleId: raffle.id });
    }
    console.log('✅ הגרלה נשלחה:', raffle.match_title);
    watchRaffleForFinish(raffle.id);
    return true;
  } catch (err) { console.error('❌ שגיאה:', err.message); return false; }
}

async function sendResults(raffle) {
  try {
    if (raffle.results_image_url) {
      await axios.post(`${SERVER_URL}/api/sendImage`, { chatId: GROUP_ID, url: raffle.results_image_url, caption: raffle.results || '' });
    } else {
      await axios.post(`${SERVER_URL}/api/sendText`, { chatId: GROUP_ID, content: raffle.results || '' });
    }
    console.log('✅ תוצאות נשלחו');
  } catch (err) { console.error('❌ שגיאה:', err.message); }
}

function watchRaffleForFinish(raffleId) {
  const checkInterval = setInterval(async () => {
    try {
      const res = await axios.get(`${SUPABASE_URL}/rest/v1/raffles?id=eq.${raffleId}&select=is_finished,results`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
      const raffle = res.data[0];
      if (raffle?.is_finished && raffle?.results) {
        clearInterval(checkInterval);
        setTimeout(async () => {
          try {
            const { findWinners } = require('./winner-finder');
            const msgRes = await axios.get(`${SERVER_URL}/api/getRaffleMessageId?raffleId=${raffleId}`);
            if (msgRes.data.messageId) await findWinners(raffleId, msgRes.data.messageId);
          } catch (err) { console.error('שגיאה בזוכים:', err.message); }
        }, 2 * 60 * 1000);
      }
    } catch (err) { console.error('שגיאה:', err.message); }
  }, 5 * 60 * 1000);
  setTimeout(() => clearInterval(checkInterval), 12 * 60 * 60 * 1000);
}

async function getTodayRaffles() {
  const today = new Date().toISOString().split('T')[0];
  const res = await axios.get(`${SUPABASE_URL}/rest/v1/raffles?raffle_date=eq.${today}&locked=eq.true&order=created_at.asc`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
  return res.data;
}

async function getYesterdayResults() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const res = await axios.get(`${SUPABASE_URL}/rest/v1/raffles?raffle_date=eq.${yesterday.toISOString().split('T')[0]}&results=not.is.null&is_finished=eq.true`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
  return res.data;
}

cron.schedule('0 9 * * *', async () => {
  console.log('⏰ 09:00');
  const results = await getYesterdayResults();
  for (const r of results) { await sendResults(r); await new Promise(res => setTimeout(res, 3000)); }
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 10 * * *', async () => {
  console.log('⏰ 10:00');
  await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'morning'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 11 * * *', async () => {
  console.log('⏰ 11:00');
  const raffles = await getTodayRaffles();
  if (raffles.length > 0) {
    const sent = await sendRaffle(raffles[0]);
    if (sent) setTimeout(async () => { const msg = await generateMessage('afterRaffle'); await sendText(msg); }, 60 * 60 * 1000);
  }
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 12 * * *', async () => {
  console.log('⏰ 12:00');
  await sendWithDelay(async () => { const type = isMoatzash() ? 'motzash' : isWeekend() ? 'weekend' : 'noon'; const msg = await generateMessage(type); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 15 * * *', async () => {
  console.log('⏰ 15:00');
  await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'afternoon'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 18 * * *', async () => {
  console.log('⏰ 18:00');
  await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'evening'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 20 * * *', async () => {
  console.log('⏰ 20:00');
  if (isMoatzash()) { await sendWithDelay(async () => { const msg = await generateMessage('motzash'); await sendText(msg); }); return; }
  const raffles = await getTodayRaffles();
  if (raffles.length > 1) {
    const sent = await sendRaffle(raffles[1]);
    if (sent) setTimeout(async () => { const msg = await generateMessage('afterRaffle'); await sendText(msg); }, 60 * 60 * 1000);
  }
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 22 * * *', async () => {
  console.log('⏰ 22:00');
  await sendWithDelay(async () => { const msg = await generateMessage(isWeekend() ? 'weekend' : 'lateEvening'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 0 * * *', async () => {
  console.log('⏰ 00:00');
  await sendWithDelay(async () => { const msg = await generateMessage('midnight'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 1 * * *', async () => {
  console.log('⏰ 01:00');
  await sendWithDelay(async () => { const msg = await generateMessage('lateNight'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

cron.schedule('0 2 * * *', async () => {
  console.log('⏰ 02:00');
  await sendWithDelay(async () => { const msg = await generateMessage('veryLateNight'); await sendText(msg); });
}, { timezone: 'Asia/Jerusalem' });

console.log('📅 תזמון אוטומטי פעיל — שעון ישראל');
