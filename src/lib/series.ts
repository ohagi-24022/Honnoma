const VOLUME_PATTERNS = [
  /(?:^|[\s:：\-–—])(?:第\s*)?([0-9]{1,3})\s*(?:巻(?:目)?|volume|vol\.?|#)(?=$|[\s(（【「『〈<])/i,
  /(?:第\s*)?([0-9]{1,3})\s*(?:巻(?:目)?)(?=$|[\s(（【「『〈<])/i,
  /(?:^|[\s:：\-–—])(?:第\s*|volume\s*|vol\.?\s*|#\s*)([0-9]{1,3})(?=$|[\s(（【「『〈<])/i,
  /(?:\(|（|【|「|『|〈|<)\s*(?:第\s*)?([0-9]{1,3})\s*(?:巻)?\s*(?:\)|）|】|」|』|〉|>)/,
  /([0-9]{1,3})\s*(?=[(（【「『〈<])/,
  /(?:^|[\s:：\-–—])([0-9]{1,3})\s*(?=[(（【「『〈<])/,
  /(?:^|[\s:：\-–—])([0-9]{1,3})\s+(?=\S)/,
  /(?:^|[\s:：\-–—])([0-9]{1,3})$/,
];

const EDITION_SUFFIX_PATTERN =
  /(?:モノクロ版|カラー版|デジタル版|電子版|ジャンプコミックスDIGITAL|ジャンプコミックス|コミックス?|漫画|マンガ|文庫版?|新装版|完全版|愛蔵版|特装版|限定版)\s*$/i;


function hasJapaneseText(value: string) {
  return /[぀-ヿ㐀-鿿]/.test(value);
}

function parseAliasedSeriesTitle(normalized: string) {
  const parts = normalized
    .split(/[=＝]/g)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const preferredSeriesTitle = parts.find(hasJapaneseText) ?? parts[0];
  const trailingVolume = parts
    .map((part) => part.match(/(?:^|[^0-9])([0-9]{1,3})\s*$/)?.[1])
    .find((value): value is string => !!value);

  return {
    seriesTitle: preferredSeriesTitle,
    volumeNumber: trailingVolume ? Number.parseInt(trailingVolume, 10) : undefined,
  };
}

export function parseSeriesTitle(title: string) {
  const normalized = title.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const aliasedTitle = parseAliasedSeriesTitle(normalized);
  let volumeNumber = aliasedTitle?.volumeNumber;
  let seriesTitle = aliasedTitle?.seriesTitle ?? normalized;

  for (const pattern of VOLUME_PATTERNS) {
    if (volumeNumber) break;
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;

    volumeNumber = Number.parseInt(match[1], 10);
    const beforeVolume = normalized.slice(0, match.index).trim();
    const afterVolume = normalized.slice((match.index ?? 0) + match[0].length).trim();
    seriesTitle = beforeVolume || afterVolume || normalized.replace(match[0], '').trim();
    break;
  }

  seriesTitle = seriesTitle
    .replace(/[(（【「『〈<].*?[)）】」』〉>]\s*$/g, '')
    .replace(/(?:第\s*)?[0-9]{1,3}\s*巻(?:目)?$/, '')
    .replace(/[0-9]{1,3}\s*$/, '')
    .replace(/[\[(（【]\s*(?:第\s*)?[0-9]{1,3}\s*(?:巻)?\s*[\]）)】]/g, '')
    .replace(EDITION_SUFFIX_PATTERN, '')
    .replace(/\s+[-–—]\s+.*$/, '')
    .replace(/[,:：\-–—]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    seriesTitle: seriesTitle || normalized,
    volumeNumber: Number.isFinite(volumeNumber) ? volumeNumber : undefined,
  };
}

export function normalizeSeriesKey(seriesTitle: string) {
  return parseSeriesTitle(seriesTitle).seriesTitle
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(EDITION_SUFFIX_PATTERN, '')
    .replace(/[\s・･:：\-–—_'"“”‘’()[\]{}「」『』【】〈〉《》!?！？。.．]/g, '')
    .trim();
}

export function getMissingVolumes(volumes: number[]) {
  const unique = [...new Set(volumes.filter((volume) => Number.isInteger(volume)))].sort(
    (a, b) => a - b,
  );

  if (unique.length === 0) return [];

  const missing: number[] = [];
  for (let volume = 1; volume <= unique[unique.length - 1]; volume += 1) {
    if (!unique.includes(volume)) missing.push(volume);
  }

  return missing;
}
