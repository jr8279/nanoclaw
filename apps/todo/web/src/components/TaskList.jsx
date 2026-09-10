import { AnimatePresence } from 'framer-motion';
import { groupTasks, sortTasks } from '../lib/tasks.js';
import TaskRow from './TaskRow.jsx';

function categoryById(categories, id) {
  return categories.find((c) => c.id === id);
}
function userById(users, id) {
  return users.find((u) => u.id === id);
}

export default function TaskList({
  tasks,
  categories,
  users,
  currentUser,
  sortBy,
  groupBy,
  hasActiveFilters,
  onClearFilters,
  onToggle,
  onEdit,
}) {
  if (!tasks.length) {
    return (
      <main id="taskList">
        <div className="empty">
          {hasActiveFilters ? (
            <>
              No tasks match these filters.
              <br />
              <button type="button" className="empty-clear" onClick={onClearFilters}>
                Clear filters
              </button>
            </>
          ) : (
            'Nothing here. Add a task to get started.'
          )}
        </div>
      </main>
    );
  }

  const sorted = sortTasks(tasks, sortBy);
  const groups = groupTasks(sorted, groupBy, categories);

  function renderRow(task) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        category={categoryById(categories, task.category_id)}
        owner={task.owner_user_id != null ? userById(users, task.owner_user_id) : null}
        currentUser={currentUser}
        onToggle={onToggle}
        onEdit={onEdit}
      />
    );
  }

  return (
    <main id="taskList">
      {groups
        ? groups.map((g) => (
            <div className="task-group" key={g.key}>
              <div className="task-group-heading">
                {g.dot && <span className="dot" style={{ '--dot': g.dot }} />}
                {g.label}
              </div>
              <div className="task-list">
                <AnimatePresence initial={false}>{g.tasks.map(renderRow)}</AnimatePresence>
              </div>
            </div>
          ))
        : (
          <div className="task-list">
            <AnimatePresence initial={false}>{sorted.map(renderRow)}</AnimatePresence>
          </div>
        )}
    </main>
  );
}
