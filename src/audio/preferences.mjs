export const AUDIO_PREFERENCES_KEY = 'kx-audio-preferences-v1';
export const DEFAULT_AUDIO_PREFERENCES = Object.freeze({
  enabled: true, sound: true, music: true, typing: true,
  soundVolume: 0.35, musicVolume: 0.22,
});
export const AUDIO_STATUS_LABELS = Object.freeze({
  idle: '声音准备中', loading: '正在载入本地配乐', playing: '背景配乐循环播放中',
  muted: '声音已关闭', waiting: '点击界面后启用声音', unavailable: '配乐暂不可用，其他功能可继续使用',
  ready: '交互音效已启用',
});
const booleans = new Set(['enabled', 'sound', 'music', 'typing']);
const volumes = new Set(['soundVolume', 'musicVolume']);
export const SOUNDS = Object.freeze(['page-open', 'page-close', 'ui-tick', 'text-reveal', 'key', 'tick', 'column', 'open', 'confirm', 'back', 'scan', 'array', 'inspect', 'explode', 'assemble']);
export const isSound = value => typeof value === 'string' && SOUNDS.includes(value);
export function isAudioPreferencePatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(key => booleans.has(key)
    ? typeof value[key] === 'boolean'
    : volumes.has(key) && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1);
}
export function readAudioPreferences(storage) {
  const result = { ...DEFAULT_AUDIO_PREFERENCES };
  try {
    const value = JSON.parse(storage?.getItem(AUDIO_PREFERENCES_KEY) || 'null');
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of Object.keys(result)) if (Object.hasOwn(value, key) && isAudioPreferencePatch({ [key]: value[key] })) result[key] = value[key];
    }
  } catch { /* Missing, damaged or unavailable storage uses safe defaults. */ }
  return result;
}
export function saveAudioPreferences(storage, preferences) {
  if (!isAudioPreferencePatch(preferences)) return false;
  try { storage.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(preferences)); return true; }
  catch { return false; }
}
