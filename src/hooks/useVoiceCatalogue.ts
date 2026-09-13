import { useEffect, useMemo, useState } from 'react';
import { fetchNeuralVoices, isNeuralConfigured, type VoiceProvider } from '../lib/tts';

export interface VoiceOption {
  /** `speechSynthesis` voiceURI, or the service's voice id. */
  id: string;
  name: string;
  lang: string;
  provider: VoiceProvider;
  neural: boolean;
}

export interface VoiceGroup {
  key: string;
  label: string;
  voices: VoiceOption[];
}

export interface VoiceCatalogue {
  groups: VoiceGroup[];
  count: number;
  ready: boolean;
  /** Non-fatal note, e.g. the neural service being unreachable. */
  notice: string | null;
}

/**
 * A hard cap on how many voices reach the <select>.
 *
 * This is not hypothetical tidiness: a Linux box with espeak-ng installed
 * reports **13,363** voices to Chromium, because every base voice is multiplied
 * by ~100 named variants. Rendering that many <option> nodes locks up a phone.
 * Real devices report 20-150, so this cap is invisible in practice and a
 * guardrail in the pathological case.
 */
const MAX_VOICES = 180;
const MAX_PER_LANGUAGE = 12;

const LANGUAGE_NAMES =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

function languageLabel(lang: string): string {
  try {
    return LANGUAGE_NAMES?.of(lang.split('-')[0]) ?? lang;
  } catch {
    return lang;
  }
}

/**
 * Collapses engine variant spam to a base identity.
 * "Afrikaans+Alicia espeak-ng" and "Afrikaans+Adam espeak-ng" are the same
 * underlying voice wearing different names.
 */
function baseIdentity(name: string, lang: string): string {
  const base = name
    .replace(/\+.*$/, '')
    .replace(/\b(espeak-ng|espeak|festival|default)\b/gi, '')
    .trim()
    .toLowerCase();
  return `${lang.toLowerCase()}|${base || name.toLowerCase()}`;
}

export function useVoiceCatalogue(): VoiceCatalogue {
  const [systemVoices, setSystemVoices] = useState<VoiceOption[]>([]);
  const [neuralVoices, setNeuralVoices] = useState<VoiceOption[]>([]);
  const [systemReady, setSystemReady] = useState(false);
  const [neuralReady, setNeuralReady] = useState(!isNeuralConfigured());
  const [notice, setNotice] = useState<string | null>(null);

  // ---- System voices -------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSystemReady(true);
      return;
    }

    let attempts = 0;
    let pollId = 0;

    const read = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length > 0) {
        setSystemVoices(
          list.map((voice) => ({
            id: voice.voiceURI,
            name: voice.name,
            lang: voice.lang,
            provider: 'system' as const,
            // `localService: false` means a cloud voice, which is the closest
            // signal the Web Speech API gives us for "neural".
            neural: !voice.localService,
          })),
        );
        setSystemReady(true);
        window.clearInterval(pollId);
      } else if (attempts > 12) {
        setSystemReady(true);
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

  // ---- Neural voices from the service --------------------------------------
  useEffect(() => {
    if (!isNeuralConfigured()) return;

    const controller = new AbortController();

    fetchNeuralVoices(controller.signal)
      .then((voices) => {
        setNeuralVoices(
          voices.map((voice) => ({
            id: voice.id,
            name: voice.name,
            lang: voice.lang,
            provider: voice.provider,
            neural: voice.neural,
          })),
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // Losing the service is survivable — system voices still work.
        setNotice(
          error instanceof Error
            ? `Neural voices unavailable: ${error.message}`
            : 'Neural voices unavailable.',
        );
      })
      .finally(() => setNeuralReady(true));

    return () => controller.abort();
  }, []);

  const groups = useMemo<VoiceGroup[]>(() => {
    const deviceLang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
    const devicePrefix = deviceLang.split('-')[0];

    // Neural first: when both exist for a language, the service voice is the
    // one that sounds the same on every device.
    const merged = [...neuralVoices, ...systemVoices];

    const seen = new Set<string>();
    const deduped: VoiceOption[] = [];
    for (const voice of merged) {
      const key = baseIdentity(voice.name, voice.lang);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(voice);
    }

    const rank = (lang: string) =>
      lang === deviceLang ? 0 : lang.startsWith(devicePrefix) ? 1 : lang.startsWith('en') ? 2 : 3;

    const byLang = new Map<string, VoiceOption[]>();
    for (const voice of deduped) {
      const key = voice.lang || 'unknown';
      const bucket = byLang.get(key);
      if (bucket) bucket.push(voice);
      else byLang.set(key, [voice]);
    }

    let budget = MAX_VOICES;

    return [...byLang.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([lang, list]) => {
        // Spend only what this language actually uses. Decrementing by the
        // per-language allowance instead starves later groups: with 131
        // single-voice espeak languages it cut the list off after 15.
        const take = Math.min(MAX_PER_LANGUAGE, list.length, Math.max(0, budget));
        budget -= take;
        return {
          key: lang,
          label: `${languageLabel(lang)} (${lang})`,
          voices: list
            // Neural voices to the top of every language group.
            .sort((a, b) => Number(b.neural) - Number(a.neural) || a.name.localeCompare(b.name))
            .slice(0, take),
        };
      })
      .filter((group) => group.voices.length > 0);
  }, [systemVoices, neuralVoices]);

  return {
    groups,
    count: groups.reduce((sum, group) => sum + group.voices.length, 0),
    ready: systemReady && neuralReady,
    notice,
  };
}
