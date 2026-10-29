import test from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_THEME_KEY, getColorThemeStorage, readColorTheme, saveColorTheme } from '../src/app/color-theme.mjs';

function storage(values = {}) {
  const data = new Map(Object.entries(values));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test('fresh installation defaults to light without writing a choice', () => {
  const store = storage();
  assert.equal(readColorTheme(store), 'light');
  assert.equal(store.getItem(COLOR_THEME_KEY), null);
  assert.equal(readColorTheme(storage({ 'kx-home-settings-v1': '{"quality":"performance"}' })), 'light');
});

test('either existing home preference migrates without overwriting motion or quality', () => {
  for (const dark of [false, true]) {
    const expected = dark ? 'dark' : 'light';
    const saved = JSON.stringify({ dark, reduced: true, quality: 'performance' });
    const store = storage({ 'kx-home-settings-v1': saved });
    assert.equal(readColorTheme(store), expected);
    assert.equal(saveColorTheme(store, expected), true);
    assert.equal(readColorTheme(store), expected);
    assert.equal(store.getItem('kx-home-settings-v1'), saved);
  }
});

test('global theme takes precedence over older home state and persists either choice', () => {
  const store = storage({ [COLOR_THEME_KEY]: 'light', 'kx-home-settings-v1': '{"dark":true}' });
  assert.equal(readColorTheme(store), 'light');
  saveColorTheme(store, 'dark');
  assert.equal(readColorTheme(store), 'dark');
  assert.equal(saveColorTheme(store, 'anything'), false);
  assert.equal(readColorTheme(store), 'dark');
});

test('malformed or unavailable preferences do not block manual experiments', () => {
  for (const value of ['{', 'null', '[]', '{"dark":"false"}']) {
    assert.equal(readColorTheme(storage({ [COLOR_THEME_KEY]: 'bad', 'kx-home-settings-v1': value })), 'light');
  }
  const blocked = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); } };
  assert.equal(readColorTheme(blocked), 'light');
  assert.equal(saveColorTheme(blocked, 'light'), false);
  const denied = { get localStorage() { throw new Error('access denied'); } };
  assert.equal(readColorTheme(getColorThemeStorage(denied)), 'light');
  assert.equal(saveColorTheme(getColorThemeStorage(denied), 'light'), false);
});
