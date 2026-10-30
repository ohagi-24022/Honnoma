type PriceFields = { purchasePrice?: number | null; listPrice?: number | null };

export function hasBookPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function initialPurchasePriceText(book: PriceFields) {
  const price = hasBookPrice(book.purchasePrice) ? book.purchasePrice : book.listPrice;
  return hasBookPrice(price) ? String(price) : '';
}

export function registrationPurchasePrice(book: PriceFields, enabled: boolean) {
  if (!enabled || book.purchasePrice !== undefined) return book.purchasePrice;
  return hasBookPrice(book.listPrice) ? book.listPrice : undefined;
}
