import { useState } from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, Text, View } from 'react-native';

import { useReviewedBookContent } from '../store/BookContentContext';
import { useAppSettings } from '../store/AppSettingsContext';
import { useAppTheme } from '../store/ThemeContext';

type BookCoverProps = {
  thumbnailUrl?: string;
  isbn?: string;
  style?: StyleProp<ImageStyle>;
  missing?: boolean;
  placeholderText?: string;
  preferIsbnCover?: boolean;
};

export function BookCover({
  thumbnailUrl,
  isbn,
  style,
  missing = false,
  placeholderText = 'No Cover',
}: BookCoverProps) {
  const { colors } = useAppTheme();
  const { showBookContent } = useAppSettings();
  const reviewed = useReviewedBookContent(isbn, thumbnailUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageUri = reviewed?.cover_url && reviewed.cover_url !== failedUrl ? reviewed.cover_url : undefined;
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
        onError={() => setFailedUrl(imageUri)}
      />
    );
  }

  return (
    <View style={[coverStyle, styles.coverFallback]}>
      <Text style={[styles.coverFallbackText, { color: colors.muted }]} numberOfLines={2}>
        {!showBookContent ? '非表示' : reviewed ? placeholderText : '未確認'}
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
