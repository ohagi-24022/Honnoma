import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../../store/ThemeContext';

type Option = {
  label: string;
  value: string;
};

type OptionSheetProps = {
  visible: boolean;
  title: string;
  options: Option[];
  multiple?: boolean;
  onBack?: () => void;
  onApply?: () => void;
  onSelect: (value: string) => void;
  onClose: () => void;
  selectedValue?: string;
  selectedValues?: string[];
  selectedDirection?: 'asc' | 'desc';
  variant?: 'check' | 'list';
};

export function OptionSheet({
  visible,
  title,
  options,
  multiple = false,
  onBack,
  onApply,
  onSelect,
  onClose,
  selectedValue,
  selectedValues,
  selectedDirection = 'asc',
  variant = 'check',
}: OptionSheetProps) {
  const { colors } = useAppTheme();
  const activeValues = selectedValues ?? (selectedValue ? [selectedValue] : []);

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={[styles.sheet, { backgroundColor: colors.surface }]}
        >
          <View style={styles.header}>
            {onBack && (
              <Pressable accessibilityLabel="表示条件へ戻る" hitSlop={8} onPress={onBack} style={styles.backButton}>
                <Ionicons color={colors.text} name="chevron-back" size={22} />
              </Pressable>
            )}
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {options.map((option) => {
              const selected = activeValues.includes(option.value);
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onSelect(option.value)}
                  style={[styles.row, { borderBottomColor: colors.border }]}
                >
                  {variant === 'check' ? (
                    <View
                      style={[
                        styles.checkbox,
                        { borderColor: selected ? colors.text : colors.border },
                        selected && { backgroundColor: colors.text },
                      ]}
                    >
                      <Text style={[styles.checkmark, { color: colors.background }]}>{selected ? '✓' : ''}</Text>
                    </View>
                  ) : (
                    <View style={styles.listIndicator}>
                      {selected && (
                        <Ionicons
                          color={colors.text}
                          name={selectedDirection === 'asc' ? 'arrow-down' : 'arrow-up'}
                          size={18}
                        />
                      )}
                    </View>
                  )}
                  <Text style={[styles.optionText, { color: colors.text }]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {multiple && (
            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              <Pressable onPress={onApply ?? onClose} style={[styles.applyButton, { backgroundColor: colors.text }]}>
                <Text style={[styles.applyText, { color: colors.background }]}>適用</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    borderRadius: 8,
    maxHeight: '78%',
    maxWidth: 360,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingTop: 16,
    width: '100%',
  },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: 36 },
  backButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    marginLeft: -7,
    marginRight: 3,
    width: 36,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '900', marginBottom: 6 },
  row: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 50,
  },
  applyButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 42,
    justifyContent: 'center',
  },
  applyText: { fontSize: 14, fontWeight: '900' },
  checkbox: {
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    marginRight: 12,
    width: 22,
  },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  listIndicator: {
    alignItems: 'center',
    height: 22,
    justifyContent: 'center',
    marginRight: 12,
    width: 22,
  },
  checkmark: { fontSize: 14, fontWeight: '900' },
  optionText: { fontSize: 15, fontWeight: '700' },
});
