import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../../store/ThemeContext';
import { Book } from '../../types';
import { BookCover } from '../BookCover';

export function BookRow({ book }: { book: Book }) {
  const { colors } = useAppTheme();

  return (
    <Link href={`/book/${encodeURIComponent(book.id)}`} asChild>
      <Pressable style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <BookCover thumbnailUrl={book.thumbnailUrl} isbn={book.isbn} style={styles.cover} />
        <View style={styles.body}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>
            {book.title}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={2}>
            {book.seriesTitle}
            {book.volumeNumber ? ` / ${book.volumeNumber}巻` : ''}
          </Text>
          {(book.author || book.publisher) && (
            <Text style={[styles.credits, { color: colors.muted }]} numberOfLines={2}>
              {[book.author, book.publisher].filter(Boolean).join(' / ')}
            </Text>
          )}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    padding: 10,
  },
  cover: { backgroundColor: '#e5e5e5', borderRadius: 4, height: 96, width: 66 },
  body: { flex: 1 },
  title: { fontSize: 16, fontWeight: '800', lineHeight: 21 },
  meta: { fontSize: 12, marginTop: 6 },
  credits: { fontSize: 11, lineHeight: 16, marginTop: 4 },
});
