import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HeaderBackButton } from '../src/components/HeaderBackButton';
import { useAppTheme } from '../src/store/ThemeContext';

type HelpCategory = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sections: Array<{
    title: string;
    body: string;
  }>;
};

const helpCategories: HelpCategory[] = [
  {
    icon: 'barcode-outline',
    title: '登録',
    sections: [
      {
        title: 'ISBNバーコードで登録する',
        body:
          '登録タブでISBNバーコードを読み取ると、タイトル、作者、出版社、表紙、シリーズ名、巻数を自動取得します。取得後は確認画面で内容を見てから追加できます。',
      },
      {
        title: '連続スキャンと確認して追加',
        body:
          '連続スキャンでは、画面を移動せずに次の本を読み取れます。1冊ずつ内容を確認したい場合は、確認画面から「追加」または「修正して追加」を選んでください。',
      },
      {
        title: '手動登録',
        body:
          'バーコードがない本や検索できない本は、手動入力をONにして追加できます。タイトル、シリーズ名、巻数を入れておくと、本棚のシリーズ管理や巻抜け検出に反映されます。',
      },
      {
        title: '重複した本',
        body:
          '同じISBN、または同じシリーズ名と巻数の本は重複として扱われます。削除した本を再登録したい場合は、削除後にもう一度スキャンしてください。',
      },
    ],
  },
  {
    icon: 'library-outline',
    title: '本棚',
    sections: [
      {
        title: 'シリーズ表示と全冊表示',
        body:
          '本棚では、シリーズごとにまとめる「シリーズ」と、登録した本を1冊ずつ見る「全冊」を切り替えられます。検索、表示条件、並び替えは上部のアイコンから変更できます。',
      },
      {
        title: '表示方法を変える',
        body:
          'シリーズ表示中は、検索欄右側の表示方法アイコンで「詳細表示」「表紙のみ」「タイトルのみ」を切り替えられます。表紙のみは一覧性を重視し、表紙を小さめに並べて表示します。',
      },
      {
        title: '巻抜けと未所持巻',
        body:
          '途中の巻が抜けている場合は「不足」として表示されます。刊行最新巻を表示している場合、所持している最終巻より先の巻も未所持巻として確認できます。',
      },
      {
        title: '刊行最新巻と代表表紙',
        body:
          'シリーズカードの更新アイコンを押すと、刊行最新巻や完結情報を取得します。同時にシリーズの代表になりやすい最初の巻の表紙も再取得します。',
      },
      {
        title: 'お気に入り',
        body:
          'しおりアイコンでシリーズをお気に入りにできます。お気に入りは本棚の表示条件や並び替え、ランキングの「お気に入りランキング」にも反映されます。',
      },
    ],
  },
  {
    icon: 'albums-outline',
    title: 'シリーズ',
    sections: [
      {
        title: '巻を選択する',
        body:
          'シリーズ詳細では、巻のカードを押すと選択できます。選択中だけステータス変更ボタンが表示され、未読、読書中、読了へまとめて変更できます。',
      },
      {
        title: '巻の詳細を見る',
        body:
          '各巻の「詳細」から、表紙、タイトル、作者、出版社、ISBN、紹介文を確認できます。紹介文は詳細を開いた時に取得するため、古い本やAPIに情報がない本では表示されない場合があります。',
      },
      {
        title: '未所持巻を扱う',
        body:
          'グレー表示の巻はまだ本棚にない巻です。「欲しいへ」から欲しい漫画リストに追加したり、購入候補を探すきっかけにできます。',
      },
      {
        title: 'シリーズ名を直す',
        body:
          'APIの表記ゆれで別シリーズになった場合は、シリーズ詳細のシリーズ名変更からまとめ直せます。変更後は本棚や通知設定にも反映されます。',
      },
    ],
  },
  {
    icon: 'cart-outline',
    title: '欲しい',
    sections: [
      {
        title: '欲しい漫画を追加する',
        body:
          '欲しいタブでは、まだ持っていない漫画や集めたいシリーズを保存できます。タイトルだけでも追加でき、登録済みの蔵書に表紙がある場合はその表紙を利用します。',
      },
      {
        title: 'スコアと優先度',
        body:
          '欲しい漫画にはスコアがあり、数値が高いほど優先度が高くなります。上下の矢印でスコアを調整し、買いたい順を整理できます。',
      },
      {
        title: '本棚から追加する',
        body:
          'シリーズ詳細の未所持巻から「欲しいへ」を押すと、その巻を購入候補として欲しいリストに追加できます。',
      },
    ],
  },
  {
    icon: 'podium-outline',
    title: 'ランキング',
    sections: [
      {
        title: 'ランキングの見方',
        body:
          'ランキングタブでは、欲しい登録、所持人数、登録冊数、お気に入り数などの集計を確認できます。カテゴリごとに上位10件を横スクロールで表示します。',
      },
      {
        title: 'もっと見る',
        body:
          '各ランキングの「もっと見る」から、10件ずつページを切り替えて確認できます。ページ上部と下部の矢印で前後のページへ移動できます。',
      },
      {
        title: '欲しいに追加',
        body:
          'ランキングの作品をタップすると「欲しいに追加」ボタンを表示できます。すでに自分の欲しいリストにある作品には追加ボタンは表示されません。',
      },
    ],
  },
  {
    icon: 'notifications-outline',
    title: '通知',
    sections: [
      {
        title: '大本の通知設定',
        body:
          '設定タブの新刊通知をONにすると、端末通知を受け取れるようになります。ログイン中のみ利用でき、端末側の通知許可も必要です。',
      },
      {
        title: 'シリーズごとの通知',
        body:
          '本棚のシリーズカードにあるベルで、シリーズごとの新刊通知をON/OFFできます。黄色のベルは通知ON、グレーのベルは通知OFFです。新しいシリーズは初期状態ではOFFです。',
      },
      {
        title: '通知の内容',
        body:
          '通知は正午ごろにまとめて届きます。通知本文ではシリーズ名を伏せ、どのシリーズの新刊かは「新刊通知を確認する」画面で確認します。',
      },
      {
        title: '通知テスト',
        body:
          '設定タブの通知テストを使うと、新刊を待たずに端末で通知が表示されるか確認できます。',
      },
    ],
  },
  {
    icon: 'settings-outline',
    title: '設定',
    sections: [
      {
        title: 'クラウド同期',
        body:
          'ログインすると蔵書や通知設定をクラウドに保存できます。未ログインで登録した本は、ログイン後にローカル蔵書の移行からクラウドへ反映できます。',
      },
      {
        title: '表示とテーマ',
        body:
          '刊行最新巻の表示は設定タブでON/OFFできます。テーマはライト、ダーク、システム準拠から選べます。',
      },
      {
        title: 'マイページ',
        body:
          'マイページでは、通知履歴、アカウント情報、購入・支出サマリー、アカウント削除を確認できます。新刊通知の詳細もここから確認できます。',
      },
      {
        title: 'プライバシーポリシー',
        body:
          '設定タブ下部のプライバシーポリシーから、保存する情報、外部API、通知、ランキング集計の扱いを確認できます。',
      },
    ],
  },
];

