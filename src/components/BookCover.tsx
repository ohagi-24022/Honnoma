import { useState } from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, Text, View } from 'react-native';

import { PENDING_BOOK_COVER_URL } from '../lib/reviewedBookContent';

import { useBookContentLookupState, useReviewedBookContent } from '../store/BookContentContext';
import { useAppSettings } from '../store/AppSettingsContext';
import { useAppTheme } from '../store/ThemeContext';

type BookCoverProps = {
  thumbnailUrl?: string;
  isbn?: string;
  style?: StyleProp<ImageStyle>;
  missing?: boolean;
  placeholderText?: string;
  preferIsbnCover?: boolean;
  /** Only personal screens may display the selected source cover before review. */
  displayContext?: 'reviewed' | 'personal';
};

export function BookCover({
  thumbnailUrl,
  isbn,
  style,
  missing = false,
  placeholderText = 'No Cover',
  displayContext = 'reviewed',
}: BookCoverProps) {
  const { colors } = useAppTheme();
  const { showBookContent } = useAppSettings();
  const reviewed = useReviewedBookContent(isbn, thumbnailUrl);
  const lookupState = useBookContentLookupState();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const approvedImageUri = reviewed?.cover_url && reviewed.cover_url !== failedUrl ? reviewed.cover_url : undefined;
  // Public screens retain the reviewed-only default. A user's private screens
  // may show the source cover, without granting public approval.
  const personalCoverUrl = displayContext === 'personal' && showBookContent
    && /^https:\/\//i.test(thumbnailUrl?.trim() ?? '') ? thumbnailUrl!.trim() : undefined;
  const personalImageUri = !reviewed?.cover_url && personalCoverUrl !== failedUrl ? personalCoverUrl : undefined;
  const pending = showBookContent && !reviewed && !personalCoverUrl && lookupState === 'ready';
  const imageUri = approvedImageUri ?? personalImageUri
    ?? (pending && failedUrl !== PENDING_BOOK_COVER_URL ? PENDING_BOOK_COVER_URL : undefined);
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
        accessibilityLabel={pending ? '表紙を確認中' : '本の表紙'}
        onError={() => setFailedUrl(imageUri)}
      />
    );
  }

  return (
    <View style={[coverStyle, styles.coverFallback]}>
      <Text style={[styles.coverFallbackText, { color: colors.muted }]} numberOfLines={2}>
        {!showBookContent ? '非表示'
          : lookupState === 'error' || (!!failedUrl && (failedUrl === reviewed?.cover_url || failedUrl === personalCoverUrl || failedUrl === PENDING_BOOK_COVER_URL)) ? '表紙を取得できません'
          : !reviewed && lookupState === 'loading' ? '表紙を取得中'
          : reviewed ? placeholderText : '未確認'}
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
