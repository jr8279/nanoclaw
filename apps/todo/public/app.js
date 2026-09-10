const state = {
  categories: [],
  tasks: [],
  statusFilter: 'pending',
  categoryFilter: null,
};

function apiKey() {
  return localStorage.getItem('todoApiKey') || '';
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const key = apiKey();
  if (key) headers['X-API-Key'] = key;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    document.getElementById('keyBanner').hidden = false;
    throw new Error('unauthorized');
  }
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

function categoryById(id) {
  return state.categories.find((c) => c.id === id);
}

function fmtDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function isOverdue(task) {
  return task.status === 'pending' && task.due_date && new Date(task.due_date) < new Date();
}

async function loadCategories() {
  state.categories = await api('/api/categories');
  renderCategoryChips();
  const select = document.getElementById('fCategory');
  select.innerHTML = '<option value="">No category</option>' +
    state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function renderCategoryChips() {
  const row = document.getElementById('categoryChips');
  const all = `<button class="chip ${state.categoryFilter === null ? 'active' : ''}" data-cat="">All</button>`;
  const chips = state.categories
    .map(
      (c) =>
        `<button class="chip ${state.categoryFilter === c.id ? 'active' : ''}" data-cat="${c.id}" style="border-color:${c.color}">${escapeHtml(c.name)}</button>`,
    )
    .join('');
  row.innerHTML = all + chips;
  row.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.categoryFilter = btn.dataset.cat ? Number(btn.dataset.cat) : null;
      renderCategoryChips();
      loadTasks();
    });
  });
}

async function loadTasks() {
  const params = new URLSearchParams();
  if (state.statusFilter !== 'all') params.set('status', state.statusFilter);
  if (state.categoryFilter) params.set('category_id', state.categoryFilter);
  state.tasks = await api(`/api/tasks?${params}`);
  renderTasks();
}

function renderTasks() {
  const list = document.getElementById('taskList');
  if (!state.tasks.length) {
    list.innerHTML = '<div class="empty">Nothing here. Add a task to get started.</div>';
    return;
  }
  list.innerHTML = state.tasks
    .map((task) => {
      const cat = categoryById(task.category_id);
      const classes = [
        'task-card',
        `importance-${task.importance}`,
        task.status === 'completed' ? 'completed' : '',
        isOverdue(task) ? 'overdue' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const due = fmtDue(task.due_date);
      const links = task.links
        .map((l) => `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label || l.url)}</a>`)
        .join('');
      return `
        <div class="${classes}" data-id="${task.id}">
          <button class="task-check" data-toggle="${task.id}" aria-label="toggle"></button>
          <div class="task-body" data-edit="${task.id}">
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-meta">
              ${cat ? `<span class="cat" style="background:${cat.color}22;color:${cat.color}">${escapeHtml(cat.name)}</span>` : ''}
              ${due ? `<span class="due">${task.recurrence ? '↻ ' : ''}Due ${due}</span>` : task.recurrence ? '<span>↻ recurring</span>' : ''}
            </div>
            ${task.notes ? `<div class="task-notes">${escapeHtml(task.notes)}</div>` : ''}
            ${links ? `<div class="task-links">${links}</div>` : ''}
          </div>
        </div>`;
    })
    .join('');

  list.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.toggle;
      const task = state.tasks.find((t) => t.id === Number(id));
      await api(`/api/tasks/${id}/${task.status === 'completed' ? 'reopen' : 'complete'}`, { method: 'POST' });
      await loadTasks();
    });
  });
  list.querySelectorAll('[data-edit]').forEach((el) => {
    el.addEventListener('click', () => openDialog(Number(el.dataset.edit)));
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

// --- dialog -------------------------------------------------------------

const dialog = document.getElementById('taskDialog');

function openDialog(id) {
  const task = id ? state.tasks.find((t) => t.id === id) : null;
  document.getElementById('dialogTitle').textContent = task ? 'Edit task' : 'New task';
  document.getElementById('taskId').value = task ? task.id : '';
  document.getElementById('fTitle').value = task ? task.title : '';
  document.getElementById('fNotes').value = task ? task.notes || '' : '';
  document.getElementById('fCategory').value = task?.category_id || '';
  document.getElementById('fImportance').value = task ? task.importance : 'medium';
  document.getElementById('fDue').value = task?.due_date ? toLocalInput(task.due_date) : '';
  document.getElementById('fFreq').value = task?.recurrence?.freq || '';
  document.getElementById('fLinks').value = task ? task.links.map((l) => `${l.label || ''} ${l.url}`.trim()).join('\n') : '';
  document.getElementById('deleteBtn').hidden = !task;
  dialog.showModal();
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLinks(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const url = parts.find((p) => /^https?:\/\//.test(p)) || parts[parts.length - 1];
      const label = line.replace(url, '').trim() || null;
      return { url, label };
    })
    .filter((l) => l.url);
}

document.getElementById('addBtn').addEventListener('click', () => openDialog(null));
document.getElementById('cancelBtn').addEventListener('click', () => dialog.close());

document.getElementById('taskForm').addEventListener('submit', async (e) => {
  const id = document.getElementById('taskId').value;
  const payload = {
    title: document.getElementById('fTitle').value.trim(),
    notes: document.getElementById('fNotes').value.trim() || null,
    category_id: document.getElementById('fCategory').value ? Number(document.getElementById('fCategory').value) : null,
    importance: document.getElementById('fImportance').value,
    due_date: document.getElementById('fDue').value ? new Date(document.getElementById('fDue').value).toISOString() : null,
    recurrence: document.getElementById('fFreq').value ? { freq: document.getElementById('fFreq').value, interval: 1 } : null,
    links: parseLinks(document.getElementById('fLinks').value),
  };
  if (!payload.title) return;

  if (id) {
    await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  } else {
    await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
  }
  dialog.close();
  await loadTasks();
});

document.getElementById('deleteBtn').addEventListener('click', async () => {
  const id = document.getElementById('taskId').value;
  if (!id) return;
  await api(`/api/tasks/${id}`, { method: 'DELETE' });
  dialog.close();
  await loadTasks();
});

document.querySelectorAll('[data-status]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.statusFilter = btn.dataset.status;
    document.querySelectorAll('[data-status]').forEach((b) => b.classList.toggle('active', b === btn));
    loadTasks();
  });
});

document.getElementById('keySave').addEventListener('click', () => {
  const val = document.getElementById('keyInput').value.trim();
  if (val) localStorage.setItem('todoApiKey', val);
  document.getElementById('keyBanner').hidden = true;
  loadCategories().then(loadTasks);
});

// --- init -----------------------------------------------------------------

document.querySelector('[data-status="pending"]').classList.add('active');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

loadCategories()
  .then(loadTasks)
  .catch(() => {});
