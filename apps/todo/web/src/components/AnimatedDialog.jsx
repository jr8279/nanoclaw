import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 34 } },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.12 } },
};

/** Shared animated-dialog shell (overlay + centered, spring-in content) used
 * by both the task dialog and the invite dialog. Radix owns focus trap /
 * escape / outside-dismiss; framer-motion owns the open/close choreography
 * via forceMount + AnimatePresence, which Radix's own <dialog> couldn't do
 * (a flat, instant popup) without a CSS @starting-style fallback. */
export default function AnimatedDialog({ open, onOpenChange, title, labelledBy, children, ...contentProps }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="dialog-overlay"
                variants={overlayVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              />
            </Dialog.Overlay>
            <div className="dialog-center">
              <Dialog.Content
                asChild
                aria-describedby={undefined}
                onOpenAutoFocus={contentProps.onOpenAutoFocus}
              >
                <motion.div
                  className="dialog-content"
                  variants={contentVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {title && <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>}
                  {children}
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
