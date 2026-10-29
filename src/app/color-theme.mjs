// One appearance preference shared by the desktop shell and its home frame.
// Model credentials and experiment data do not belong to this store.
export const COLOR_THEME_KEY = 'kx-color-theme-v1';
const HOME_SETTINGS_KEY = 'kx-home-settings-v1';
export const isColorTheme = value => value === 'light' || value === 'dark';
export function getColorThemeStorage(host = globalThis) {
  try { return host.localStorage; } catch { return null; }
}

export function readColorTheme(storage) {
  try {
    const theme = storage.getItem(COLOR_THEME_KEY);
    if (isColorTheme(theme)) return theme;
    const previous = JSON.parse(storage.getItem(HOME_SETTINGS_KEY) || 'null');
    if (typeof previous?.dark === 'boolean') return previous.dark ? 'dark' : 'light';
  } catch { /* Unavailable or damaged preferences must not prevent startup. */ }
  return 'light';
}

export function saveColorTheme(storage, theme) {
  if (!isColorTheme(theme)) return false;
  try {
    storage.setItem(COLOR_THEME_KEY, theme);
    return true;
  } catch { return false; }
}

export function applyColorTheme(root, theme) {
  if (isColorTheme(theme)) root.dataset.colorTheme = theme;
}
