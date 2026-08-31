import { useIsFocused, useScrollToTop } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { formatNetworkAwareError, NETWORK_ERROR_MESSAGE } from '../../src/lib/errorMessages';
import { registerScanQueueReviewHandler } from '../../src/lib/scanQueueReviewBridge';
import { parseSeriesTitle } from '../../src/lib/series';
import { normalizeVolumeKind } from '../../src/lib/volumeKind';
import { useAppSettings } from '../../src/store/AppSettingsContext';
import { useLibrary } from '../../src/store/LibraryContext';
import { useAppTheme } from '../../src/store/ThemeContext';
import { BookInput, BookVolumeKind, ReadingStatus } from '../../src/types';

const statusOptions: Array<{ label: string; value: ReadingStatus }> = [
  { label: '未読', value: 'unread' },
  { label: '読書中', value: 'reading' },
  { label: '読了', value: 'read' },
];

type ScanNotice = {
  tone: 'neutral' | 'success' | 'warning' | 'error';
  message: string;
};

type QueuedScanItem = BookInput & {
  queueId: string;
  lookupStatus: 'pending' | 'ready' | 'error';
  lookupMessage?: string;
  purchaseMode: 'normal' | 'used';
  scannedAt: number;
  usedPurchasePrice: string;
};

function normalizeBarcode(data: string) {
  return data.replace(/[^0-9X]/gi, '').toUpperCase();
}

