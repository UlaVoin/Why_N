const API = {
    points: '/api/points',
    myTickets: (uid) => `/api/user/${encodeURIComponent(uid)}/tickets`,
    join: '/api/queue/join',
    leave: '/api/queue/leave',
    stream: '/api/stream',
    settings: '/api/settings'
};

function getUID() {
    const key = 'tid';
    let id = localStorage.getItem(key);
    if (!id) {
        id = 'uid_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(key, id);
    }
    return id;
}
const USER_ID = getUID();

const elPoints = document.getElementById('points');
const elMyQueues = document.getElementById('myQueues');
const elEmptyMyQueues = document.getElementById('emptyMyQueues');
const toast = document.getElementById('toast');

let points = [];
let myTickets = [];
let ticketByPoint = new Map();
let ACTIVE_LIMIT = 0;

function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
}

async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text || 'Ошибка' }; }
    if (!res.ok) {
        const err = new Error(json.error || res.statusText);
        err.data = json;
        throw err;
    }
    return json;
}

async function loadSettings() {
    try {
        const s = await fetchJSON(API.settings);
        ACTIVE_LIMIT = Number(s.active_limit || 0);
    } catch (e) {
        console.warn('settings', e);
    }
}

async function loadPoints() {
    points = await fetchJSON(API.points);
    renderPoints();
}

async function loadMyTickets() {
    myTickets = await fetchJSON(API.myTickets(USER_ID));
    ticketByPoint.clear();
    myTickets.forEach(t => ticketByPoint.set(t.pointId, t));
    renderMyTickets();
    reflectJoinButtons();
}

function reflectJoinButtons() {
    document.querySelectorAll('[data-join]').forEach(btn => {
        const pid = Number(btn.dataset.join);
        if (ticketByPoint.has(pid)) {
            btn.disabled = true;
            btn.textContent = 'В очереди';
        } else if (ACTIVE_LIMIT > 0 && myTickets.length >= ACTIVE_LIMIT) {
            btn.disabled = true;
            btn.textContent = `Лимит ${ACTIVE_LIMIT}`;
        } else {
            btn.disabled = false;
            btn.textContent = 'Занять очередь';
        }
    });
}

function renderPoints() {
    elPoints.innerHTML = '';
    points.forEach(p => {
        const row = document.createElement('div');
        row.className = 'point-row';
        row.innerHTML = `
      <div class="point-left">
        <div class="point-title">${p.name}</div>
        <div class="point-sub">${p.sector}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="text-align:right">
          <div class="muted">В очереди</div>
          <div class="badge" id="qcount-${p.id}">${p.queued_count}${p.max_queue > 0 ? ` / ${p.max_queue}` : ''}</div>
        </div>
        <button class="btn primary" data-join="${p.id}">Занять очередь</button>
      </div>`;
        elPoints.appendChild(row);

        const btn = row.querySelector('button[data-join]');
        if (p.max_queue > 0 && p.queued_count >= p.max_queue) {
            btn.disabled = true;
            btn.textContent = 'Очередь заполнена';
        }
        btn.addEventListener('click', () => joinQueue(p.id));
    });
    reflectJoinButtons();
}

function renderMyTickets() {
    elMyQueues.innerHTML = '';
    if (myTickets.length === 0) {
        elEmptyMyQueues.classList.remove('hidden');
        return;
    }
    elEmptyMyQueues.classList.add('hidden');

    myTickets.forEach(t => {
        const card = document.createElement('div');
        card.className = 'my-ticket';
        card.innerHTML = `
      <div style="display:flex;flex-direction:column">
        <div style="font-weight:800">${t.name}</div>
        <div style="display:flex;gap:10px;align-items:center">
          <div class="muted">Очередь</div><div class="badge">${t.position}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <div class="eta">≈ ${t.etaMin} минут</div>
        <button class="btn gray" data-leave="${t.ticketId}">Выйти</button>
      </div>`;
        elMyQueues.appendChild(card);
        card.querySelector('[data-leave]').addEventListener('click', () => leaveQueue(t.ticketId));
    });
}

async function joinQueue(pointId) {
    const btn = document.querySelector(`[data-join="${pointId}"]`);
    if (btn) btn.disabled = true;

    try {
        const res = await fetchJSON(API.join, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID, pointId })
        });

        await loadPoints();
        await loadMyTickets();

        if (res.delayed) {
            showToast(res.message || 'У вас уже есть активный талон. Новый можно будет взять после завершения текущего.');
        } else if (res.alreadyQueued) {
            showToast('Вы уже в этой очереди');
        } else {
            showToast('Талон получен');
        }

    } catch (e) {
        showToast(e.message || 'Ошибка');
    } finally {
        reflectJoinButtons();
    }
}

async function leaveQueue(ticketId) {
    try {
        await fetchJSON(API.leave, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID, ticketId })
        });
        await loadPoints();
        await loadMyTickets();
        showToast('Вы вышли из очереди');
    } catch (e) {
        showToast(e.message || 'Ошибка');
    }
}

function connectSSE() {
    try {
        const es = new EventSource(API.stream);
        es.addEventListener('update', async (ev) => {
            const data = JSON.parse(ev.data);
            const el = document.getElementById(`qcount-${data.pointId}`);
            if (el) {
                const p = points.find(pp => pp.id === data.pointId);
                if (p) {
                    p.queued_count = data.queuedCount;
                    el.textContent = `${data.queuedCount}${p.max_queue > 0 ? ` / ${p.max_queue}` : ''}`;
                    const btn = document.querySelector(`[data-join="${p.id}"]`);
                    if (btn) {
                        if (ticketByPoint.has(p.id)) {
                            btn.disabled = true;
                            btn.textContent = 'В очереди';
                        } else if (p.max_queue > 0 && data.queuedCount >= p.max_queue) {
                            btn.disabled = true;
                            btn.textContent = 'Очередь заполнена';
                        } else if (ACTIVE_LIMIT > 0 && myTickets.length >= ACTIVE_LIMIT) {
                            btn.disabled = true;
                            btn.textContent = `Лимит ${ACTIVE_LIMIT}`;
                        } else {
                            btn.disabled = false;
                            btn.textContent = 'Занять очередь';
                        }
                    }
                }
            }
            await loadMyTickets();
        });
    } catch (e) {
        console.warn('SSE', e);
    }
}

async function init() {
    await loadSettings();
    await loadPoints();
    await loadMyTickets();
    connectSSE();
}
init();
