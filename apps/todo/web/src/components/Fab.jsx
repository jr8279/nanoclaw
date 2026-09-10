import { motion } from 'framer-motion';

export default function Fab({ onClick }) {
  return (
    <motion.button
      className="fab"
      aria-label="Add task"
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
    >
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </motion.button>
  );
}
