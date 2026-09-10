import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import AuthScreen from './components/AuthScreen.jsx';
import TopBar from './components/TopBar.jsx';
import Filters from './components/Filters.jsx';
import TaskList from './components/TaskList.jsx';
import TaskDialog from './components/TaskDialog.jsx';
import InviteDialog from './components/InviteDialog.jsx';
import Fab from './components/Fab.jsx';

function readLocal(key, fallback) {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v;
}

const DEFAULT_STATUS = 'pending';

export default function App() {
  const [authed, setAuthed] = useState(null); // null = checking, false = show auth, true = signed in
  const [currentUser, setCurrentUser] = useState(null);

  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);

  const [statusFilter, setStatusFilter] = useState(() => readLocal('todoStatusFilter', DEFAULT_STATUS));
  const [categoryFilter, setCategoryFilter] = useState(() => {
    const v = readLocal('todoCategoryFilter', '');
    return v ? Number(v) : null;
  });
  const [sortBy, setSortBy] = useState(() => readLocal('todoSortBy', 'due'));
  const [groupBy, setGroupBy] = useState(() => readLocal('todoGroupBy', 'none'));

  const [dialogTask, setDialogTask] = useState(undefined); // undefined = closed, null = new, object = editing
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState(null);

  const handleUnauthorized = useCallback((err) => {
    if (err?.unauthorized) {
      setAuthed(false);
      setCurrentUser(null);
      return true;
    }
    return false;
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (categoryFilter) params.set('category_id', categoryFilter);
      const data = await api(`/api/tasks?${params}`);
      setTasks(data);
    } catch (err) {
      if (!handleUnauthorized(err)) throw err;
    }
  }, [statusFilter, categoryFilter, handleUnauthorized]);

  const boot = useCallback(async () => {
    const me = await fetch('/api/auth/me').then((r) => r.json());
    if (!me.user) {
      setAuthed(false);
      return;
    }
    setCurrentUser(me.user);
    setAuthed(true);
    try {
      const [u, c] = await Promise.all([api('/api/users'), api('/api/categories')]);
      setUsers(u);
      setCategories(c);
    } catch (err) {
      if (!handleUnauthorized(err)) throw err;
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    boot().catch(() => setAuthed(false));
  }, [boot]);

  useEffect(() => {
    if (authed) loadTasks().catch(() => {});
  }, [authed, loadTasks]);

  useEffect(() => {
    localStorage.setItem('todoStatusFilter', statusFilter);
  }, [statusFilter]);
  useEffect(() => {
    localStorage.setItem('todoCategoryFilter', categoryFilter ?? '');
  }, [categoryFilter]);
  useEffect(() => {
    localStorage.setItem('todoSortBy', sortBy);
  }, [sortBy]);
  useEffect(() => {
    localStorage.setItem('todoGroupBy', groupBy);
  }, [groupBy]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  function handleCategoryFilterChange(id) {
    setCategoryFilter(id);
    // "Group by category" only makes sense across categories — a single
    // category view falls back to no grouping.
    if (id !== null && groupBy === 'category') setGroupBy('none');
  }

  function clearFilters() {
    setStatusFilter(DEFAULT_STATUS);
    setCategoryFilter(null);
  }

  async function handleToggle(task) {
    await api(`/api/tasks/${task.id}/${task.status === 'completed' ? 'reopen' : 'complete'}`, { method: 'POST' });
    await loadTasks();
  }

  async function handleInvite() {
    try {
      const { token } = await api('/api/invites', { method: 'POST', body: JSON.stringify({}) });
      setInviteLink(`${location.origin}/?invite=${token}`);
      setInviteOpen(true);
    } catch (err) {
      alert(err.message || 'Could not create an invite.');
    }
  }

  if (authed === null) return null;
  if (!authed) return <AuthScreen onAuthed={boot} />;

  const hasActiveFilters = statusFilter !== DEFAULT_STATUS || categoryFilter !== null;

  return (
    <div id="app">
      <TopBar user={currentUser} onSignedOut={() => setAuthed(false)} onInvite={handleInvite} />

      <Filters
        categories={categories}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={handleCategoryFilterChange}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
      />

      <TaskList
        tasks={tasks}
        categories={categories}
        users={users}
        currentUser={currentUser}
        sortBy={sortBy}
        groupBy={groupBy}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        onToggle={handleToggle}
        onEdit={(id) => setDialogTask(tasks.find((t) => t.id === id) || null)}
      />

      <Fab onClick={() => setDialogTask(null)} />

      <TaskDialog
        open={dialogTask !== undefined}
        task={dialogTask || null}
        categories={categories}
        users={users}
        currentUser={currentUser}
        onClose={() => setDialogTask(undefined)}
        onSaved={() => {
          setDialogTask(undefined);
          loadTasks();
        }}
        onDeleted={() => {
          setDialogTask(undefined);
          loadTasks();
        }}
      />

      <InviteDialog open={inviteOpen} link={inviteLink} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
