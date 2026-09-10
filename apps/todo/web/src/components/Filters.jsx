import { motion } from 'framer-motion';

const STATUS_TABS = [
  { key: 'pending', label: 'Open' },
  { key: 'completed', label: 'Done' },
  { key: 'all', label: 'All' },
];

export default function Filters({
  categories,
  categoryFilter,
  onCategoryFilterChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortByChange,
  groupBy,
  onGroupByChange,
}) {
  const inSingleCategory = categoryFilter !== null;

  return (
    <nav className="filters">
      <div className="tab-row" id="categoryChips">
        <motion.button
          type="button"
          className={`category-filter ${categoryFilter === null ? 'active' : ''}`}
          whileTap={{ scale: 0.93 }}
          transition={{ type: 'spring', stiffness: 500, damping: 24 }}
          onClick={() => onCategoryFilterChange(null)}
        >
          All
        </motion.button>
        {categories.map((c) => (
          <motion.button
            key={c.id}
            type="button"
            className={`category-filter ${categoryFilter === c.id ? 'active' : ''}`}
            style={{ '--dot': c.color }}
            whileTap={{ scale: 0.93 }}
            transition={{ type: 'spring', stiffness: 500, damping: 24 }}
            onClick={() => onCategoryFilterChange(c.id)}
          >
            <span className="dot" />
            {c.name}
          </motion.button>
        ))}
      </div>
      <div className="status-row">
        <div className="status-tabs">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`status-tab ${statusFilter === t.key ? 'active' : ''}`}
              onClick={() => onStatusFilterChange(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="list-controls">
          <div className="control-select">
            <span className="control-label">Sort</span>
            <select aria-label="Sort tasks" value={sortBy} onChange={(e) => onSortByChange(e.target.value)}>
              <option value="due">Due date</option>
              <option value="priority">Priority</option>
              <option value="title">Title (A–Z)</option>
              <option value="created">Recently added</option>
            </select>
          </div>
          <div className="control-select" id="groupControl">
            <span className="control-label">Group</span>
            <select aria-label="Group tasks" value={groupBy} onChange={(e) => onGroupByChange(e.target.value)}>
              <option value="none">None</option>
              {/* "Group by category" only makes sense across categories — a
                  single category view doesn't offer it. */}
              {!inSingleCategory && <option value="category">Category</option>}
              <option value="priority">Priority</option>
            </select>
          </div>
        </div>
      </div>
    </nav>
  );
}
