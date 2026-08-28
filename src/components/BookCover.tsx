import { useEffect, useMemo, useState } from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, Text, View } from 'react-native';

import { getKnownIsbnCoverOverride } from '../lib/knownBookOverrides';
import { useAppTheme } from '../store/ThemeContext';

type BookCoverProps = {
  thumbnailUrl?: string;
  isbn?: string;
  style?: StyleProp<ImageStyle>;
  missing?: boolean;
  placeholderText?: string;
  preferIsbnCover?: boolean;
};

function normalizeImageUrl(url?: string) {
  if (!url) return undefined;
  return url.replace(/^http:\/\//i, 'https://');
}

function normalizeIsbn(isbn?: string) {
  return isbn?.replace(/[^0-9X]/gi, '').toUpperCase();
}

function isGeneratedGoogleIsbnCoverUrl(url?: string) {
  return !!url && /books\.google\.[^/]+\/books\/content/i.test(url) && /[?&]vid=ISBN/i.test(url);
}

function isKnownUnavailableCoverUrl(url?: string) {
  return !!url && /imagenotavailable|no[_-]?image|noimage/i.test(url);
}

function buildOpenLibraryCoverUrl(isbn?: string) {
  const normalized = normalizeIsbn(isbn);
  if (!normalized) return undefined;
  return `https://covers.openlibrary.org/b/isbn/${normalized}-L.jpg?default=false`;
}

function buildRakutenCoverUrl(isbn?: string) {
  const normalized = normalizeIsbn(isbn);
  if (!normalized || !/^[0-9]{13}$/.test(normalized)) return undefined;
  const folder = normalized.slice(-4);
  return `https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/${folder}/${normalized}.jpg?_ex=300x300`;
}

function uniqueUrls(urls: Array<string | undefined>) {
  return [...new Set(urls.filter((url): url is string => !!url))];
}

export function BookCover({
  thumbnailUrl,
  isbn,
  style,
  missing = false,
  placeholderText = 'No Cover',
  preferIsbnCover = false,
}: BookCoverProps) {
  const { colors } = useAppTheme();
  const candidates = useMemo(
    () => {
      const normalizedThumbnail =
        isGeneratedGoogleIsbnCoverUrl(thumbnailUrl) || isKnownUnavailableCoverUrl(thumbnailUrl)
          ? undefined
          : normalizeImageUrl(thumbnailUrl);
      const knownCoverOverride = getKnownIsbnCoverOverride(isbn);
      const isbnCandidates = [buildRakutenCoverUrl(isbn), buildOpenLibraryCoverUrl(isbn)];
      if (knownCoverOverride) {
        return uniqueUrls([knownCoverOverride, normalizedThumbnail, ...isbnCandidates]);
      }
      return uniqueUrls(
        preferIsbnCover
          ? [...isbnCandidates, normalizedThumbnail]
          : [normalizedThumbnail, ...isbnCandidates],
      );
    },
    [isbn, preferIsbnCover, thumbnailUrl],
  );
  const candidateKey = candidates.join('|');
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidateKey]);

  const imageUri = candidates[candidateIndex];
  const coverStyle = [
    styles.cover,
    { backgroundColor: colors.elevated },
    style,
    missing && styles.missingCover,
  ];

  if (imageUri) {
    return (
      <Image
        key={imageUri}
        source={{ uri: imageUri }}
        style={coverStyle}
        resizeMode="cover"
        onError={() => setCandidateIndex((current) => Math.min(current + 1, candidates.length))}
      />
    );
  }

  return (
    <View style={[coverStyle, styles.coverFallback]}>
      <Text style={[styles.coverFallbackText, { color: colors.muted }]} numberOfLines={2}>
        {placeholderText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    overflow: 'hidden',
  },
  missingCover: { opacity: 0.35 },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverFallbackText: {
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 4,
    textAlign: 'center',
  },
});
