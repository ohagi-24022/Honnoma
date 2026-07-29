export type ReadingStatus = 'unread' | 'reading' | 'read';
export type BookVolumeKind = 'main' | 'extra';

export type Book = {
  id: string;
  userId: string;
  isbn?: string;
  title: string;
  titleReading?: string | null;
  seriesTitle: string;
  seriesReading?: string | null;
  volumeNumber?: number;
  volumeKind?: BookVolumeKind;
  author?: string;
  publisher?: string;
  publishedDate?: string | null;
  purchasePrice?: number | null;
  listPrice?: number | null;
  priceSource?: 'rakuten' | 'google' | 'manual' | null;
  priceFetchedAt?: string | null;
  thumbnailUrl?: string;
  status: ReadingStatus;
  createdAt: string;
  isMissing?: false;
};

export type MissingBook = {
  id: string;
  userId: string;
  title: string;
  seriesTitle: string;
  volumeNumber: number;
  thumbnailUrl?: string;
  status: 'missing';
  createdAt: string;
  isMissing: true;
};

export type ShelfItem = Book | MissingBook;

export type BookInput = Omit<Book, 'id' | 'userId' | 'createdAt' | 'isMissing'>;
