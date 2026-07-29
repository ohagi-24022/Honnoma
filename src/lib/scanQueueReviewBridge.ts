type ScanQueueReviewHandler = (targetHref: string) => boolean;

let reviewHandler: ScanQueueReviewHandler | null = null;

export function registerScanQueueReviewHandler(handler: ScanQueueReviewHandler) {
  reviewHandler = handler;
  return () => {
    if (reviewHandler === handler) {
      reviewHandler = null;
    }
  };
}

export function requestScanQueueReview(targetHref: string) {
  return reviewHandler?.(targetHref) ?? false;
}
