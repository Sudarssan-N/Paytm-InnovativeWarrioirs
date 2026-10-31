// Global 2D/3D avatar mode — a device-wide preference, not per-component
// state, so every mounted avatar (chat header, call, companion, presenter)
// switches together the instant it's changed in Settings.
const MODE_STORAGE = 'mitra_avatar_mode';
export const AVATAR_MODES = ['3d', '2d'];
export const DEFAULT_AVATAR_MODE = '2d';

export function getAvatarMode() {
  try {
    const value = localStorage.getItem(MODE_STORAGE);
    return AVATAR_MODES.includes(value) ? value : DEFAULT_AVATAR_MODE;
  } catch {
    return DEFAULT_AVATAR_MODE;
  }
}

export function setAvatarMode(mode) {
  if (!AVATAR_MODES.includes(mode)) return;
  try { localStorage.setItem(MODE_STORAGE, mode); } catch { /* session choice still works */ }
  window.dispatchEvent(new CustomEvent('mitra-avatar-mode', { detail: mode }));
}
