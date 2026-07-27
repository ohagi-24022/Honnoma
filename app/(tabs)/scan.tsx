import { useIsFocused, useScrollToTop } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BookCover } from '../../src/components/BookCover';
import { isBookIsbnBarcode, lookupBookByIsbn } from '../../src/lib/bookApis';
import { parseSeriesTitle } from '../../src/lib/series';
import { useAppSettings } from '../../src/store/AppSettingsContext';
import { useLibrary } from '../../src/store/LibraryContext';
import { useAppTheme } from '../../src/store/ThemeContext';
import { BookInput, ReadingStatus } from '../../src/types';

const statusOptions: Array<{ label: string; value: ReadingStatus }> = [
  { label: '未読', value: 'unread' },
  { label: '読書中', value: 'reading' },
  { label: '読了', value: 'read' },
];

type ScanNotice = {
  tone: 'neutral' | 'success' | 'warning' | 'error';
  message: string;
};

function normalizeBarcode(data: string) {
  return data.replace(/[^0-9X]/gi, '').toUpperCase();
}

export default function ScanScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const scrollRef = useRef<ScrollView>(null);
  const tabScrollToTopRef = useRef({
    scrollToTop: () => scrollRef.current?.scrollTo({ y: 0, animated: true }),
  });
  useScrollToTop(tabScrollToTopRef);
  const [permission, requestPermission] = useCameraPermissions();
  const { addBook, deleteBook, findDuplicateBook } = useLibrary();
  const { trackPurchasePrices } = useAppSettings();
  const { colors } = useAppTheme();
  const [isScanning, setIsScanning] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [scanMode, setScanMode] = useState<'confirm' | 'continuous'>('confirm');
  const [notice, setNotice] = useState<ScanNotice>({
    tone: 'neutral',
    message: 'ISBNバーコードを枠内に入れてください。',
  });
  const lastScanRef = useRef<{ isbn: string; at: number }>({ isbn: '', at: 0 });
  const processingRef = useRef(false);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [publisher, setPublisher] = useState('');
  const [seriesTitle, setSeriesTitle] = useState('');
  const [volumeNumber, setVolumeNumber] = useState('');
  const [isbn, setIsbn] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [status, setStatus] = useState<ReadingStatus>('unread');
  const [purchaseMode, setPurchaseMode] = useState<'normal' | 'used'>('normal');
  const [normalPurchasePrice, setNormalPurchasePrice] = useState<number | null>(null);
  const [normalPriceSource, setNormalPriceSource] = useState<BookInput['priceSource']>(undefined);
  const [normalPriceFetchedAt, setNormalPriceFetchedAt] = useState<string | undefined>(undefined);
  const [usedPurchasePrice, setUsedPurchasePrice] = useState('');

  const onTitleChange = (value: string) => {
    setTitle(value);
    const parsed = parseSeriesTitle(value);
    setSeriesTitle((current) => current || parsed.seriesTitle);
    setVolumeNumber((current) => current || (parsed.volumeNumber ? String(parsed.volumeNumber) : ''));
  };

  const applyLookupResult = (bookInput: BookInput | null) => {
    if (!bookInput) return;

    setTitle(bookInput.title);
    setAuthor(bookInput.author ?? '');
    setPublisher(bookInput.publisher ?? '');
    setSeriesTitle(bookInput.seriesTitle);
    setVolumeNumber(bookInput.volumeNumber ? String(bookInput.volumeNumber) : '');
    setIsbn(bookInput.isbn ?? '');
    setThumbnailUrl(bookInput.thumbnailUrl ?? '');
    setStatus(bookInput.status);
    setNormalPurchasePrice(typeof bookInput.listPrice === 'number' ? bookInput.listPrice : null);
    setNormalPriceSource(bookInput.priceSource);
    setNormalPriceFetchedAt(bookInput.priceFetchedAt ?? undefined);
    setPurchaseMode('normal');
    setUsedPurchasePrice('');
    setShowConfirmation(true);
  };

  const selectedPurchasePrice = () => {
    if (!trackPurchasePrices) return undefined;
    if (purchaseMode === 'normal') return normalPurchasePrice ?? undefined;
    const normalizedPrice = usedPurchasePrice.replace(/[^0-9]/g, '');
    return normalizedPrice ? Number.parseInt(normalizedPrice, 10) : undefined;
  };

  const currentBookInput = (): BookInput => ({
    isbn: isbn.trim() || undefined,
    title: title.trim(),
    author: author.trim() || undefined,
    publisher: publisher.trim() || undefined,
    seriesTitle: seriesTitle.trim(),
    volumeNumber: volumeNumber ? Number.parseInt(volumeNumber, 10) : undefined,
    thumbnailUrl: thumbnailUrl || undefined,
    purchasePrice: selectedPurchasePrice(),
    listPrice: normalPurchasePrice ?? undefined,
    priceSource: normalPriceSource ?? undefined,
    priceFetchedAt: normalPurchasePrice ? normalPriceFetchedAt ?? new Date().toISOString() : undefined,
    status,
  });

  const resetForm = () => {
    setTitle('');
    setAuthor('');
    setPublisher('');
    setSeriesTitle('');
    setVolumeNumber('');
    setIsbn('');
    setThumbnailUrl('');
    setStatus('unread');
    setPurchaseMode('normal');
    setNormalPurchasePrice(null);
    setNormalPriceSource(undefined);
    setNormalPriceFetchedAt(undefined);
    setUsedPurchasePrice('');
    setShowConfirmation(false);
    setIsScanning(true);
    lastScanRef.current = { isbn: '', at: 0 };
    processingRef.current = false;
  };

  const performAdd = async (bookInput: BookInput, allowDuplicate = false) => {
    setIsSubmitting(true);
    try {
      const book = await addBook(bookInput, { allowDuplicate });
      resetForm();
      setNotice({ tone: 'success', message: `${book.title} を追加しました。` });
      router.replace('/');
      Alert.alert('追加しました', `${book.title} を本棚に追加しました。`, [
        {
          text: '取り消す',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBook(book.id);
              setNotice({ tone: 'neutral', message: `${book.title} の追加を取り消しました。` });
            } catch (error) {
              Alert.alert('取り消せませんでした', error instanceof Error ? error.message : 'もう一度お試しください。');
            }
          },
        },
        {
          text: '詳細を見る',
          onPress: () => router.push(`/(tabs)/book/${encodeURIComponent(book.id)}`),
        },
        { text: 'OK' },
      ]);
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '登録に失敗しました。',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const addWithDuplicateConfirmation = async () => {
    const bookInput = currentBookInput();
    const duplicate = findDuplicateBook(bookInput);
    if (!duplicate) {
      await performAdd(bookInput);
      return;
    }
    const incomingIsbn = normalizeBarcode(bookInput.isbn ?? '');
    const duplicateIsbn = normalizeBarcode(duplicate.isbn ?? '');
    if (incomingIsbn && incomingIsbn === duplicateIsbn) {
      Alert.alert('登録済みです', `${duplicate.title} はすでに本棚にあります。`);
      return;
    }

    Alert.alert(
      '重複の可能性があります',
      `${duplicate.title} がすでに登録されています。同じ本として追加を続けますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '追加する',
          onPress: () => {
            void performAdd(bookInput, true);
          },
        },
      ],
    );
  };

  const lookupManualIsbn = async () => {
    const normalized = normalizeBarcode(isbn);
    if (!isBookIsbnBarcode(normalized)) {
      setNotice({
        tone: 'warning',
        message: normalized
          ? '有効なISBNを入力してください。978または979で始まる13桁のISBNを推奨します。'
          : 'ISBNを入力してください。',
      });
      return;
    }

    setIsSubmitting(true);
    setNotice({ tone: 'neutral', message: `${normalized} を検索しています。` });

    try {
      const bookInput = await lookupBookByIsbn(normalized);
      if (!bookInput) {
        setNotice({ tone: 'warning', message: '書籍データが見つかりませんでした。' });
        return;
      }

      applyLookupResult(bookInput);
      setNotice({ tone: 'success', message: `${bookInput.title} の内容を確認してください。` });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? `検索に失敗しました: ${error.message}` : '検索に失敗しました。',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBarcode = useCallback(
    async ({ data }: { data: string }) => {
      const normalized = normalizeBarcode(data);
      const now = Date.now();
      const wasJustScanned =
        lastScanRef.current.isbn === normalized && now - lastScanRef.current.at < 5000;

      if (!isScanning || processingRef.current || wasJustScanned) return;
      if (normalized.length !== 10 && normalized.length !== 13) return;

      lastScanRef.current = { isbn: normalized, at: now };

      if (!isBookIsbnBarcode(normalized)) {
        setNotice({
          tone: 'warning',
          message:
            normalized.startsWith('192')
              ? `${normalized} は分類・価格コードです。978または979で始まるISBNバーコードを読み取ってください。`
              : `${normalized} は有効なISBNとして認識できませんでした。`,
        });
        return;
      }

      processingRef.current = true;
      setIsSubmitting(true);
      setNotice({ tone: 'neutral', message: `${normalized} を検索しています。` });

      try {
        const bookInput = await lookupBookByIsbn(normalized);
        if (bookInput) {
          applyLookupResult({ ...bookInput, isbn: bookInput.isbn ?? normalized });
          if (scanMode === 'continuous') {
            setShowConfirmation(false);
            try {
              const book = await addBook({ ...bookInput, isbn: bookInput.isbn ?? normalized });
              resetForm();
              setNotice({ tone: 'success', message: `${book.title} を追加しました。次の本を読み取れます。` });
            } catch (error) {
              setNotice({
                tone: 'warning',
                message:
                  error instanceof Error
                    ? `書籍は見つかりましたが登録できませんでした: ${error.message}`
                    : '書籍は見つかりましたが登録できませんでした。ログイン状態を確認してください。',
              });
            }
          } else {
            setIsScanning(false);
            setNotice({ tone: 'success', message: `${bookInput.title} を確認してから追加してください。` });
          }
          return;
        }

        setIsbn(normalized);
        setNotice({
          tone: 'warning',
          message: '書籍データが見つかりませんでした。下の手動登録にISBNを入れました。',
        });
      } catch (error) {
        setIsbn(normalized);
        setNotice({
          tone: 'error',
          message:
            error instanceof Error
              ? `検索に失敗しました: ${error.message}`
              : '検索に失敗しました。通信状態を確認してください。',
        });
      } finally {
        setIsSubmitting(false);
        setTimeout(() => {
          processingRef.current = false;
        }, 1200);
      }
    },
    [addBook, isScanning, scanMode],
  );

  const reviewManual = () => {
    if (!title.trim() || !seriesTitle.trim()) {
      setNotice({ tone: 'warning', message: 'タイトルとシリーズ名は必須です。' });
      return;
    }

    if (volumeNumber && !Number.isInteger(Number(volumeNumber))) {
      setNotice({ tone: 'warning', message: '巻数は整数で入力してください。' });
      return;
    }

    setShowConfirmation(true);
    setIsScanning(false);
    setNotice({ tone: 'neutral', message: '内容を確認して追加してください。' });
  };

  const cameraVisible = isFocused && !showConfirmation;

  const noticeColor =
    notice.tone === 'success'
      ? '#e8f7ee'
      : notice.tone === 'warning'
        ? '#fff7df'
        : notice.tone === 'error'
          ? '#ffeceb'
          : colors.elevated;
  const noticeTextColor =
    notice.tone === 'success'
      ? '#128a3f'
      : notice.tone === 'warning'
        ? '#765100'
        : notice.tone === 'error'
          ? colors.danger
          : colors.text;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        {cameraVisible && <View style={styles.cameraShell}>
          {permission?.granted ? (
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
              onBarcodeScanned={handleBarcode}
              style={styles.camera}
            >
              <View style={[styles.scanFrame, { borderColor: colors.primary }]} />
            </CameraView>
          ) : (
            <View style={styles.permissionBox}>
              <Text style={styles.permissionText}>ISBNスキャンにはカメラ権限が必要です。</Text>
              <Pressable style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={requestPermission}>
                <Text style={styles.primaryButtonText}>カメラを許可</Text>
              </Pressable>
            </View>
          )}
        </View>}

        <View style={[styles.notice, { backgroundColor: noticeColor }]}>
          <Text style={[styles.noticeText, { color: noticeTextColor }]}>{notice.message}</Text>
        </View>

        {!showConfirmation && <View style={styles.scanControls}>
          <View style={[styles.modeSwitch, { backgroundColor: colors.elevated }]}>
            {[
              ['confirm', '確認'],
              ['continuous', '連続登録'],
            ].map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => setScanMode(value as 'confirm' | 'continuous')}
                style={[styles.modeButton, scanMode === value && { backgroundColor: colors.text }]}
              >
                <Text style={[styles.modeText, { color: scanMode === value ? colors.background : colors.muted }]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            disabled={isSubmitting}
            onPress={() => setIsScanning((value) => !value)}
            style={[
              styles.primaryButton,
              { backgroundColor: isScanning ? colors.primary : colors.text },
              isSubmitting && styles.disabled,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {isSubmitting ? '検索中' : isScanning ? 'スキャン停止' : 'スキャン再開'}
            </Text>
          </Pressable>
        </View>}

        {showConfirmation && (
          <View style={[styles.confirmation, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <BookCover
              thumbnailUrl={thumbnailUrl || undefined}
              isbn={isbn || undefined}
              style={styles.confirmationCover}
              placeholderText="表紙なし"
            />
            <View style={styles.confirmationBody}>
              <Text style={[styles.confirmationTitle, { color: colors.text }]}>{title}</Text>
              <Text style={[styles.confirmationMeta, { color: colors.muted }]}>
                {seriesTitle}
                {volumeNumber ? ` / ${volumeNumber}巻` : ' / 巻数なし'}
              </Text>
              {!!author && <Text style={[styles.confirmationMeta, { color: colors.muted }]}>{author}</Text>}
              {!!publisher && (
                <Text style={[styles.confirmationMeta, { color: colors.muted }]}>{publisher}</Text>
              )}
              {!!isbn && <Text style={[styles.confirmationIsbn, { color: colors.muted }]}>ISBN {isbn}</Text>}
              {trackPurchasePrices && (
                <PurchasePriceControls
                  colors={colors}
                  mode={purchaseMode}
                  normalPrice={normalPurchasePrice}
                  onModeChange={setPurchaseMode}
                  onUsedPriceChange={setUsedPurchasePrice}
                  usedPrice={usedPurchasePrice}
                />
              )}
              <View style={styles.confirmationActions}>
                <Pressable
                  onPress={() => setShowConfirmation(false)}
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                >
                  <Text style={[styles.secondaryButtonText, { color: colors.text }]}>修正する</Text>
                </Pressable>
                <Pressable
                  disabled={isSubmitting}
                  onPress={() => void addWithDuplicateConfirmation()}
                  style={[
                    styles.confirmAddButton,
                    { backgroundColor: colors.primary },
                    isSubmitting && styles.disabled,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>{isSubmitting ? '追加中' : '追加'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {!showConfirmation && (
          <View style={[styles.manualToggleRow, { borderTopColor: colors.border }]}>
            <View style={styles.manualToggleText}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>手動登録</Text>
              <Text style={[styles.manualToggleCopy, { color: colors.muted }]}>
                ISBN検索やバーコードなしの本を入力する時だけONにします。
              </Text>
            </View>
            <Switch
              value={showManualForm}
              onValueChange={setShowManualForm}
              trackColor={{ false: colors.elevated, true: colors.success }}
              thumbColor={showManualForm ? '#ffffff' : colors.muted}
            />
          </View>
        )}

        {!showConfirmation && showManualForm && <View style={styles.form}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>手動登録</Text>
          <TextInput
            autoCorrect={false}
            value={title}
            onChangeText={onTitleChange}
            placeholder="タイトル"
            placeholderTextColor={colors.muted}
            style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
          />
          <TextInput
            autoCorrect={false}
            value={seriesTitle}
            onChangeText={setSeriesTitle}
            placeholder="シリーズ名"
            placeholderTextColor={colors.muted}
            style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
          />
          <View style={styles.inputRow}>
            <TextInput
              value={volumeNumber}
              onChangeText={setVolumeNumber}
              keyboardType="number-pad"
              placeholder="巻"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.compactInput, { backgroundColor: colors.input, color: colors.text }]}
            />
            <TextInput
              value={isbn}
              onChangeText={setIsbn}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="number-pad"
              placeholder="ISBN"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.flexInput, { backgroundColor: colors.input, color: colors.text }]}
            />
            <Pressable
              disabled={isSubmitting}
              onPress={lookupManualIsbn}
              style={[styles.lookupButton, { backgroundColor: colors.primary }, isSubmitting && styles.disabled]}
            >
              <Text style={styles.lookupButtonText}>検索</Text>
            </Pressable>
          </View>
          <TextInput
            autoCorrect={false}
            value={author}
            onChangeText={setAuthor}
            placeholder="著者"
            placeholderTextColor={colors.muted}
            style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
          />
          <TextInput
            autoCorrect={false}
            value={publisher}
            onChangeText={setPublisher}
            placeholder="出版社"
            placeholderTextColor={colors.muted}
            style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
          />
          {trackPurchasePrices && (
            <PurchasePriceControls
              colors={colors}
              mode={purchaseMode}
              normalPrice={normalPurchasePrice}
              onModeChange={setPurchaseMode}
              onUsedPriceChange={setUsedPurchasePrice}
              usedPrice={usedPurchasePrice}
            />
          )}
          <View style={styles.statusRow}>
            {statusOptions.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => setStatus(option.value)}
                style={[
                  styles.statusButton,
                  { borderColor: colors.border },
                  status === option.value && { backgroundColor: colors.text, borderColor: colors.text },
                ]}
              >
                <Text style={[styles.statusText, { color: status === option.value ? colors.background : colors.muted }]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[styles.submitButton, { backgroundColor: colors.text }]} onPress={reviewManual}>
            <Text style={[styles.submitButtonText, { color: colors.background }]}>内容を確認</Text>
          </Pressable>
        </View>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}


function PurchasePriceControls({
  colors,
  mode,
  normalPrice,
  onModeChange,
  onUsedPriceChange,
  usedPrice,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  mode: 'normal' | 'used';
  normalPrice: number | null;
  onModeChange: (mode: 'normal' | 'used') => void;
  onUsedPriceChange: (value: string) => void;
  usedPrice: string;
}) {
  return (
    <View style={styles.purchaseBox}>
      <Text style={[styles.purchaseLabel, { color: colors.text }]}>購入価格</Text>
      <View style={[styles.purchaseModeRow, { backgroundColor: colors.elevated }]}>
        {([
          ['normal', '通常'],
          ['used', '中古'],
        ] as const).map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => onModeChange(value)}
            style={[styles.purchaseModeButton, mode === value && { backgroundColor: colors.text }]}
          >
            <Text style={[styles.purchaseModeText, { color: mode === value ? colors.background : colors.muted }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'normal' ? (
        <Text style={[styles.purchaseHint, { color: colors.muted }]}>通常価格: {normalPrice ? `¥${normalPrice.toLocaleString('ja-JP')}` : '取得できませんでした'}</Text>
      ) : (
        <TextInput
          keyboardType="number-pad"
          onChangeText={(value) => onUsedPriceChange(value.replace(/[^0-9]/g, ''))}
          placeholder="中古価格"
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.purchaseInput, { backgroundColor: colors.input, color: colors.text }]}
          value={usedPrice}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 18, paddingBottom: 40 },
  cameraShell: {
    aspectRatio: 0.74,
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  camera: { flex: 1, justifyContent: 'center', padding: 32 },
  scanFrame: {
    alignSelf: 'center',
    borderRadius: 8,
    borderWidth: 3,
    height: 140,
    width: '86%',
  },
  permissionBox: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  permissionText: { color: '#ffffff', fontSize: 15, marginBottom: 16, textAlign: 'center' },
  notice: { borderRadius: 8, marginTop: 12, minHeight: 44, padding: 12 },
  noticeText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  scanControls: { gap: 10, paddingVertical: 14 },
  modeSwitch: {
    borderRadius: 8,
    flexDirection: 'row',
    padding: 4,
  },
  modeButton: { alignItems: 'center', borderRadius: 6, flex: 1, height: 38, justifyContent: 'center' },
  modeText: { fontSize: 13, fontWeight: '800' },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 46,
    justifyContent: 'center',
  },
  disabled: { opacity: 0.55 },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  form: { paddingTop: 14 },
  manualToggleRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 14,
    marginTop: 4,
    paddingTop: 18,
  },
  manualToggleText: { flex: 1 },
  manualToggleCopy: { fontSize: 12, lineHeight: 17, marginTop: -6 },
  confirmation: {
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
  },
  confirmationCover: {
    backgroundColor: '#e5e5e5',
    borderRadius: 4,
    height: 168,
    width: 114,
  },
  confirmationBody: { flex: 1, minWidth: 0 },
  confirmationTitle: { fontSize: 18, fontWeight: '900', lineHeight: 24 },
  confirmationMeta: { fontSize: 14, lineHeight: 20, marginTop: 6 },
  confirmationIsbn: { fontSize: 12, marginTop: 10 },
  confirmationActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  purchaseBox: { gap: 8, marginTop: 12 },
  purchaseLabel: { fontSize: 13, fontWeight: '800' },
  purchaseModeRow: { borderRadius: 8, flexDirection: 'row', padding: 4 },
  purchaseModeButton: { alignItems: 'center', borderRadius: 6, flex: 1, height: 34, justifyContent: 'center' },
  purchaseModeText: { fontSize: 13, fontWeight: '800' },
  purchaseHint: { fontSize: 12, lineHeight: 17 },
  purchaseInput: { marginBottom: 0 },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    height: 42,
    justifyContent: 'center',
  },
  secondaryButtonText: { fontSize: 13, fontWeight: '800' },
  confirmAddButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 42,
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 12 },
  input: {
    borderRadius: 8,
    fontSize: 16,
    height: 46,
    marginBottom: 10,
    paddingHorizontal: 12,
  },
  inputRow: { flexDirection: 'row', gap: 10 },
  compactInput: { width: 82 },
  flexInput: { flex: 1 },
  lookupButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 46,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  lookupButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  statusRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statusButton: {
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    height: 40,
    justifyContent: 'center',
  },
  statusText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  submitButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
  },
  submitButtonText: { fontSize: 15, fontWeight: '800' },
});
