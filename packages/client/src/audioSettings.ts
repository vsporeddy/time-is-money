export interface AudioSettings {
  musicEnabled: boolean;
  sfxEnabled: boolean;
}

const STORAGE_KEY = 'time-is-money:audio-settings';

const DEFAULT_SETTINGS: AudioSettings = {
  musicEnabled: true,
  sfxEnabled: true,
};

export function loadAudioSettings(): AudioSettings {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(saved) as Partial<AudioSettings>;
    return {
      musicEnabled:
        typeof parsed.musicEnabled === 'boolean'
          ? parsed.musicEnabled
          : DEFAULT_SETTINGS.musicEnabled,
      sfxEnabled:
        typeof parsed.sfxEnabled === 'boolean'
          ? parsed.sfxEnabled
          : DEFAULT_SETTINGS.sfxEnabled,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveAudioSettings(settings: AudioSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Audio controls should still work when storage is unavailable.
  }
}
