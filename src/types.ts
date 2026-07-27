export type ReadingStatus = 'unread' | 'reading' | 'read';

export type Book = {
  id: string;
  userId: string;
  isbn?: string;
  title: string;
  seriesTitle: string;
  volumeNumber?: number;
  author?: string;
  publisher?: string;
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
