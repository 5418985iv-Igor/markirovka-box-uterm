export interface ParsedDataMatrix {
  rawCode: string;
  gtin: string;
  serial: string;
  cryptoTail: string;
  isChestnyZnak: boolean;
}

const GS = String.fromCharCode(29);

/**
 * Parses a GS1 Data Matrix code (Честный ЗНАК) or generic item QR/barcode.
 * Handles FNC1 / ASCII 29 (GS) group separators as well as stripped separators.
 */
export function parseDataMatrix(input: string): ParsedDataMatrix {
  const rawCode = input.trim();
  if (!rawCode) {
    return {
      rawCode: '',
      gtin: '',
      serial: '',
      cryptoTail: '',
      isChestnyZnak: false,
    };
  }

  // Normalize common text representations of GS separator while preserving rawCode
  const normalized = rawCode
    .replace(/<GS>|\\u001d|\x1d/gi, GS)
    .replace(/^\u001d+/, '');

  let gtin = '';
  let serial = '';
  let cryptoTail = '';
  let isChestnyZnak = false;

  // Match GS1 AI 01 (14 digits) + AI 21 (serial)
  if (normalized.startsWith('01') && normalized.length >= 16) {
    const candidateGtin = normalized.slice(2, 16);
    if (/^\d{14}$/.test(candidateGtin)) {
      gtin = candidateGtin;
      const rest = normalized.slice(16);

      if (rest.startsWith('21')) {
        isChestnyZnak = true;
        const after21 = rest.slice(2);
        const gsParts = after21.split(GS);
        serial = gsParts[0] || '';

        if (gsParts.length > 1) {
          cryptoTail = gsParts.slice(1).join(GS);
        } else {
          // Fallback if GS was stripped by a keyboard-emulating scanner
          const cryptoMatch = after21.match(/^(.*?)(91[A-Za-z0-9+/=]{4,}|92[A-Za-z0-9+/=]{4,}|93[A-Za-z0-9+/=]{4,})$/);
          if (cryptoMatch) {
            serial = cryptoMatch[1];
            cryptoTail = cryptoMatch[2];
          }
        }
      }
    }
  }

  return {
    rawCode: rawCode.slice(0, 512),
    gtin: gtin.slice(0, 32),
    serial: serial.slice(0, 128),
    cryptoTail: cryptoTail.slice(0, 128),
    isChestnyZnak,
  };
}

/**
 * Extracts a clean human-readable box number from a scanned Box QR code.
 * Supports plain codes (BOX-0042), GS1 SSCC (00...), URLs, or JSON objects.
 */
export function parseBoxQrCode(input: string): { boxCode: string; boxNumber: string } {
  const boxCode = input.trim().slice(0, 256);
  if (!boxCode) {
    return { boxCode: '', boxNumber: '' };
  }

  // Try JSON format e.g. {"box":"BOX-102"} or {"number":"102"}
  if (boxCode.startsWith('{') && boxCode.endsWith('}')) {
    try {
      const parsed = JSON.parse(boxCode) as Record<string, unknown>;
      const candidate =
        parsed.boxNumber ?? parsed.box ?? parsed.number ?? parsed.id ?? parsed.code;
      if (typeof candidate === 'string' && candidate.trim()) {
        return { boxCode, boxNumber: candidate.trim().slice(0, 128) };
      }
    } catch {
      // Fall through to standard parsing
    }
  }

  // Try URL format e.g. https://warehouse.local/boxes/BOX-2026-01
  if (/^https?:\/\//i.test(boxCode)) {
    try {
      const url = new URL(boxCode);
      const paramBox =
        url.searchParams.get('box') ||
        url.searchParams.get('id') ||
        url.searchParams.get('number');
      if (paramBox) {
        return { boxCode, boxNumber: paramBox.trim().slice(0, 128) };
      }
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        return {
          boxCode,
          boxNumber: decodeURIComponent(segments[segments.length - 1]).slice(0, 128),
        };
      }
    } catch {
      // Fall through
    }
  }

  // GS1 SSCC-18 (AI 00 + 18 digits)
  const cleanGs = boxCode.replace(/^\u001d+/, '');
  if (cleanGs.startsWith('00') && /^\d{20}$/.test(cleanGs)) {
    return { boxCode, boxNumber: cleanGs.slice(2) };
  }

  return { boxCode, boxNumber: boxCode.slice(0, 128) };
}

/**
 * Formats invisible GS control chars (ASCII 29) for legible UI display.
 */
export function formatCodeForDisplay(rawCode: string): string {
  return rawCode.replace(/\x1d/g, '␝');
}

/**
 * Produces a deterministic, Firestore-safe ID (hex SHA-256 prefix) from any string.
 */
export async function hashCodeToId(value: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(value);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray
      .slice(0, 20)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Deterministic FNV-1a fallback if subtle crypto is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `id_${(h1 >>> 0).toString(16)}_${(h2 >>> 0).toString(16)}`;
}

/**
 * Generates a Firestore-safe random ID matching ^[a-zA-Z0-9_-]+$
 */
export function generateSafeId(prefix = 'box'): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`;
}

/**
 * Plays a short industrial warehouse beep + haptic pulse on scan.
 */
export function playScanFeedback(type: 'success' | 'duplicate' | 'error'): void {
  if (typeof window === 'undefined') return;

  try {
    if ('vibrate' in navigator) {
      if (type === 'success') {
        navigator.vibrate(45);
      } else if (type === 'duplicate') {
        navigator.vibrate([40, 50, 40]);
      } else {
        navigator.vibrate([80, 40, 80]);
      }
    }
  } catch {
    // Ignore vibration errors
  }

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, now);
      osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.13);
    } else if (type === 'duplicate') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.19);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.23);
    }
  } catch {
    // Ignore Web Audio errors on restricted autoplay browsers
  }
}

export function formatTimestampRu(
  ts?: { seconds: number; nanoseconds: number } | null
): string {
  if (!ts || typeof ts.seconds !== 'number') return 'сейчас';
  const date = new Date(ts.seconds * 1000);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTimeOnlyRu(
  ts?: { seconds: number; nanoseconds: number } | null
): string {
  if (!ts || typeof ts.seconds !== 'number') return 'сейчас';
  const date = new Date(ts.seconds * 1000);
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}
