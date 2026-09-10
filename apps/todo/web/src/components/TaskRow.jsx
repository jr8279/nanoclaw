import { useState } from 'react';
import { motion } from 'framer-motion';
import { fmtDue, isOverdue } from '../lib/tasks.js';

export default function TaskRow({ task, category, owner, currentUser, onToggle, onEdit }) {
  const [drawing, setDrawing] = useState(false);
  const overdue = isOverdue(task);
  const due = fmtDue(task.due_date);
  const completing = task.status !== 'completed';
  const checkLabel = task.status === 'completed' ? 'Mark incomplete' : 'Mark complete';

  const fromMeta = owner && currentUser && owner.id !== currentUser.id ? owner.display_name : null;
  const otherAssignees = (task.assignees || []).filter((a) => !currentUser || a.id !== currentUser.id);

  async function handleToggle(e) {
    e.stopPropagation();
    // The one deliberate motion in this design: the check draws itself in
    // rather than just appearing, so it's visible during the (usually
    // brief) round trip instead of only after the list re-renders.
    if (completing) setDrawing(true);
    try {
      await onToggle(task);
    } finally {
      setDrawing(false);
    }
  }

  return (
    <motion.div
      className={`task-row ${task.status === 'completed' ? 'completed' : ''}`}
      data-id={task.id}
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: 'spring', stiffness: 480, damping: 40 }}
    >
      {category && <span className="tab-swatch" style={{ background: category.color }} />}
      <button
        className={`check ${drawing ? 'drawing' : ''}`}
        aria-label={checkLabel}
        aria-pressed={task.status === 'completed'}
        onClick={handleToggle}
      >
        <span className="check-box">
          <svg viewBox="0 0 13 13">
            <path d="M2 6.5l3 3.2 6-7" />
          </svg>
        </span>
      </button>
      <div className="task-body" onClick={() => onEdit(task.id)}>
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {task.importance === 'urgent' && <span className="flag urgent">Urgent</span>}
          {task.importance === 'high' && <span className="flag high">High</span>}
          {overdue && <span className="flag urgent">Overdue</span>}
          {due && <span className="due">Due {due}</span>}
          {due && task.recurrence && <span className="recur">Repeats</span>}
          {fromMeta && <span className="from">{fromMeta}</span>}
          {otherAssignees.length > 0 && (
            <span className="tagged">{otherAssignees.map((a) => a.display_name).join(', ')}</span>
          )}
          {category && <span className="category-name">{category.name}</span>}
        </div>
        {task.notes && <div className="task-notes">{task.notes}</div>}
        {task.links && task.links.length > 0 && (
          <div className="task-links">
            {task.links.map((l) => (
              <a key={l.id ?? l.url} href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label || l.url}
              </a>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
