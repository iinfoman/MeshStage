import { useEffect, useMemo, useState } from 'react';

export interface VoiceOption {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

export interface VoiceGroup {
  lang: string;
  label: string;
  voices: VoiceOption[];
}

const LANGUAGE_NAMES =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

function languageLabel(lang: string): string {
  try {
    return LANGUAGE_NAMES?.of(lang) ?? lang;
  } catch {
    return lang;
  }
}

/**
 * Voice catalogue for the stage-3 selector.
 *
 * `getVoices()` is asynchronous on Chrome and returns an empty array on the
 * first call, so we listen for `voiceschanged` and also poll briefly — some
 * Android WebViews never fire the event at all.
 */
export function useSpeechVoices(): { voices: VoiceOption[]; groups: VoiceGroup[]; ready: boolean } {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setReady(true);
      return;
    }

    let attempts = 0;
    let pollId = 0;

    const read = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length > 0) {
        setVoices(
          list.map((voice) => ({
            voiceURI: voice.voiceURI,
            name: voice.name,
            lang: voice.lang,
            localService: voice.localService,
          })),
        );
        setReady(true);
        window.clearInterval(pollId);
      } else if (attempts > 12) {
        // ~3s with no voices: the device has no TTS engine installed.
        setReady(true);
        window.clearInterval(pollId);
      }
      attempts += 1;
    };

    read();
    window.speechSynthesis.addEventListener('voiceschanged', read);
    pollId = window.setInterval(read, 250);

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', read);
      window.clearInterval(pollId);
    };
  }, []);

  const groups = useMemo<VoiceGroup[]>(() => {
    const byLang = new Map<string, VoiceOption[]>();

    for (const voice of voices) {
      const key = voice.lang || 'unknown';
      const bucket = byLang.get(key);
      if (bucket) bucket.push(voice);
      else byLang.set(key, [voice]);
    }

    return [...byLang.entries()]
      .map(([lang, list]) => ({
        lang,
        label: `${languageLabel(lang.split('-')[0])} (${lang})`,
        // Neural/premium voices sort first — they are what users want to hear.
        voices: list.sort((a, b) => Number(a.localService) - Number(b.localService)),
      }))
      .sort((a, b) => {
        // Surface the device locale, then English, then everything else.
        const device = navigator.language;
        const rank = (lang: string) =>
          lang === device ? 0 : lang.startsWith(device.split('-')[0]) ? 1 : lang.startsWith('en') ? 2 : 3;
        return rank(a.lang) - rank(b.lang) || a.lang.localeCompare(b.lang);
      });
  }, [voices]);

  return { voices, groups, ready };
}
