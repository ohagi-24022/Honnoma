export function toHiragana(value: string) {
  return value.replace(/[\u30a1-\u30fa\u30fd-\u30ff]/g, (character) => {
    const code = character.charCodeAt(0);
    if (code >= 0x30a1 && code <= 0x30f6) return String.fromCharCode(code - 0x60);
    if (code === 0x30f7) return `\u308f${String.fromCharCode(0x3099)}`;
    if (code === 0x30f8) return `\u3090${String.fromCharCode(0x3099)}`;
    if (code === 0x30f9) return `\u3091${String.fromCharCode(0x3099)}`;
    if (code === 0x30fa) return `\u3092${String.fromCharCode(0x3099)}`;
    if (code === 0x30fd || code === 0x30fe) return String.fromCharCode(code - 0x60);
    return character;
  });
}

export function normalizeKanaReading(value?: string | null) {
  const normalized = value?.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!normalized || /[\u3400-\u9fff]/.test(normalized)) return undefined;
  return toHiragana(normalized).normalize('NFKC');
}

export function normalizeKanaReadingForSort(value?: string | null) {
  const normalized = normalizeKanaReading(value);
  if (!normalized) return '';
  return normalized
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u30fc\u2010-\u2015\u2212\uff0d-\uff70]/g, '')
    .replace(/[\s!-/:-@[-`{-~\u3000-\u303f\uff01-\uff65]+/g, '')
    .normalize('NFKC');
}
