const state = {
  categories: [],
  tasks: [],
  statusFilter: localStorage.getItem('todoStatusFilter') || 'pending',
  categoryFilter: localStorage.getItem('todoCategoryFilter')
    ? Number(localStorage.getItem('todoCategoryFilter'))
    : null,
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
      localStorage.setItem('todoCategoryFilter', state.categoryFilter ?? '');
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
      const overdue = isOverdue(task);
      const classes = [
        'task-card',
        `importance-${task.importance}`,
        task.status === 'completed' ? 'completed' : '',
        overdue ? 'overdue' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const due = fmtDue(task.due_date);
      const links = task.links
        .map((l) => `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label || l.url)}</a>`)
        .join('');
      // Color alone isn't enough to signal importance/overdue (colorblind users,
      // quick scanning) — back it with a text badge too.
      const importanceBadge =
        task.importance === 'urgent'
          ? '<span class="badge urgent">Urgent</span>'
          : task.importance === 'high'
            ? '<span class="badge high">High</span>'
            : '';
      const overdueBadge = overdue ? '<span class="badge overdue">Overdue</span>' : '';
      const checkLabel = task.status === 'completed' ? 'Mark incomplete' : 'Mark complete';
      return `
        <div class="${classes}" data-id="${task.id}">
          <button class="task-check" data-toggle="${task.id}" aria-label="${checkLabel}" aria-pressed="${task.status === 'completed'}"></button>
          <div class="task-body" data-edit="${task.id}">
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-meta">
              ${importanceBadge}
              ${overdueBadge}
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
const formError = document.getElementById('formError');

function showFormError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

function openDialog(id) {
  const task = id ? state.tasks.find((t) => t.id === id) : null;
  showFormError('');
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

const LINK_URL_RE = /^https?:\/\/\S+$/i;

// Only a token that actually looks like a URL is accepted as one — a line
// with no http(s) URL in it is dropped rather than guessed at (the old
// behavior invented a link from whatever word happened to be last).
function parseLinks(text) {
  const links = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const url = parts.find((p) => LINK_URL_RE.test(p));
    if (!url) continue;
    const label = line.replace(url, '').trim() || null;
    links.push({ url, label });
  }
  return links;
}

document.getElementById('addBtn').addEventListener('click', () => openDialog(null));
document.getElementById('cancelBtn').addEventListener('click', () => dialog.close());

document.getElementById('taskForm').addEventListener('submit', async (e) => {
  // Native <form method="dialog"> closes the dialog as part of this same
  // event regardless of what the async save below does — block that so a
  // failed save doesn't look like a silently-discarded task.
  e.preventDefault();
  showFormError('');

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
  if (!payload.title) {
    showFormError('Title is required.');
    return;
  }
  if (payload.recurrence && !payload.due_date) {
    showFormError('A repeating task needs a due date.');
    return;
  }

  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  try {
    if (id) {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
    }
    dialog.close();
    await loadTasks();
  } catch (err) {
    showFormError(err.message || 'Could not save this task. Try again.');
  } finally {
    saveBtn.disabled = false;
  }
});

document.getElementById('deleteBtn').addEventListener('click', async () => {
  const id = document.getElementById('taskId').value;
  if (!id) return;
  try {
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
    dialog.close();
    await loadTasks();
  } catch (err) {
    showFormError(err.message || 'Could not delete this task. Try again.');
  }
});

document.querySelectorAll('[data-status]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.statusFilter = btn.dataset.status;
    localStorage.setItem('todoStatusFilter', state.statusFilter);
    document.querySelectorAll('[data-status]').forEach((b) => b.classList.toggle('active', b === btn));
    loadTasks();
  });
});

document.getElementById('keySave').addEventListener('click', async () => {
  const keyError = document.getElementById('keyError');
  const val = document.getElementById('keyInput').value.trim();
  keyError.hidden = true;
  if (!val) {
    keyError.textContent = 'Enter an API key.';
    keyError.hidden = false;
    return;
  }
  // Validate before committing — an unverified key that turns out to be
  // wrong just reopens the banner with no explanation for why.
  const res = await fetch('/api/categories', { headers: { 'X-API-Key': val } }).catch(() => null);
  if (!res || !res.ok) {
    keyError.textContent = 'That key was rejected by the server.';
    keyError.hidden = false;
    return;
  }
  localStorage.setItem('todoApiKey', val);
  document.getElementById('keyBanner').hidden = true;
  loadCategories().then(loadTasks);
});

// --- init -----------------------------------------------------------------

document.querySelectorAll('[data-status]').forEach((b) => b.classList.toggle('active', b.dataset.status === state.statusFilter));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

loadCategories()
  .then(loadTasks)
  .catch(() => {});
