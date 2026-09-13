/**
 * Neural TTS client.
 *
 * Talks to the MeshStage TTS service (see `server/`), which fronts Edge-TTS
 * neural voices with a local espeak-ng fallback. Two things this buys over the
 * browser's own `speechSynthesis`:
 *
 *  1. The same voice on every device. System voices vary wildly between an
 *     iPhone, a Pixel and a desktop, so a character never sounds twice alike.
 *  2. Real audio we control. `speechSynthesis` output cannot be routed into
 *     WebAudio, so it can neither be analysed nor muxed into the video export.
 *     Service audio is a plain buffer, so both become possible.
 */

export type VoiceProvider = 'system' | 'edge' | 'espeak';

export interface NeuralVoice {
  id: string;
  name: string;
  lang: string;
  gender: string;
  provider: VoiceProvider;
  neural: boolean;
}

export interface SpeechMark {
  type: 'word';
  timeMs: number;
  durationMs: number;
  text: string;
}

export interface SynthesisResult {
  provider: VoiceProvider;
  mimeType: string;
  audio: ArrayBuffer;
  durationMs: number;
  marks: SpeechMark[];
}

export function ttsEndpoint(): string | null {
  const base = import.meta.env.VITE_MESHSTAGE_API;
  return base ? base.replace(/\/$/, '') : null;
}

export function isNeuralConfigured(): boolean {
  return ttsEndpoint() !== null;
}

export async function fetchNeuralVoices(signal?: AbortSignal): Promise<NeuralVoice[]> {
  const endpoint = ttsEndpoint();
  if (!endpoint) return [];

  const response = await fetch(`${endpoint}/tts/voices`, { signal });
  if (!response.ok) throw new Error(`Voice catalogue unavailable (${response.status})`);

  const payload = (await response.json()) as { voices?: NeuralVoice[] };
  return payload.voices ?? [];
}

export async function synthesizeSpeech(
  request: { text: string; voiceId: string; provider?: VoiceProvider; rate?: number; pitch?: number },
  signal?: AbortSignal,
): Promise<SynthesisResult> {
  const endpoint = ttsEndpoint();
  if (!endpoint) throw new Error('No TTS service configured (set VITE_MESHSTAGE_API).');

  const response = await fetch(`${endpoint}/tts/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}) as { error?: string });
    throw new Error(detail.error ?? `Synthesis failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    provider: VoiceProvider;
    mimeType: string;
    durationMs: number;
    marks: SpeechMark[];
    audio: string;
  };

  return {
    provider: payload.provider,
    mimeType: payload.mimeType,
    durationMs: payload.durationMs,
    marks: payload.marks ?? [],
    audio: base64ToArrayBuffer(payload.audio),
  };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
