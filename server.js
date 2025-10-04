const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// === DATABASE ===
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL;');

    db.run(`
    CREATE TABLE IF NOT EXISTS points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sector TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      avg_service_time_sec INTEGER NOT NULL DEFAULT 60,
      max_queue INTEGER NOT NULL DEFAULT 0
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS queue_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      point_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','serving','done','canceled')),
      created_at DATETIME NOT NULL DEFAULT (datetime('now')),
      finished_at DATETIME,
      FOREIGN KEY(point_id) REFERENCES points(id)
    )
  `);

    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

    // Инициализация стандартных точек
    db.get(`SELECT COUNT(*) AS c FROM points`, (err, row) => {
        if (!row || row.c === 0) {
            const stmt = db.prepare(`INSERT INTO points (name, sector, avg_service_time_sec) VALUES (?, ?, ?)`);
            const data = [
                ['Притяжение', 'Сектор 1', 60],
                ['Т-Город', 'Сектор 2', 90],
                ['Т-Образование', 'Сектор 3', 60],
                ['Т-Лаунч', 'Сектор 4', 70],
                ['Т-Бизнес', 'Сектор 5', 50]
            ];
            data.forEach(d => stmt.run(d));
            stmt.finalize();
            console.log('✅ Добавлены стандартные точки');
        }
    });
});

// === EXPRESS CONFIG ===
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === SSE ===
const clients = new Set();

function broadcastPointUpdate(pointId) {
    db.get(`SELECT COUNT(*) AS c FROM queue_tickets WHERE point_id = ? AND status = 'queued'`, [pointId], (err, row) => {
        const count = row ? row.c : 0;
        const payload = `event: update\ndata: ${JSON.stringify({ pointId, queuedCount: count })}\n\n`;
        for (const res of clients) {
            try { res.write(payload); } catch { }
        }
    });
}

app.get('/api/stream', (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
});

// === API ===

// Все точки
app.get('/api/points', (req, res) => {
    db.all(`
    SELECT p.id, p.name, p.sector, p.is_active, p.avg_service_time_sec, p.max_queue,
      (SELECT COUNT(*) FROM queue_tickets q WHERE q.point_id = p.id AND q.status = 'queued') AS queued_count
    FROM points p
    WHERE p.is_active = 1
    ORDER BY p.id
  `, (err, rows) => {
        if (err) {
            console.error('Ошибка при получении точек:', err);
            return res.status(500).send('Ошибка базы данных');
        }
        res.json(rows);
    });
});

// Талоны пользователя
app.get('/api/user/:userId/tickets', (req, res) => {
    const { userId } = req.params;
    db.all(`
    SELECT q.id, q.point_id, p.name, p.sector, p.avg_service_time_sec, q.created_at
    FROM queue_tickets q
    JOIN points p ON p.id = q.point_id
    WHERE q.user_id = ? AND q.status = 'queued'
    ORDER BY q.created_at
  `, [userId], (err, rows) => {
        if (err) {
            console.error('Ошибка при получении талонов:', err);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }

        const promises = rows.map(r => new Promise(resolve => {
            db.get(`
        SELECT COUNT(*) + 1 AS position
        FROM queue_tickets
        WHERE point_id = ? AND status = 'queued' AND created_at < ?
      `, [r.point_id, r.created_at], (err2, posRow) => {
                const position = posRow ? posRow.position : 1;
                const etaMin = Math.max(1, Math.ceil((position * r.avg_service_time_sec) / 60));
                resolve({ ticketId: r.id, pointId: r.point_id, name: r.name, sector: r.sector, position, etaMin });
            });
        }));

        Promise.all(promises).then(result => res.json(result));
    });
});

