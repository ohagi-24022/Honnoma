import type { Book, BookInput } from '../types';
import type { BookVolumeDetails } from './bookApis';

// Verified against the publishers' pages. Keep the ISBN, volume and cover together.
const demoMetadata: Record<string, Omit<BookInput, 'status'>> = {
  'demo-1': {
    isbn: '9784088820118',
    title: 'SPY×FAMILY 1',
    seriesTitle: 'SPY×FAMILY',
    titleReading: 'すぱいふぁみりー',
    seriesReading: 'すぱいふぁみりー',
    volumeNumber: 1,
    volumeKind: 'main',
    author: '遠藤達哉',
    publisher: '集英社',
    publishedDate: '2019-07-04',
    thumbnailUrl: 'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088820118/1200/9784088820118.jpg',
  },
  'demo-2': {
    isbn: '9784088821207',
    title: 'SPY×FAMILY 2',
    seriesTitle: 'SPY×FAMILY',
    titleReading: 'すぱいふぁみりー',
    seriesReading: 'すぱいふぁみりー',
    volumeNumber: 2,
    volumeKind: 'main',
    author: '遠藤達哉',
    publisher: '集英社',
    publishedDate: '2019-10-04',
    thumbnailUrl: 'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088821207/1200/9784088821207.jpg',
  },
  'demo-3': {
    isbn: '9784088822297',
    title: 'SPY×FAMILY 4',
    seriesTitle: 'SPY×FAMILY',
    titleReading: 'すぱいふぁみりー',
    seriesReading: 'すぱいふぁみりー',
    volumeNumber: 4,
    volumeKind: 'main',
    author: '遠藤達哉',
    publisher: '集英社',
    publishedDate: '2020-05-13',
    thumbnailUrl: 'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088822297/1200/9784088822297.jpg',
  },
  'demo-4': {
    isbn: '9784065207277',
    title: 'ブルーピリオド 8',
    seriesTitle: 'ブルーピリオド',
    titleReading: 'ぶるーぴりおど',
    seriesReading: 'ぶるーぴりおど',
    volumeNumber: 8,
    volumeKind: 'main',
    author: '山口つばさ',
    publisher: '講談社',
    publishedDate: '2020-09-23',
    thumbnailUrl: 'https://dvs-cover.kodansha.co.jp/0000344390/Iwxcl3l7g7rhxByHWiDm216Qe7bQYY3O7r0cM3cG.jpg',
  },
};

export function createDemoBooks(): Book[] {
  const createdAt = new Date().toISOString();
  return Object.entries(demoMetadata).map(([id, metadata]) => ({
    ...metadata,
    id,
    userId: 'local-user',
    status: id === 'demo-4' ? 'reading' : id === 'demo-3' ? 'unread' : 'read',
    createdAt,
  }));
}

export function repairDemoBook(book: Book): Book {
  const metadata = demoMetadata[book.id];
  if (!metadata || book.userId !== 'local-user') return book;
  // Preserve reading status, registration date and purchase data on existing samples.
  return { ...book, ...metadata };
}

const demoDescriptions: Record<string, { description: string; sourceUrl: string }> = {
  'demo-1': {
    description: '任務のために家族を作ることになったスパイ。超能力者の少女と暗殺者の女性を迎え、互いの秘密を知らないまま名門校への潜入を目指します。',
    sourceUrl: 'https://www.s-manga.net/items/contents.html?isbn=9784088820118',
  },
  'demo-2': {
    description: '東西の平和を守る任務に向け、フォージャー家が名門校の受験に挑む巻です。仮初めの家族として協力しながら、入学への課題に立ち向かいます。',
    sourceUrl: 'https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-882120-7',
  },
  'demo-3': {
    description: '犬を使った暗殺計画を阻止するため、黄昏が緊急任務へ。犬を探していたアーニャは、不思議な能力を持つ犬と出会います。',
    sourceUrl: 'https://www.s-manga.net/items/contents.html?isbn=9784088822297',
  },
  'demo-4': {
    description: '東京藝大に入学した八虎は、東京の風景を描く課題に取り組みます。渋谷の景色を作品にまとめる難しさに向き合い、藝祭の準備も始まります。',
    sourceUrl: 'https://www.kodansha.co.jp/comic/products/0000344390',
  },
};

export function getDemoBookDetails(book: Book): BookVolumeDetails | null {
  const metadata = demoMetadata[book.id];
  if (!metadata || book.userId !== 'local-user') return null;
  return {
    title: metadata.title,
    seriesTitle: metadata.seriesTitle,
    author: metadata.author,
    publisher: metadata.publisher,
    thumbnailUrl: metadata.thumbnailUrl,
    ...demoDescriptions[book.id],
    source: 'Developer Override',
    checkedAt: new Date().toISOString(),
  };
}