export default function HelpScreen() {
  const navigation = useNavigation();
  const { colors } = useAppTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedCategory = helpCategories[selectedIndex];
  const goBack = useCallback(() => {
    router.replace('/(tabs)/settings');
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <HeaderBackButton accessibilityLabel="設定に戻る" onPress={goBack} />,
    });
  }, [goBack, navigation]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>蒐集架の使い方</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>
          知りたい項目を選ぶと、その機能の使い方を確認できます。
        </Text>
      </View>

      <View style={styles.categoryGrid}>
        {helpCategories.map((category, index) => {
          const selected = index === selectedIndex;
          return (
            <Pressable
              accessibilityLabel={`${category.title}のヘルプを開く`}
              key={category.title}
              onPress={() => setSelectedIndex(index)}
              style={[
                styles.categoryButton,
                { borderColor: selected ? colors.text : colors.border },
                selected && { backgroundColor: colors.text },
              ]}
            >
              <Ionicons color={selected ? colors.background : colors.text} name={category.icon} size={18} />
              <Text style={[styles.categoryText, { color: selected ? colors.background : colors.text }]} numberOfLines={1}>
                {category.title}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sectionHeader}>
        <Ionicons color={colors.text} name={selectedCategory.icon} size={22} />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{selectedCategory.title}</Text>
      </View>

      {selectedCategory.sections.map((section) => (
        <View key={section.title} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{section.title}</Text>
          <Text style={[styles.cardCopy, { color: colors.muted }]}>{section.body}</Text>
        </View>
      ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, padding: 18, paddingBottom: 34 },
  header: { paddingBottom: 2 },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: 0 },
  copy: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '31%',
    flexDirection: 'row',
    gap: 5,
    height: 40,
    justifyContent: 'center',
    minWidth: 96,
    paddingHorizontal: 6,
  },
  categoryText: { fontSize: 13, fontWeight: '800' },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 4 },
  sectionTitle: { fontSize: 19, fontWeight: '900' },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  cardCopy: { fontSize: 13, lineHeight: 20, marginTop: 8 },
});