// === Присоединиться к очереди (с проверкой совпадения времени) ===
app.post('/api/queue/join', (req, res) => {
    const { userId, pointId } = req.body;
    if (!userId || !pointId) return res.status(400).json({ error: 'userId и pointId обязательны' });

    // Проверяем, есть ли уже активный талон
    db.get(`
    SELECT q.id, q.point_id, p.name
    FROM queue_tickets q
    JOIN points p ON p.id = q.point_id
    WHERE q.user_id = ? AND q.status = 'queued'
    ORDER BY q.created_at LIMIT 1
  `, [userId], (err, activeRow) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }

        if (activeRow) {
            // Предупреждение о пересечении времени
            return res.json({
                delayed: true,
                message: `У вас уже есть активный талон (${activeRow.name}). Новый талон можно будет взять после завершения текущего.`
            });
        }

        // Проверяем, не стоит ли пользователь уже в этой же очереди
        db.get(`
      SELECT id FROM queue_tickets WHERE user_id = ? AND point_id = ? AND status = 'queued'
    `, [userId, pointId], (err2, row) => {
            if (err2) {
                console.error(err2);
                return res.status(500).json({ error: 'Ошибка базы данных' });
            }
            if (row) return res.json({ ticketId: row.id, alreadyQueued: true });

            // Добавляем новый талон
            db.run(`
        INSERT INTO queue_tickets(point_id, user_id, status)
        VALUES (?, ?, 'queued')
      `, [pointId, userId], function (err3) {
                if (err3) {
                    console.error(err3);
                    return res.status(500).json({ error: 'Ошибка базы данных' });
                }

                const ticketId = this.lastID;
                db.get(`
          SELECT COUNT(*) + 1 AS position
          FROM queue_tickets
          WHERE point_id = ? AND status = 'queued' AND id < ?
        `, [pointId, ticketId], (err4, posRow) => {
                    const position = posRow ? posRow.position : 1;
                    broadcastPointUpdate(pointId);
                    res.json({ ticketId, pointId, position });
                });
            });
        });
    });
});

// === Выйти из очереди ===
app.post('/api/queue/leave', (req, res) => {
    const { userId, ticketId } = req.body;
    if (!userId || !ticketId) return res.status(400).json({ error: 'userId и ticketId обязательны' });

    db.get(`SELECT point_id FROM queue_tickets WHERE id=? AND user_id=? AND status='queued'`, [ticketId, userId], (err, row) => {
        if (!row) return res.status(404).json({ error: 'Талон не найден или уже не активен' });

        db.run(`UPDATE queue_tickets SET status='canceled', finished_at=datetime('now') WHERE id=?`, [ticketId], err2 => {
            if (err2) return res.status(500).json({ error: 'Ошибка базы данных' });
            broadcastPointUpdate(row.point_id);
            res.json({ ok: true });
        });
    });
});

// === Admin API ===
app.get('/api/admin/points', (req, res) => {
    db.all(`SELECT id, name, sector, is_active, avg_service_time_sec, max_queue FROM points ORDER BY id`, (err, rows) => {
        if (err) {
            console.error('Ошибка при получении точек (админ):', err);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }
        res.json(rows);
    });
});

app.post('/api/admin/points/:id', (req, res) => {
    const id = Number(req.params.id);
    const { name, sector, is_active, avg_service_time_sec, max_queue } = req.body;

    db.run(`
    UPDATE points
    SET name = ?, sector = ?, is_active = ?, avg_service_time_sec = ?, max_queue = ?
    WHERE id = ?
  `, [name, sector, is_active, avg_service_time_sec, max_queue, id], function (err) {
        if (err) {
            console.error('Ошибка при обновлении точки:', err);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }
        res.json({ ok: true });
    });
});

app.get('/api/settings', (req, res) => {
    db.all(`SELECT key, value FROM settings`, (err, rows) => {
        if (err) {
            console.error('Ошибка при получении настроек:', err);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    });
});

app.post('/api/settings', (req, res) => {
    const { active_limit, sla_target_min } = req.body || {};

    const stmt = db.prepare(`
    INSERT INTO settings(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);

    if (typeof active_limit !== 'undefined') stmt.run('active_limit', String(active_limit));
    if (typeof sla_target_min !== 'undefined') stmt.run('sla_target_min', String(sla_target_min));

    stmt.finalize();
    res.json({ ok: true });
});

// === START SERVER ===
app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});
