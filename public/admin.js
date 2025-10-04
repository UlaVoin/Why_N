const API = {
    adminPoints: '/api/points',
    updatePoint: (id) => `/api/points/${id}`,
    settings: '/api/settings'
};

function $qs(sel, root = document) { return root.querySelector(sel); }
function $qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    const txt = await res.text();
    try { return txt ? JSON.parse(txt) : {}; } catch (e) { throw new Error(txt || res.statusText); }
}

async function loadPoints() {
    const cards = document.getElementById('cards');
    cards.innerHTML = '';
    const pts = await fetchJSON(API.adminPoints);
    if (!Array.isArray(pts) || !pts.length) { cards.innerHTML = '<p class="muted">Нет точек</p>'; return; }
    for (const p of pts) {
        const tpl = document.getElementById('card-template');
        const node = tpl.content.cloneNode(true);
        const article = node.querySelector('.card');
        article.dataset.id = p.id;
        $qs('.name', article).textContent = p.name;
        $qs('.sector', article).textContent = p.sector;
        $qs('.desc', article).textContent = p.description || '';
        $qs('.queued', article).textContent = (p.queue_count ?? p.queued_count ?? 0) + ' в очереди';
        $qs('.max', article).textContent = 'max: ' + (p.max_queue ?? 0);

        const btnEdit = node.querySelector('.btn-edit');
        const btnDelete = node.querySelector('.btn-delete');
        btnEdit.addEventListener('click', () => openEditModal(p));
        btnDelete.addEventListener('click', () => confirmDelete(p.id, p.name, article));
        cards.appendChild(node);
    }
}

function confirmDelete(id, name, article) {
    if (!confirm(`Удалить точку "${name}"?`)) return;
    fetch(API.adminPoints + '/' + id, { method: 'DELETE' })
        .then(r => {
            if (!r.ok) throw new Error('Server delete failed');
            article.remove();
        })
        .catch(err => alert('Ошибка удаления: ' + (err.message || err)));
}

function openAddModal() {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
    <div class="modal-sheet">
      <h3>Добавить точку</h3>
      <label>Название <input id="m_name"></label>
      <label>Сектор <input id="m_sector"></label>
      <label>Описание <textarea id="m_desc"></textarea></label>
      <label>Avg sec <input id="m_avg" type="number" value="60"></label>
      <label>Max queue <input id="m_max" type="number" value="0"></label>
      <label><input id="m_active" type="checkbox" checked> Активна</label>
      <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
        <button id="m_cancel" class="btn">Отмена</button>
        <button id="m_save" class="btn primary">Добавить</button>
      </div>
    </div>`;
    root.appendChild(modal);
    $qs('#m_cancel', modal).addEventListener('click', () => modal.remove());
    $qs('#m_save', modal).addEventListener('click', async () => {
        const payload = {
            name: $qs('#m_name', modal).value.trim(),
            sector: $qs('#m_sector', modal).value.trim(),
            description: $qs('#m_desc', modal).value.trim(),
            avg_service_time_sec: Number($qs('#m_avg', modal).value) || 60,
            max_queue: Number($qs('#m_max', modal).value) || 0,
            is_active: $qs('#m_active', modal).checked ? 1 : 0
        };
        try {
            const res = await fetch(API.adminPoints, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!res.ok) throw new Error('Ошибка на сервере');
            modal.remove();
            await loadPoints();
        } catch (err) {
            alert('Ошибка добавления: ' + (err.message || err));
            modal.remove();
            await loadPoints();
        }
    });
}

function openEditModal(point) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
    <div class="modal-sheet">
      <h3>Редактировать ${point.name}</h3>
      <label>Название <input id="e_name" value="${escapeHtml(point.name)}"></label>
      <label>Сектор <input id="e_sector" value="${escapeHtml(point.sector)}"></label>
      <label>Описание <textarea id="e_desc">${escapeHtml(point.description || '')}</textarea></label>
      <label>Avg sec <input id="e_avg" type="number" value="${point.avg_service_sec || point.avg_service_time_sec || 60}"></label>
      <label>Max queue <input id="e_max" type="number" value="${point.max_queue || 0}"></label>
      <label><input id="e_active" type="checkbox" ${point.active || point.is_active ? 'checked' : ''}> Активна</label>
      <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
        <button id="e_cancel" class="btn">Отмена</button>
        <button id="e_save" class="btn primary">Сохранить</button>
      </div>
    </div>`;
    root.appendChild(modal);
    $qs('#e_cancel', modal).addEventListener('click', () => modal.remove());
    $qs('#e_save', modal).addEventListener('click', async () => {
        const payload = {
            name: $qs('#e_name', modal).value.trim(),
            sector: $qs('#e_sector', modal).value.trim(),
            description: $qs('#e_desc', modal).value.trim(),
            avg_service_time_sec: Number($qs('#e_avg', modal).value) || 60,
            max_queue: Number($qs('#e_max', modal).value) || 0,
            is_active: $qs('#e_active', modal).checked ? 1 : 0
        };
        try {
            const res = await fetch(API.updatePoint(point.id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!res.ok) throw new Error('Ошибка на сервере');
            modal.remove();
            await loadPoints();
        } catch (err) {
            alert('Ошибка сохранения: ' + (err.message || err));
        }
    });
}

function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

document.getElementById('btnAdd').addEventListener('click', openAddModal);
window.addEventListener('load', loadPoints);