function formatLookupNotice(error: unknown) {
  const message = formatNetworkAwareError(error, '検索に失敗しました。');
  return message === NETWORK_ERROR_MESSAGE ? message : `検索に失敗しました: ${message}`;
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
  const [scanQueue, setScanQueue] = useState<QueuedScanItem[]>([]);
  const [showQueueReview, setShowQueueReview] = useState(false);
  const [pendingQueueTarget, setPendingQueueTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<ScanNotice>({
    tone: 'neutral',
    message: 'ISBNバーコードを枠内に入れてください。',
  });
  const lastScanRef = useRef<{ isbn: string; at: number }>({ isbn: '', at: 0 });
  const continuousScanCooldownUntilRef = useRef(0);
  const processingRef = useRef(false);
  const queuedLookupsRef = useRef<Array<{ isbn: string; queueId: string }>>([]);
  const queueWorkerRunningRef = useRef(false);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [publisher, setPublisher] = useState('');
  const [seriesTitle, setSeriesTitle] = useState('');
  const [volumeNumber, setVolumeNumber] = useState('');
  const [volumeKind, setVolumeKind] = useState<BookVolumeKind>('main');
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
    setVolumeKind(normalizeVolumeKind(bookInput.volumeKind, bookInput.title));
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
    volumeKind,
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
    setVolumeKind('main');
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
    continuousScanCooldownUntilRef.current = 0;
    processingRef.current = false;
  };

  const queueSummary = useMemo(() => {
    const pending = scanQueue.filter((item) => item.lookupStatus === 'pending').length;
    const failed = scanQueue.filter((item) => item.lookupStatus === 'error').length;
    const completed = scanQueue.length - pending;
    return {
      completed,
      failed,
      pending,
      progress: scanQueue.length > 0 ? Math.round((completed / scanQueue.length) * 100) : 0,
      ready: scanQueue.length - pending - failed,
    };
  }, [scanQueue]);

  const queueBookInput = (bookInput: BookInput, scannedIsbn: string, targetQueueId?: string) => {
    const nextIsbn = bookInput.isbn ?? scannedIsbn;
    setScanQueue((current) => {
      const readyItem: QueuedScanItem = {
        ...bookInput,
        isbn: nextIsbn,
        queueId: targetQueueId ?? `${nextIsbn || bookInput.title}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        lookupStatus: 'ready',
        lookupMessage: undefined,
        volumeKind: normalizeVolumeKind(bookInput.volumeKind, bookInput.title),
        purchaseMode: 'normal',
        scannedAt: Date.now(),
        usedPurchasePrice: '',
      };

      if (targetQueueId) {
        return current.map((item) =>
          item.queueId === targetQueueId
            ? { ...readyItem, purchaseMode: item.purchaseMode, usedPurchasePrice: item.usedPurchasePrice }
            : item,
        );
      }

      if (nextIsbn && current.some((item) => normalizeBarcode(item.isbn ?? '') === normalizeBarcode(nextIsbn))) {
        return current;
      }

      return [...current, readyItem];
    });
  };

  const runQueuedLookups = useCallback(async () => {
    if (queueWorkerRunningRef.current) return;
    queueWorkerRunningRef.current = true;

    try {
      while (queuedLookupsRef.current.length > 0) {
        const next = queuedLookupsRef.current.shift();
        if (!next) continue;

        try {
          const bookInput = await lookupBookByIsbn(next.isbn);
          if (bookInput) {
            queueBookInput({ ...bookInput, isbn: bookInput.isbn ?? next.isbn }, next.isbn, next.queueId);
            continue;
          }

          setScanQueue((current) =>
            current.map((item) =>
              item.queueId === next.queueId
                ? {
                    ...item,
                    lookupStatus: 'error',
                    lookupMessage: '書籍データが見つかりませんでした。',
                    title: `ISBN ${next.isbn}`,
                    seriesTitle: '未取得',
                  }
                : item,
            ),
          );
        } catch (error) {
          setScanQueue((current) =>
            current.map((item) =>
              item.queueId === next.queueId
                ? {
                    ...item,
                    lookupStatus: 'error',
                    lookupMessage: formatLookupNotice(error),
                    title: `ISBN ${next.isbn}`,
                    seriesTitle: '未取得',
                  }
                : item,
            ),
          );
        }
      }
    } finally {
      queueWorkerRunningRef.current = false;
    }
  }, []);

  const enqueueContinuousScan = (scannedIsbn: string) => {
    const queueId = `${scannedIsbn}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setScanQueue((current) => {
      if (current.some((item) => normalizeBarcode(item.isbn ?? '') === normalizeBarcode(scannedIsbn))) {
        return current;
      }
      return [
        ...current,
        {
          isbn: scannedIsbn,
          title: `ISBN ${scannedIsbn}`,
          seriesTitle: '検索中',
          status: 'unread',
          queueId,
          lookupStatus: 'pending',
          lookupMessage: undefined,
          volumeKind: 'main',
          purchaseMode: 'normal',
          scannedAt: Date.now(),
          usedPurchasePrice: '',
        },
      ];
    });
    queuedLookupsRef.current.push({ isbn: scannedIsbn, queueId });
    void runQueuedLookups();
  };

  const openQueueReview = () => {
    if (scanQueue.length === 0) return;
    setShowQueueReview(true);
    setShowConfirmation(false);
    setShowManualForm(false);
    setIsScanning(false);
  };

  const isQueuedIsbn = (targetIsbn: string) =>
    scanQueue.some((item) => normalizeBarcode(item.isbn ?? '') === normalizeBarcode(targetIsbn));

  const updateQueuedPurchase = (queueId: string, updates: Partial<Pick<QueuedScanItem, 'purchaseMode' | 'usedPurchasePrice'>>) => {
    setScanQueue((current) => current.map((item) => (item.queueId === queueId ? { ...item, ...updates } : item)));
  };

  const removeQueuedScan = (queueId: string) => {
    queuedLookupsRef.current = queuedLookupsRef.current.filter((item) => item.queueId !== queueId);
    setScanQueue((current) => current.filter((item) => item.queueId !== queueId));
  };

  const queuedBookInput = (item: QueuedScanItem): BookInput => {
    const usedPrice = item.usedPurchasePrice.replace(/[^0-9]/g, '');
    const purchasePrice = !trackPurchasePrices
      ? undefined
      : item.purchaseMode === 'normal'
        ? item.listPrice ?? undefined
        : usedPrice
          ? Number.parseInt(usedPrice, 10)
          : undefined;
    return {
      isbn: item.isbn,
      title: item.title,
      author: item.author,
      publisher: item.publisher,
      seriesTitle: item.seriesTitle,
      volumeNumber: item.volumeNumber,
      volumeKind: item.volumeKind,
      thumbnailUrl: item.thumbnailUrl,
      purchasePrice,
      listPrice: item.listPrice,
      priceSource: item.priceSource,
      priceFetchedAt: item.priceFetchedAt,
      status: item.status,
    };
  };

  const addQueuedBooks = async () => {
    if (scanQueue.length === 0 || queueSummary.pending > 0) return;
    setIsSubmitting(true);
    let addedCount = 0;
    let skippedCount = 0;
    try {
      for (const item of scanQueue) {
        if (item.lookupStatus !== 'ready') {
          skippedCount += 1;
          continue;
        }
        const bookInput = queuedBookInput(item);
        const duplicate = findDuplicateBook(bookInput);
        const incomingIsbn = normalizeBarcode(bookInput.isbn ?? '');
        const duplicateIsbn = normalizeBarcode(duplicate?.isbn ?? '');
        if (incomingIsbn && duplicateIsbn && incomingIsbn === duplicateIsbn) {
          skippedCount += 1;
          continue;
        }
        await addBook(bookInput, { allowDuplicate: !!duplicate });
        addedCount += 1;
      }
      const targetAfterReview = pendingQueueTarget;
      setPendingQueueTarget(null);
      setScanQueue([]);
      setShowQueueReview(false);
      setIsScanning(true);
      setNotice({
        tone: addedCount > 0 ? 'success' : 'warning',
        message: skippedCount > 0
          ? `${addedCount}冊を追加しました。${skippedCount}冊は登録済みのためスキップしました。`
          : `${addedCount}冊を追加しました。`,
      });
      if (targetAfterReview) {
        router.replace(targetAfterReview as Parameters<typeof router.replace>[0]);
      } else if (addedCount > 0) {
        router.replace('/');
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        message: formatNetworkAwareError(error, '連続スキャンした本の登録に失敗しました。'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleScanModeChange = (nextMode: 'confirm' | 'continuous') => {
    if (scanMode === 'continuous' && nextMode === 'confirm' && scanQueue.length > 0) {
      setScanMode(nextMode);
      openQueueReview();
      return;
    }
    setScanMode(nextMode);
  };

  const handleScanToggle = () => {
    if (scanMode === 'continuous' && isScanning && scanQueue.length > 0) {
      openQueueReview();
      return;
    }
    setIsScanning((value) => !value);
  };


  useEffect(() =>
    registerScanQueueReviewHandler((targetHref) => {
      if (!isFocused || scanMode !== 'continuous' || scanQueue.length === 0) {
        return false;
      }
      setPendingQueueTarget(targetHref);
      openQueueReview();
      return true;
    }),
  [isFocused, scanMode, scanQueue.length]);

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
          onPress: () => router.push(`/book/${encodeURIComponent(book.id)}`),
        },
        { text: 'OK' },
      ]);
    } catch (error) {
      setNotice({
        tone: 'error',
        message: formatNetworkAwareError(error, '登録に失敗しました。'),
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
        message: formatLookupNotice(error),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBarcode = useCallback(
    async ({ data }: { data: string }) => {
      const normalized = normalizeBarcode(data);
      const now = Date.now();
      const repeatScanWindowMs = scanMode === 'continuous' ? 700 : 5000;
      const wasJustScanned =
        lastScanRef.current.isbn === normalized && now - lastScanRef.current.at < repeatScanWindowMs;

      if (!isScanning || wasJustScanned) return;
      if (scanMode === 'continuous' && now < continuousScanCooldownUntilRef.current) return;
      if (scanMode !== 'continuous' && processingRef.current) return;
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

      if (scanMode === 'continuous') {
        if (isQueuedIsbn(normalized)) {
          setNotice({ tone: 'warning', message: 'このISBNはすでに一時リストにあります。' });
          return;
        }
        continuousScanCooldownUntilRef.current = now + 700;
        enqueueContinuousScan(normalized);
        setShowConfirmation(false);
        setNotice({ tone: 'success', message: `${normalized} を一時リストに追加しました。続けてスキャンできます。` });
        return;
      }

      processingRef.current = true;
      setIsSubmitting(true);
      setNotice({ tone: 'neutral', message: `${normalized} を検索しています。` });

      try {
        const bookInput = await lookupBookByIsbn(normalized);
        if (bookInput) {
          applyLookupResult({ ...bookInput, isbn: bookInput.isbn ?? normalized });
          setIsScanning(false);
          setNotice({ tone: 'success', message: `${bookInput.title} を確認してから追加してください。` });
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
          message: formatLookupNotice(error),
        });
      } finally {
        setIsSubmitting(false);
        setTimeout(() => {
          processingRef.current = false;
        }, 1200);
      }
    },
    [isScanning, scanMode, scanQueue, runQueuedLookups],
  );

  const reviewManual = () => {
    if (!title.trim() || !seriesTitle.trim()) {
      setNotice({ tone: 'warning', message: 'タイトルとシリーズ名は必須です。' });
      return;
    }

    const parsedVolumeNumber = Number(volumeNumber);
    if (volumeNumber && (!Number.isInteger(parsedVolumeNumber) || parsedVolumeNumber < 1)) {
      setNotice({ tone: 'warning', message: '巻数は1以上の整数で入力してください。' });
      return;
    }

    if (isbn.trim() && !isBookIsbnBarcode(isbn)) {
      setNotice({ tone: 'warning', message: '有効なISBNを入力してください。' });
      return;
    }

    setShowConfirmation(true);
    setIsScanning(false);
    setNotice({ tone: 'neutral', message: '内容を確認して追加してください。' });
  };

  const cameraVisible = isFocused && !showConfirmation && !showQueueReview;

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
            <>
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
                onBarcodeScanned={handleBarcode}
                style={styles.camera}
              />
              <View pointerEvents="none" style={styles.scanOverlay}>
                <View style={[styles.scanFrame, { borderColor: colors.primary }]} />
              </View>
            </>
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

        {!showConfirmation && !showQueueReview && <View style={styles.scanControls}>
          <View style={[styles.modeSwitch, { backgroundColor: colors.elevated }]}>
            {[
              ['confirm', '確認'],
              ['continuous', '連続登録'],
            ].map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => handleScanModeChange(value as 'confirm' | 'continuous')}
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
            onPress={handleScanToggle}
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


        {showQueueReview && (
          <View style={[styles.queueReview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.queueHeaderRow}>
              <View style={styles.queueTitleBlock}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>連続スキャンの確認</Text>
                <Text style={[styles.queueCopy, { color: colors.muted }]}>読み取ったISBNは裏で検索します。未完了がある場合はここで少し待ってから追加します。</Text>
                <Text style={[styles.queueStatusText, { color: colors.muted }]}>
                  取得済み {queueSummary.ready}冊 / 検索中 {queueSummary.pending}冊 / 失敗 {queueSummary.failed}冊
                </Text>
              </View>
              <View style={[styles.queueCountPill, { backgroundColor: colors.elevated }]}>
                <Text style={[styles.queueCountText, { color: colors.text }]}>{scanQueue.length}冊</Text>
              </View>
            </View>
            <View style={styles.queueProgressBlock}>
              <View style={[styles.queueProgressTrack, { backgroundColor: colors.elevated }]}>
                <View style={[styles.queueProgressFill, { backgroundColor: colors.primary, width: `${queueSummary.progress}%` }]} />
              </View>
              <Text style={[styles.queueProgressText, { color: colors.muted }]}>検索進捗 {queueSummary.progress}%</Text>
            </View>
            <ScrollView style={styles.queueList} contentContainerStyle={styles.queueListContent} nestedScrollEnabled showsVerticalScrollIndicator>
              {scanQueue.map((item, index) => (
              <View key={item.queueId} style={[styles.queueItem, { borderColor: colors.border }]}>
                <BookCover
                  thumbnailUrl={item.thumbnailUrl}
                  isbn={item.isbn}
                  style={styles.queueCover}
                  placeholderText="No Cover"
                />
                <View style={styles.queueItemBody}>
                  <Text style={[styles.queueItemTitle, { color: colors.text }]} numberOfLines={2}>
                    {index + 1}. {item.lookupStatus === 'pending' ? '検索中...' : item.title}
                  </Text>
                  <Text
                    style={[
                      styles.queueLookupStatus,
                      item.lookupStatus === 'ready' && { color: colors.success },
                      item.lookupStatus === 'pending' && { color: colors.muted },
                      item.lookupStatus === 'error' && { color: colors.danger },
                    ]}
                  >
                    {item.lookupStatus === 'ready' ? '取得済み' : item.lookupStatus === 'pending' ? '検索中' : item.lookupMessage ?? '検索失敗'}
                  </Text>
                  <Text style={[styles.queueItemMeta, { color: colors.muted }]} numberOfLines={1}>
                    {item.seriesTitle}{item.volumeNumber ? ` / ${item.volumeNumber}巻` : ''}
                  </Text>
                  {!!item.isbn && <Text style={[styles.queueItemMeta, { color: colors.muted }]}>ISBN {item.isbn}</Text>}
                  {trackPurchasePrices && (
                    <PurchasePriceControls
                      colors={colors}
                      mode={item.purchaseMode}
                      normalPrice={typeof item.listPrice === 'number' ? item.listPrice : null}
                      onModeChange={(mode) => updateQueuedPurchase(item.queueId, { purchaseMode: mode })}
                      onUsedPriceChange={(value) => updateQueuedPurchase(item.queueId, { usedPurchasePrice: value })}
                      usedPrice={item.usedPurchasePrice}
                    />
                  )}
                </View>
                <Pressable
                  accessibilityLabel={`${item.title}を一時リストから削除`}
                  onPress={() => removeQueuedScan(item.queueId)}
                  style={[styles.queueRemoveButton, { borderColor: colors.border }]}
                >
                  <Text style={[styles.queueRemoveText, { color: colors.danger }]}>削除</Text>
                </Pressable>
              </View>
              ))}
            </ScrollView>
            <View style={styles.queueActions}>
              <Pressable
                onPress={() => {
                  setPendingQueueTarget(null);
                  setShowQueueReview(false);
                  setScanMode('continuous');
                  setIsScanning(true);
                }}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.text }]}>続けてスキャン</Text>
              </Pressable>
              <Pressable
                disabled={isSubmitting || scanQueue.length === 0 || queueSummary.pending > 0}
                onPress={() => void addQueuedBooks()}
                style={[
                  styles.confirmAddButton,
                  { backgroundColor: colors.primary },
                  (isSubmitting || scanQueue.length === 0 || queueSummary.pending > 0) && styles.disabled,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {isSubmitting ? '追加中' : queueSummary.pending > 0 ? '検索完了待ち' : 'まとめて追加'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

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

        {!showConfirmation && !showQueueReview && (
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

        {!showConfirmation && !showQueueReview && showManualForm && <View style={styles.form}>
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
          <VolumeKindControls colors={colors} value={volumeKind} onChange={setVolumeKind} />
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



function VolumeKindControls({
  colors,
  onChange,
  value,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  onChange: (value: BookVolumeKind) => void;
  value: BookVolumeKind;
}) {
  return (
    <View style={styles.volumeKindBox}>
      <Text style={[styles.purchaseLabel, { color: colors.text }]}>巻の扱い</Text>
      <View style={[styles.purchaseModeRow, { backgroundColor: colors.elevated }]}>
        {([
          ['main', '通常巻'],
          ['extra', '関連巻'],
        ] as const).map(([optionValue, label]) => (
          <Pressable
            key={optionValue}
            onPress={() => onChange(optionValue)}
            style={[styles.purchaseModeButton, value === optionValue && { backgroundColor: colors.text }]}
          >
            <Text style={[styles.purchaseModeText, { color: value === optionValue ? colors.background : colors.muted }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.purchaseHint, { color: colors.muted }]}>関連巻は同じシリーズに表示されますが、刊行数や抜け巻には含めません。</Text>
    </View>
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
  camera: { ...StyleSheet.absoluteFillObject },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  scanFrame: {
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
  queueReview: {
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  queueHeaderRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  queueTitleBlock: { flex: 1 },
  queueCopy: { fontSize: 12, lineHeight: 17, marginTop: -6 },
  queueStatusText: { fontSize: 12, fontWeight: '800', lineHeight: 17, marginTop: 2 },
  queueCountPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  queueCountText: { fontSize: 12, fontWeight: '900' },
  queueProgressBlock: { gap: 6, marginTop: -2 },
  queueProgressTrack: { borderRadius: 999, height: 8, overflow: 'hidden' },
  queueProgressFill: { borderRadius: 999, height: '100%' },
  queueProgressText: { fontSize: 12, fontWeight: '800', lineHeight: 16, textAlign: 'right' },
  queueList: { maxHeight: 470 },
  queueListContent: { gap: 10, paddingRight: 2 },
  queueItem: {
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  queueCover: { borderRadius: 4, height: 92, width: 62 },
  queueItemBody: { flex: 1, minWidth: 0 },
  queueItemTitle: { fontSize: 15, fontWeight: '900', lineHeight: 20 },
  queueLookupStatus: { fontSize: 12, fontWeight: '900', lineHeight: 17, marginTop: 4 },
  queueItemMeta: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  queueRemoveButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  queueRemoveText: { fontSize: 12, fontWeight: '900' },
  queueActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
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
  volumeKindBox: { gap: 8, marginTop: 12 },
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








