const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- SQLite ---
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), err => {
    if (err) console.error('DB open error', err);
    else console.log('✅ SQLite DB opened');
});

// --- Init schema ---
db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sector TEXT NOT NULL,
      description TEXT DEFAULT '',
      avg_service_sec INTEGER DEFAULT 60,
      max_queue INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_uid TEXT NOT NULL,
      point_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(point_id) REFERENCES points(id)
    )
  `);
});

// --- Seed default points if empty ---
db.get(`SELECT COUNT(*) AS c FROM points`, (err, row) => {
    if (!err && row && row.c === 0) {
        db.run(`
      INSERT INTO points (name, sector, description, avg_service_sec, max_queue, active) VALUES
      ('Притяжение','Сектор 1','Главная интерактивная зона',60,15,1),
      ('Т-Город','Сектор 2','Зона городской активности',90,15,1),
      ('Т-Образование','Сектор 3','Образовательные интерактивы',60,15,1),
      ('Т-Лаунч','Сектор 4','Зона отдыха и общения',70,15,1),
      ('Т-Бизнес','Сектор 5','Бизнес и нетворкинг',50,15,1)
    `);
        console.log('📍 Seed points inserted');
    }
});

// --- Settings endpoint ---
app.get('/api/settings', (req, res) => {
    res.json({ active_limit: 3 });
});

// --- List points (public) ---
app.get('/api/points', (req, res) => {
    db.all(`
    SELECT p.*,
      (SELECT COUNT(*) FROM tickets t WHERE t.point_id = p.id AND t.status = 'active') AS queue_count
    FROM points p
    WHERE p.active = 1
    ORDER BY p.id
  `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        // provide both names for compatibility
        const out = (rows || []).map(r => ({
            ...r,
            queued_count: r.queue_count,
            queue_count: r.queue_count
        }));
        res.json(out);
    });
});

// --- Get user's active tickets ---
app.get('/api/user/:uid/tickets', (req, res) => {
    const uid = req.params.uid;
    db.all(`
    SELECT t.id AS ticketId, t.point_id AS pointId, p.name, p.sector,
      (SELECT COUNT(*) FROM tickets t2 WHERE t2.point_id = t.point_id AND t2.status = 'active' AND t2.created_at < t.created_at) + 1 AS position,
      p.avg_service_sec
    FROM tickets t
    JOIN points p ON p.id = t.point_id
    WHERE t.user_uid = ? AND t.status = 'active'
    ORDER BY t.created_at
  `, [uid], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        const resRows = (rows || []).map(r => ({
            ticketId: r.ticketId,
            pointId: r.pointId,
            name: r.name,
            sector: r.sector,
            position: r.position || 1,
            etaMin: Math.max(1, Math.ceil((r.position * (r.avg_service_sec || 60)) / 60))
        }));
        res.json(resRows);
    });
});

// --- Join queue (robust: accept different field names) ---
app.post('/api/queue/join', (req, res) => {
    // accept both styles
    const user_uid = req.body.user_uid || req.body.userId || req.body.user || req.body.uid;
    const point_id = req.body.point_id || req.body.pointId || req.body.point || req.body.id;

    if (!user_uid || !point_id) return res.status(400).json({ error: 'Отсутствует user_uid или point_id' });

    // check active_limit (3) and duplicates
    db.get(`SELECT COUNT(*) AS c FROM tickets WHERE user_uid = ? AND status = 'active'`, [user_uid], (err, row) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        const userActive = row ? row.c : 0;
        if (userActive >= 3) return res.status(409).json({ error: 'Достигнут лимит активных талонов' });

        // check duplicate in same point
        db.get(`SELECT id FROM tickets WHERE user_uid = ? AND point_id = ? AND status = 'active' LIMIT 1`, [user_uid, point_id], (err2, exists) => {
            if (err2) return res.status(500).json({ error: 'DB error' });
            if (exists) return res.json({ ticketId: exists.id, pointId: Number(point_id), alreadyQueued: true });

            // check capacity of point
            db.get(`SELECT max_queue, (SELECT COUNT(*) FROM tickets WHERE point_id = ? AND status = 'active') AS queued FROM points WHERE id = ?`, [point_id, point_id], (err3, p) => {
                if (err3) return res.status(500).json({ error: 'DB error' });
                if (!p) return res.status(404).json({ error: 'Точка не найдена' });
                if (p.max_queue > 0 && p.queued >= p.max_queue) return res.status(409).json({ error: 'Лимит очереди на точке достигнут' });

                db.run(`INSERT INTO tickets (user_uid, point_id, status) VALUES (?, ?, 'active')`, [user_uid, point_id], function (err4) {
                    if (err4) return res.status(500).json({ error: 'DB error' });
                    return res.json({ ticketId: this.lastID, pointId: Number(point_id), position: 0 });
                });
            });
        });
    });
});

// --- Leave queue ---
app.post('/api/queue/leave', (req, res) => {
    const user_uid = req.body.user_uid || req.body.userId || req.body.user || req.body.uid;
    const ticketId = req.body.ticketId || req.body.ticket_id;
    const point_id = req.body.point_id || req.body.pointId || req.body.point;

    if (!user_uid || (!ticketId && !point_id)) return res.status(400).json({ error: 'Отсутствует user_uid или ticketId/point_id' });

    if (ticketId) {
        db.run(`UPDATE tickets SET status = 'left' WHERE id = ? AND user_uid = ? AND status = 'active'`, [ticketId, user_uid], function (err) {
            if (err) return res.status(500).json({ error: 'DB error' });
            return res.json({ ok: true, changed: this.changes });
        });
    } else {
        db.run(`UPDATE tickets SET status = 'left' WHERE user_uid = ? AND point_id = ? AND status = 'active'`, [user_uid, point_id], function (err) {
            if (err) return res.status(500).json({ error: 'DB error' });
            return res.json({ ok: true, changed: this.changes });
        });
    }
});

// --- Admin: create point ---
app.post('/api/points', (req, res) => {
    const body = req.body || {};
    const name = body.name;
    const sector = body.sector;
    const description = body.description || '';
    const avg = Number(body.avg_service_time_sec || body.avg_service_sec || 60);
    const maxQ = Number(body.max_queue || 0);
    const active = body.is_active ? 1 : 0;

    if (!name || !sector) return res.status(400).json({ error: 'name and sector required' });

    db.run(`INSERT INTO points (name, sector, description, avg_service_sec, max_queue, active) VALUES (?,?,?,?,?,?)`,
        [name, sector, description, avg, maxQ, active], function (err) {
            if (err) return res.status(500).json({ error: 'DB error' });
            res.json({ ok: true, id: this.lastID });
        });
});

// --- Admin: update point (works with admin.js) ---
app.post('/api/points/:id', (req, res) => {
    const id = Number(req.params.id);
    const body = req.body || {};
    const name = body.name;
    const sector = body.sector;
    const description = body.description || '';
    const avg = Number(body.avg_service_time_sec || body.avg_service_sec || 60);
    const maxQ = Number(body.max_queue || 0);
    const active = body.is_active ? 1 : 0;

    if (!name || !sector) return res.status(400).json({ error: 'name and sector required' });

    db.run(`UPDATE points SET name=?, sector=?, description=?, avg_service_sec=?, max_queue=?, active=? WHERE id=?`,
        [name, sector, description, avg, maxQ, active, id], function (err) {
            if (err) return res.status(500).json({ error: 'DB error' });
            res.json({ ok: true });
        });
});

// --- Admin: delete point ---
app.delete('/api/points/:id', (req, res) => {
    const id = Number(req.params.id);
    db.run(`DELETE FROM points WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json({ ok: true });
    });
});

// --- SSE stream (sends array of points with queue_count) ---
app.get('/api/stream', (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const send = () => {
        db.all(`SELECT p.*, (SELECT COUNT(*) FROM tickets t WHERE t.point_id = p.id AND t.status = 'active') AS queue_count FROM points p WHERE p.active = 1 ORDER BY p.id`, [], (err, rows) => {
            if (err) return;
            res.write(`data: ${JSON.stringify(rows || [])}\n\n`);
        });
    };

    send();
    const iv = setInterval(send, 3000);
    req.on('close', () => {
        clearInterval(iv);
    });
});

// serve front pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// start
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Access via: https://your-url.onrender.com`);
});
