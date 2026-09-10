import { useEffect, useRef, useState } from 'react';
import AnimatedDialog from './AnimatedDialog.jsx';

export default function InviteDialog({ open, link, onClose }) {
  const inputRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !link || !inputRef.current) return;
    // Fix: the token tail was showing instead of the domain on open because
    // the cursor landed at the end of the value by default. Reset selection
    // and scroll position to the start so the readable part (the domain) is
    // what's visible.
    const el = inputRef.current;
    el.setSelectionRange(0, 0);
    el.scrollLeft = 0;
    setCopied(false);
  }, [open, link]);

  async function copy() {
    const el = inputRef.current;
    if (!el) return;
    el.select();
    try {
      await navigator.clipboard.writeText(el.value);
      setCopied(true);
    } catch {
      document.execCommand('copy');
    }
  }

  return (
    <AnimatedDialog open={open} onOpenChange={(o) => !o && onClose()} title="Invite someone">
      <p className="dialog-help">Share this link — it works once and expires in 3 days.</p>
      <div className="invite-link-row">
        <input ref={inputRef} readOnly value={link || ''} />
        <button className="btn" type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="dialog-actions">
        <button className="btn primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </AnimatedDialog>
  );
}
