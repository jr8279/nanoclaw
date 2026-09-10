import '@testing-library/jest-dom/vitest';

// jsdom has no real <dialog>/WebAuthn support, but Radix's Dialog doesn't
// use the native <dialog> element at all (it builds its own portal +
// focus-trap), so nothing needs stubbing there. window.matchMedia is used
// by the color-scheme media query in CSS only (no JS reads it), so no stub
// needed either.
