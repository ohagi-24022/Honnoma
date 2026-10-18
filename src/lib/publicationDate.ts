/** Preserve the precision supplied by the book provider; never invent a day. */
export function formatPublicationDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  const text = value.normalize('NFKC').trim();
  const period = text.match(/^(\d{4})年(\d{1,2})月(上旬|中旬|下旬)$/);
  if (period) {
    const month = Number(period[2]);
    return Number(period[1]) > 0 && month >= 1 && month <= 12
      ? `${Number(period[1])}年${month}月${period[3]}` : undefined;
  }
  const approximate = text.endsWith('頃');
  let normalized = text.replace(/頃$/, '').replace(/[年月/]/g, '-').replace(/日$/, '').replace(/-$/, '');
  if (/^\d{8}$/.test(normalized)) normalized = `${normalized.slice(0,4)}-${normalized.slice(4,6)}-${normalized.slice(6,8)}`;
  if (/^\d{6}$/.test(normalized)) normalized = `${normalized.slice(0,4)}-${normalized.slice(4,6)}`;
  const match = normalized.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
  if (!match || Number(match[1]) === 0) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (match[2] && (month < 1 || month > 12)) return undefined;
  if (match[3]) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if (day < 1 || day > days[month-1]) return undefined;
  }
  return `${year}年${match[2]?`${month}月`:''}${match[3]?`${day}日`:''}${approximate?'頃':''}`;
}
