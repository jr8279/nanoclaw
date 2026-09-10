import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { createPasskey } from '../lib/webauthn.js';

export default function TopBar({ user, onSignedOut, onInvite }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  async function signOut() {
    setMenuOpen(false);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    onSignedOut();
  }

  async function addDevice() {
    setMenuOpen(false);
    try {
      const { options, challengeId } = await api('/api/auth/register/options', { method: 'POST', body: JSON.stringify({}) });
      const response = await createPasskey(options);
      await api('/api/auth/register/verify', { method: 'POST', body: JSON.stringify({ challengeId, response }) });
      alert('New passkey added for this device.');
    } catch (err) {
      alert(err.message || 'Could not add a passkey on this device.');
    }
  }

  function invite() {
    setMenuOpen(false);
    onInvite();
  }

  return (
    <header className="topbar">
      <div className="topbar-heading">
        <h1>Todo</h1>
        <span className="today">{today}</span>
      </div>
      <div className="topbar-actions">
        <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenu.Trigger asChild>
            <button id="userMenuBtn" className="btn" aria-haspopup="true">
              {user.display_name}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal forceMount>
            <AnimatePresence>
              {menuOpen && (
                <DropdownMenu.Content asChild align="end" sideOffset={6} forceMount>
                  <motion.div
                    className="user-menu"
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: -4 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                  >
                    <div className="user-menu-name">{user.display_name}</div>
                    <DropdownMenu.Item asChild onSelect={addDevice}>
                      <button className="menu-item">Add a passkey on this device</button>
                    </DropdownMenu.Item>
                    {user.is_admin && (
                      <DropdownMenu.Item asChild onSelect={invite}>
                        <button className="menu-item">Invite someone</button>
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Item asChild onSelect={signOut}>
                      <button className="menu-item">Sign out</button>
                    </DropdownMenu.Item>
                  </motion.div>
                </DropdownMenu.Content>
              )}
            </AnimatePresence>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
