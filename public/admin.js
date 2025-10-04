const API = {
  points: '/api/admin/points',
  settingsGet: '/api/settings',
  settingsSet: '/api/settings',
};

async function fetchJSON(url, opts){ const res = await fetch(url, opts); const text = await res.text(); let json; try{ json = text ? JSON.parse(text) : {}; }catch{ json = {error: text || 'Ошибка'} } if(!res.ok){ throw new Error(json.error || res.statusText) } return json; }

async function loadSettings(){ const s = await fetchJSON(API.settingsGet); document.getElementById('activeLimit').value = Number(s.active_limit ?? 0); document.getElementById('slaTarget').value = Number(s.sla_target_min || 10); }
async function saveSettings(){ const payload = { active_limit: Number(document.getElementById('activeLimit').value || 0), sla_target_min: Number(document.getElementById('slaTarget').value || 10) }; await fetchJSON(API.settingsSet, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); alert('Сохранено'); }

async function loadPoints(){ const pts = await fetchJSON(API.points); const container = document.getElementById('pointsTable'); container.innerHTML=''; pts.forEach(p=>{ const el = document.createElement('div'); el.className='card'; el.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="flex:1">
        <div style="font-weight:800">${p.name}</div>
        <div class="muted">${p.sector}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <div class="muted">Avg: ${p.avg_service_time_sec}s</div>
        <div>Макс: <input data-id="${p.id}" data-k="max_queue" type="number" value="${p.max_queue}" min="0" style="width:80px;padding:6px;border-radius:8px;border:1px solid var(--card-border)"></div>
        <button class="btn primary" data-save="${p.id}">Сохранить</button>
      </div>
    </div>`;
    container.appendChild(el);
  });

  container.addEventListener('click', async (e)=>{ const btn = e.target.closest('button[data-save]'); if(!btn) return; const id = Number(btn.dataset.save); const input = container.querySelector(`input[data-id="${id}"]`); const payload = { max_queue: Number(input.value || 0) }; await fetchJSON(`/api/admin/points/${id}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); alert('Точка обновлена'); await loadPoints(); })
}

document.getElementById('saveSettings').addEventListener('click', saveSettings);
document.getElementById('back').addEventListener('click', ()=>{ window.location.href = '/' });

async function init(){ await loadSettings(); await loadPoints(); }
init();