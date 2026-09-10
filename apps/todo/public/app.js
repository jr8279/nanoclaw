const state = {
  currentUser: null,
  categories: [],
  users: [],
  tasks: [],
  statusFilter: localStorage.getItem('todoStatusFilter') || 'pending',
  categoryFilter: localStorage.getItem('todoCategoryFilter')
    ? Number(localStorage.getItem('todoCategoryFilter'))
    : null,
  selectedAssigneeIds: new Set(),
};

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    await showAuthScreen();
    throw new Error('signed out');
  }
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

function categoryById(id) {
  return state.categories.find((c) => c.id === id);
}
function userById(id) {
  return state.users.find((u) => u.id === id);
}

function fmtDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function isOverdue(task) {
  return task.status === 'pending' && task.due_date && new Date(task.due_date) < new Date();
}

// --- data loading -----------------------------------------------------

async function loadCategories() {
  state.categories = await api('/api/categories');
  renderCategoryChips();
  const select = document.getElementById('fCategory');
  select.innerHTML = '<option value="">No category</option>' +
    state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

async function loadUsers() {
  state.users = await api('/api/users');
  renderAssigneePicker();
}

function renderCategoryChips() {
  const row = document.getElementById('categoryChips');
  const all = `<button class="tab ${state.categoryFilter === null ? 'active' : ''}" data-cat="">All</button>`;
  const tabs = state.categories
    .map(
      (c) =>
        `<button class="tab ${state.categoryFilter === c.id ? 'active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)}</button>`,
    )
    .join('');
  row.innerHTML = all + tabs;
  row.querySelectorAll('.tab').forEach((btn) => {
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
      const classes = ['task-row', task.status === 'completed' ? 'completed' : ''].filter(Boolean).join(' ');
      const due = fmtDue(task.due_date);
      const links = task.links
        .map((l) => `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label || l.url)}</a>`)
        .join('');
      // Importance/overdue are signaled by both color and a plain-language
      // word (not color alone) so they still read for colorblind users and
      // at a glance.
      const importanceFlag =
        task.importance === 'urgent'
          ? '<span class="flag urgent">Urgent</span>'
          : task.importance === 'high'
            ? '<span class="flag high">High</span>'
            : '';
      const overdueFlag = overdue ? '<span class="flag urgent">Overdue</span>' : '';
      // The "Overdue" flag already carries the urgency signal, so the due
      // date itself stays plain rather than doubling up the red accent.
      const dueMeta = due ? `<span class="due">Due ${due}</span>` : '';
      const recurMeta = due && task.recurrence ? '<span class="recur">Repeats</span>' : '';
      // Someone else's task assigned to me, or a task I own that's tagged
      // to others — both are worth surfacing since this is a shared board.
      const owner = task.owner_user_id != null ? userById(task.owner_user_id) : null;
      const fromMeta =
        owner && state.currentUser && owner.id !== state.currentUser.id
          ? `<span class="from">${escapeHtml(owner.display_name)}</span>`
          : '';
      const otherAssignees = task.assignees.filter((a) => !state.currentUser || a.id !== state.currentUser.id);
      const taggedMeta = otherAssignees.length
        ? `<span class="tagged">${otherAssignees.map((a) => escapeHtml(a.display_name)).join(', ')}</span>`
        : '';
      const checkLabel = task.status === 'completed' ? 'Mark incomplete' : 'Mark complete';
      return `
        <div class="${classes}" data-id="${task.id}">
          ${cat ? `<span class="tab-swatch" style="background:${cat.color}"></span>` : ''}
          <button class="check" data-toggle="${task.id}" aria-label="${checkLabel}" aria-pressed="${task.status === 'completed'}">
            <span class="check-box"><svg viewBox="0 0 13 13"><path d="M2 6.5l3 3.2 6-7" /></svg></span>
          </button>
          <div class="task-body" data-edit="${task.id}">
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-meta">
              ${importanceFlag}
              ${overdueFlag}
              ${dueMeta}
              ${recurMeta}
              ${fromMeta}
              ${taggedMeta}
              ${cat ? `<span class="category-name">${escapeHtml(cat.name)}</span>` : ''}
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
      const completing = task.status !== 'completed';
      // The one deliberate motion in this design: the check draws itself in
      // rather than just appearing, so it's visible during the (usually
      // brief) round trip instead of only after the list re-renders.
      if (completing) btn.classList.add('drawing');
      await api(`/api/tasks/${id}/${task.status === 'completed' ? 'reopen' : 'complete'}`, { method: 'POST' });
      await loadTasks();
    });
  });
  list.querySelectorAll('[data-edit]').forEach((el) => {
    el.addEventListener('click', () => openDialog(Number(el.dataset.edit)));
  });
}

// --- assignee picker (task dialog) -----------------------------------------

function renderAssigneePicker() {
  const box = document.getElementById('fAssignees');
  const others = state.users.filter((u) => !state.currentUser || u.id !== state.currentUser.id);
  if (!others.length) {
    box.innerHTML = '<span class="empty-note">No one else has an account yet.</span>';
    return;
  }
  box.innerHTML = others
    .map(
      (u) =>
        `<button type="button" class="assignee-pill ${state.selectedAssigneeIds.has(u.id) ? 'active' : ''}" data-user="${u.id}">${escapeHtml(u.display_name)}</button>`,
    )
    .join('');
  box.querySelectorAll('.assignee-pill').forEach((btn) => {
    // Toggle the class in place rather than calling renderAssigneePicker()
    // again — replacing a button's own DOM node from inside its own click
    // handler is fragile (Chromium/Playwright can retry a click whose
    // target got swapped out mid-dispatch, double-firing the toggle).
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.user);
      if (state.selectedAssigneeIds.has(id)) {
        state.selectedAssigneeIds.delete(id);
        btn.classList.remove('active');
      } else {
        state.selectedAssigneeIds.add(id);
        btn.classList.add('active');
      }
    });
  });
}

// --- task dialog -------------------------------------------------------

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
  state.selectedAssigneeIds = new Set(task ? task.assignees.map((a) => a.id) : []);
  renderAssigneePicker();
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
    assignee_ids: [...state.selectedAssigneeIds],
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

// --- user menu + invites ------------------------------------------------

const userMenu = document.getElementById('userMenu');
const userMenuBtn = document.getElementById('userMenuBtn');

function closeUserMenu() {
  userMenu.hidden = true;
  userMenuBtn.setAttribute('aria-expanded', 'false');
}

userMenuBtn.addEventListener('click', () => {
  const willOpen = userMenu.hidden;
  userMenu.hidden = !willOpen;
  userMenuBtn.setAttribute('aria-expanded', String(willOpen));
});
document.addEventListener('click', (e) => {
  if (!userMenu.hidden && !userMenu.contains(e.target) && e.target !== userMenuBtn) closeUserMenu();
});

document.getElementById('signOutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  closeUserMenu();
  await showAuthScreen();
});

document.getElementById('addDeviceBtn').addEventListener('click', async () => {
  closeUserMenu();
  try {
    const { options, challengeId } = await api('/api/auth/register/options', { method: 'POST', body: JSON.stringify({}) });
    const response = await createPasskey(options);
    await api('/api/auth/register/verify', { method: 'POST', body: JSON.stringify({ challengeId, response }) });
    alert('New passkey added for this device.');
  } catch (err) {
    alert(err.message || 'Could not add a passkey on this device.');
  }
});

const inviteDialog = document.getElementById('inviteDialog');
document.getElementById('inviteBtn').addEventListener('click', async () => {
  closeUserMenu();
  try {
    const { token } = await api('/api/invites', { method: 'POST', body: JSON.stringify({}) });
    const link = `${location.origin}/?invite=${token}`;
    document.getElementById('inviteLinkOutput').value = link;
    inviteDialog.showModal();
  } catch (err) {
    alert(err.message || 'Could not create an invite.');
  }
});
document.getElementById('inviteCopyBtn').addEventListener('click', async () => {
  const input = document.getElementById('inviteLinkOutput');
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    document.execCommand('copy');
  }
});
document.getElementById('inviteCloseBtn').addEventListener('click', () => inviteDialog.close());

// --- auth screen: bootstrap / invite redemption / login -------------------

const authScreen = document.getElementById('authScreen');
const authBody = document.getElementById('authBody');
const authErrorEl = document.getElementById('authError');
const appRoot = document.getElementById('app');

function showAuthError(message) {
  authErrorEl.textContent = message;
  authErrorEl.hidden = !message;
}

function renderLoginView({ canRegisterHint } = {}) {
  authBody.innerHTML = `
    <p class="lead">Sign in with the passkey on this device.</p>
    <button id="loginBtn" class="btn primary" type="button">Sign in</button>
    ${canRegisterHint ? '<p class="lead" style="margin-top:16px">Have an invite link? Open it directly to create an account.</p>' : ''}
  `;
  document.getElementById('loginBtn').addEventListener('click', async () => {
    showAuthError('');
    try {
      const { options, challengeId } = await api('/api/auth/login/options', { method: 'POST', body: JSON.stringify({}) });
      const response = await getPasskey(options);
      await api('/api/auth/login/verify', { method: 'POST', body: JSON.stringify({ challengeId, response }) });
      await boot();
    } catch (err) {
      showAuthError(err.message || 'Sign-in failed. Try again.');
    }
  });
}

function renderNameEntryView({ heading, lead, onSubmit }) {
  authBody.innerHTML = `
    <p class="lead">${lead}</p>
    <label>Your name
      <input id="authName" maxlength="60" placeholder="${escapeAttr(heading)}" />
    </label>
    <button id="authSubmitBtn" class="btn primary" type="button">Create passkey</button>
  `;
  document.getElementById('authSubmitBtn').addEventListener('click', async () => {
    const name = document.getElementById('authName').value.trim();
    if (!name) return showAuthError('Enter your name.');
    showAuthError('');
    try {
      await onSubmit(name);
    } catch (err) {
      showAuthError(err.message || 'Could not create your passkey. Try again.');
    }
  });
}

function renderBootstrapView() {
  renderNameEntryView({
    heading: 'e.g. Ryan',
    lead: "No account exists yet — you'll be the first, and become the admin.",
    onSubmit: async (name) => {
      const { options, challengeId } = await api('/api/auth/register/options', {
        method: 'POST',
        body: JSON.stringify({ displayName: name }),
      });
      const response = await createPasskey(options);
      await api('/api/auth/register/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, response, bootstrap: true }),
      });
      history.replaceState(null, '', '/');
      await boot();
    },
  });
}

function renderInviteView(inviteToken) {
  renderNameEntryView({
    heading: 'Your name',
    lead: "You've been invited to this household's todo board.",
    onSubmit: async (name) => {
      const { options, challengeId } = await api('/api/auth/register/options', {
        method: 'POST',
        body: JSON.stringify({ displayName: name, inviteToken }),
      });
      const response = await createPasskey(options);
      await api('/api/auth/register/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, response, inviteToken }),
      });
      history.replaceState(null, '', '/');
      await boot();
    },
  });
}

/** Show the sign-in/register screen and hide the app. Resolves once rendered. */
async function showAuthScreen() {
  appRoot.hidden = true;
  authScreen.hidden = false;
  showAuthError('');

  const params = new URLSearchParams(location.search);
  const inviteToken = params.get('invite');

  if (inviteToken) {
    const res = await fetch(`/api/invites/${encodeURIComponent(inviteToken)}`);
    if (res.ok) return renderInviteView(inviteToken);
    showAuthError('That invite link is invalid, used, or expired.');
    return renderLoginView();
  }

  const me = await fetch('/api/auth/me').then((r) => r.json());
  if (me.bootstrap_available) return renderBootstrapView();
  renderLoginView({ canRegisterHint: true });
}

// --- boot -----------------------------------------------------------------

async function boot() {
  const me = await fetch('/api/auth/me').then((r) => r.json());
  if (!me.user) {
    await showAuthScreen();
    return;
  }
  state.currentUser = me.user;
  authScreen.hidden = true;
  appRoot.hidden = false;

  document.getElementById('userMenuBtn').textContent = me.user.display_name;
  document.getElementById('userMenuName').textContent = me.user.display_name;
  document.getElementById('inviteBtn').hidden = !me.user.is_admin;

  document.getElementById('todayLabel').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  document
    .querySelectorAll('[data-status]')
    .forEach((b) => b.classList.toggle('active', b.dataset.status === state.statusFilter));

  await loadUsers();
  await loadCategories();
  await loadTasks();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot().catch(() => showAuthScreen());
