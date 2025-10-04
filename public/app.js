const API = {
    points: '/api/points',
    myTickets: (uid) => `/api/user/${encodeURIComponent(uid)}/tickets`,
    join: '/api/queue/join',
    leave: '/api/queue/leave',
    stream: '/api/stream',
    settings: '/api/settings'
};

function getUID() {
    let id = localStorage.getItem('user_uid');
    if (!id) { id = 'uid_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('user_uid', id); }
    return id;
}
const USER_ID = getUID();

let points = [], myTickets = [], ACTIVE_LIMIT = 0;

async function fetchJSON(url, opts) {
    const r = await fetch(url, opts);
    const txt = await r.text();
    try { const j = txt ? JSON.parse(txt) : {}; if (!r.ok) throw j; return j; } catch (e) { throw e; }
}

async function loadSettings() {
    try { const s = await fetchJSON(API.settings); ACTIVE_LIMIT = Number(s.active_limit || 0); } catch (e) { ACTIVE_LIMIT = 0; }
}

async function loadPoints() {
    try { points = await fetchJSON(API.points); } catch (e) { points = []; }
    renderPoints();
}

async function loadMyTickets() {
    try { myTickets = await fetchJSON(API.myTickets(USER_ID)); } catch (e) { myTickets = []; }
    renderMyTickets();
    reflectJoinButtons();
}

function renderPoints() {
    const el = document.getElementById('points');
    if (!el) return;
    el.innerHTML = '';
    if (!points.length) { el.innerHTML = '<div class="muted">Нет точек</div>'; return; }
    for (const p of points) {
        const card = document.createElement('div'); card.className = 'point-card';
        const queued = p.queue_count ?? p.queued_count ?? 0;
        card.innerHTML = `
      <div class="card-left">
        <div class="title">${p.name}</div>
        <div class="subtitle">${p.sector || ''}</div>
        <div class="meta">В очереди: <span class="badge" id="qcount-${p.id}">${queued}</span> / ${p.max_queue || 0}</div>
      </div>
      <div class="card-right">
        <button class="btn primary" data-join="${p.id}">Занять очередь</button>
      </div>`;
        el.appendChild(card);
    }
    document.querySelectorAll('[data-join]').forEach(b => b.addEventListener('click', () => joinQueue(Number(b.dataset.join))));
    reflectJoinButtons();
}

function renderMyTickets() {
    const el = document.getElementById('myQueues'), empty = document.getElementById('emptyMyQueues');
    if (!el) return;
    el.innerHTML = '';
    if (!myTickets.length) { if (empty) empty.classList.remove('hidden'); return; }
    if (empty) empty.classList.add('hidden');
    for (const t of myTickets) {
        const card = document.createElement('div'); card.className = 'point-card my-ticket';
        card.innerHTML = `<div class="card-left"><div class="title">${t.name}</div><div class="meta">Позиция: <b>${t.position || 0}</b></div></div>
      <div class="card-right"><button class="btn gray" data-leave="${t.ticketId}">Выйти</button></div>`;
        el.appendChild(card);
    }
    document.querySelectorAll('[data-leave]').forEach(b => b.addEventListener('click', () => leaveQueue(b.dataset.leave)));
}

function reflectJoinButtons() {
    document.querySelectorAll('[data-join]').forEach(btn => {
        const pid = Number(btn.dataset.join);
        const has = myTickets.some(t => t.pointId === pid);
        if (has) { btn.disabled = true; btn.textContent = 'В очереди'; }
        else if (ACTIVE_LIMIT && myTickets.length >= ACTIVE_LIMIT) { btn.disabled = true; btn.textContent = `Лимит ${ACTIVE_LIMIT}`; }
        else { btn.disabled = false; btn.textContent = 'Занять очередь'; }
    });
}

async function joinQueue(pointId) {
    if (!USER_ID || !pointId) { alert('Отсутствует user_uid или point_id'); return; }
    const payload = { user_uid: USER_ID, point_id: pointId, userId: USER_ID, pointId: pointId };
    try {
        const res = await fetch(API.join, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const txt = await res.text();
        let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
        if (!res.ok) { alert(data.error || 'Ошибка сервера'); return; }
        await loadMyTickets(); await loadPoints();
    } catch (e) { console.error(e); alert('Ошибка сети'); }
}

async function leaveQueue(ticketId) {
    const t = myTickets.find(x => x.ticketId == ticketId);
    if (!t) return alert('Талон не найден');
    const payload = { user_uid: USER_ID, point_id: t.pointId, ticketId: ticketId };
    try {
        const res = await fetch(API.leave, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const txt = await res.text();
        let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
        if (!res.ok) { alert(data.error || 'Ошибка сервера'); return; }
        await loadMyTickets(); await loadPoints();
    } catch (e) { console.error(e); alert('Ошибка сети'); }
}

function connectSSE() {
    try {
        const es = new EventSource(API.stream);
        es.addEventListener('update', ev => {
            // if server dispatches named events
            try {
                const data = JSON.parse(ev.data);
                data.forEach(p => {
                    const el = document.getElementById(`qcount-${p.id}`);
                    if (el) el.textContent = p.queue_count ?? p.queued_count ?? 0;
                });
                loadMyTickets();
            } catch (e) { console.error('SSE parse', e); }
        });
        es.onmessage = ev => { // fallback if server sends plain data
            try {
                const rows = JSON.parse(ev.data);
                rows.forEach(p => {
                    const el = document.getElementById(`qcount-${p.id}`);
                    if (el) el.textContent = p.queue_count ?? p.queued_count ?? 0;
                });
                loadMyTickets();
            } catch (e) { /* ignore */ }
        };
    } catch (e) { console.warn('SSE not available', e); }
}

async function init() {
    await loadSettings();
    await loadMyTickets();
    await loadPoints();
    connectSSE();
}

init();
