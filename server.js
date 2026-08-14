const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'submissions.json');

const USE_PG = !!process.env.POSTGRES_URL;

let pool = null;
if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function initPg() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      service TEXT,
      message TEXT NOT NULL,
      received_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

async function readSubmissions() {
  if (USE_PG) {
    const { rows } = await pool.query(
      'SELECT id, name, email, service, message, received_at FROM submissions ORDER BY received_at DESC'
    );
    return rows;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function saveSubmission(entry) {
  if (USE_PG) {
    await pool.query(
      'INSERT INTO submissions (id, name, email, service, message, received_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [entry.id, entry.name, entry.email, entry.service, entry.message, entry.receivedAt]
    );
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  let all = [];
  try {
    all = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {}
  all.push(entry);
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'portfolio.html'));
});

app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

app.post('/api/submit', async (req, res) => {
  const { name, email, service, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email and message are required.' });
  }
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: String(name),
    email: String(email),
    service: String(service || 'Not specified'),
    message: String(message),
    receivedAt: new Date().toISOString()
  };
  try {
    await saveSubmission(entry);
    res.json({ ok: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save submission.' });
  }
});

app.get('/api/submissions', async (req, res) => {
  try {
    const list = await readSubmissions();
    if (req.query.key === process.env.ADMIN_KEY) {
      return res.json(list);
    }
    res.json(list.map(({ id, name, email, service, received_at, receivedAt }) => ({
      id, name, email, service,
      receivedAt: received_at || receivedAt
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read submissions.' });
  }
});

app.get('/admin', async (req, res) => {
  let all = [];
  try {
    all = await readSubmissions();
  } catch {}
  const rows = all.map((s) => `
    <div class="card">
      <div class="head">
        <strong>${escapeHtml(s.name)}</strong>
        <span class="time">${escapeHtml(formatDate(s.received_at || s.receivedAt))}</span>
      </div>
      <p class="email">${escapeHtml(s.email)}</p>
      <p class="svc">Service: ${escapeHtml(s.service)}</p>
      <p class="msg">${escapeHtml(s.message)}</p>
    </div>
  `).join('');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Form Responses — GLITTCH</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',system-ui,sans-serif; background:#14081f; color:#f3e8ff; padding:40px 24px; }
  .wrap { max-width:760px; margin:0 auto; }
  h1 { font-size:26px; margin-bottom:6px; }
  .count { color:#d8b4fe; font-size:14px; margin-bottom:28px; }
  .card { background:rgba(255,255,255,0.06); border:1px solid rgba(216,180,254,0.22); border-radius:16px; padding:20px 22px; margin-bottom:16px; }
  .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
  .head strong { font-size:16px; }
  .time { font-size:12px; color:#b89ed8; }
  .email { font-size:13px; color:#d8b4fe; margin-bottom:4px; }
  .svc { font-size:12px; color:#c9b3e8; margin-bottom:8px; }
  .msg { font-size:14px; color:#e9d5ff; line-height:1.6; }
  .empty { color:#b89ed8; text-align:center; padding:60px 0; }
  a.back { color:#d8b4fe; display:inline-block; margin-top:20px; font-size:13px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Form Responses</h1>
  <div class="count">${all.length} submission${all.length === 1 ? '' : 's'} received</div>
  ${all.length ? rows : '<div class="empty">No responses yet.</div>'}
  <a class="back" href="/">← Back to site</a>
</div>
</body>
</html>`);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

if (!process.env.VERCEL) {
  (async () => {
    if (USE_PG) await initPg();
    app.listen(PORT, () => {
      console.log(`GLITTCH server running at http://localhost:${PORT}`);
    });
  })();
} else if (USE_PG) {
  initPg().catch((err) => console.error('Postgres init failed:', err));
}

module.exports = app;
