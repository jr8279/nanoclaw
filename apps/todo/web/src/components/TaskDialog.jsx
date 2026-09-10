import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { parseLinks, toLocalInput } from '../lib/tasks.js';
import AnimatedDialog from './AnimatedDialog.jsx';

const emptyForm = {
  title: '',
  notes: '',
  category_id: '',
  importance: 'medium',
  due: '',
  freq: '',
  linksText: '',
};

function taskToForm(task) {
  return {
    title: task.title,
    notes: task.notes || '',
    category_id: task.category_id != null ? String(task.category_id) : '',
    importance: task.importance,
    due: task.due_date ? toLocalInput(task.due_date) : '',
    freq: task.recurrence?.freq || '',
    linksText: task.links.map((l) => `${l.label || ''} ${l.url}`.trim()).join('\n'),
  };
}

export default function TaskDialog({ open, task, categories, users, currentUser, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(emptyForm);
  const [assigneeIds, setAssigneeIds] = useState(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(task ? taskToForm(task) : emptyForm);
    setAssigneeIds(new Set(task ? task.assignees.map((a) => a.id) : []));
  }, [open, task]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleAssignee(id) {
    setAssigneeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const title = form.title.trim();
    const payload = {
      title,
      notes: form.notes.trim() || null,
      category_id: form.category_id ? Number(form.category_id) : null,
      importance: form.importance,
      due_date: form.due ? new Date(form.due).toISOString() : null,
      recurrence: form.freq ? { freq: form.freq, interval: 1 } : null,
      links: parseLinks(form.linksText),
      assignee_ids: [...assigneeIds],
    };
    if (!title) {
      setError('Title is required.');
      return;
    }
    if (payload.recurrence && !payload.due_date) {
      setError('A repeating task needs a due date.');
      return;
    }

    setSaving(true);
    try {
      if (task) {
        await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'Could not save this task. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    setError('');
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      setError(err.message || 'Could not delete this task. Try again.');
    }
  }

  const others = users.filter((u) => !currentUser || u.id !== currentUser.id);

  return (
    <AnimatedDialog open={open} onOpenChange={(o) => !o && onClose()} title={task ? 'Edit task' : 'New task'}>
      <form onSubmit={handleSubmit}>
        <label>
          Title
          <input required maxLength={200} value={form.title} onChange={(e) => set('title', e.target.value)} />
        </label>

        <label>
          Notes
          <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>

        <div className="row">
          <label>
            Category
            <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Importance
            <select value={form.importance} onChange={(e) => set('importance', e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>

        {/* Fix: this used to split 50/50, clipping the Repeats select's
            visible text ("Never" rendering as "Nev"). Due date now gets
            more flex-basis and the row stacks under narrow width. */}
        <div className="row due-repeat">
          <label className="due">
            Due date
            <input type="datetime-local" value={form.due} onChange={(e) => set('due', e.target.value)} />
          </label>
          <label className="repeat">
            Repeats
            <select value={form.freq} onChange={(e) => set('freq', e.target.value)}>
              <option value="">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
        </div>

        <label>
          Links (one per line, &quot;label https://url&quot;)
          <textarea
            rows={2}
            placeholder="School portal https://example.com"
            value={form.linksText}
            onChange={(e) => set('linksText', e.target.value)}
          />
        </label>

        {/* Not a <label> wrapping the buttons — <button> is a "labelable"
            element, so a wrapping <label> would give every assignee pill
            the *label's* text as its accessible name instead of the
            person's own name. A plain caption + role="group" keeps each
            pill's own name while still announcing the field's purpose. */}
        <div className="field">
          <span className="field-label">Tag someone (puts it on their board too)</span>
          <div className="assignee-picker" role="group" aria-label="Tag someone (puts it on their board too)">
            {others.length === 0 ? (
              <span className="empty-note">No one else has an account yet.</span>
            ) : (
              others.map((u) => (
                <motion.button
                  key={u.id}
                  type="button"
                  className={`assignee-pill ${assigneeIds.has(u.id) ? 'active' : ''}`}
                  whileTap={{ scale: 0.94 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                  onClick={() => toggleAssignee(u.id)}
                >
                  {u.display_name}
                </motion.button>
              ))
            )}
          </div>
        </div>

        <p className="form-error" hidden={!error}>{error}</p>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {task && (
            <button type="button" className="btn danger" onClick={handleDelete}>
              Delete
            </button>
          )}
          <button type="submit" className="btn primary" disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </AnimatedDialog>
  );
}
