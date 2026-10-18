import { Pressable, StyleSheet, Text, View } from 'react-native';
import { bookFormatOptions, BookFormatFilter } from '../lib/bookFormat';
import { useAppTheme } from '../store/ThemeContext';

type Props = { value: BookFormatFilter; onChange: (value: BookFormatFilter) => void; includeAll?: boolean; disabled?: boolean; label: string };
export function BookFormatControl({ value, onChange, includeAll = false, disabled = false, label }: Props) {
  const { colors } = useAppTheme();
  const options = includeAll ? [{ value: 'all' as const, label: 'すべて' }, ...bookFormatOptions] : bookFormatOptions;
  return <View style={styles.wrap}>
    <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
    <View style={styles.row}>
      {options.map(option => <Pressable key={option.value} accessibilityRole="radio"
        accessibilityLabel={`${label}：${option.label}`} accessibilityState={{ checked: value === option.value, disabled }}
        disabled={disabled} onPress={() => onChange(option.value)}
        style={[styles.option, { borderColor: value === option.value ? colors.primary : colors.border,
          backgroundColor: value === option.value ? colors.elevated : colors.surface }, disabled && { opacity: 0.5 }]}>
        <Text style={[styles.text, { color: value === option.value ? colors.primary : colors.text }]}>{option.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  wrap: { gap: 8, marginVertical: 10 }, label: { fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 40, paddingVertical: 9, paddingHorizontal: 14, borderWidth: 1, borderRadius: 10, justifyContent: 'center' },
  text: { fontSize: 13, fontWeight: '700' },
});
