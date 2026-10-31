export function getReaderPageCount(
  contentWidth: number,
  pageWidth: number
): number {
  if (
    !Number.isFinite(contentWidth) ||
    !Number.isFinite(pageWidth) ||
    pageWidth <= 0
  ) {
    return 1;
  }
  return Math.max(1, Math.ceil(contentWidth / pageWidth));
}

export function getReaderPageIndex(
  scrollLeft: number,
  pageWidth: number,
  pageCount: number
): number {
  if (
    !Number.isFinite(scrollLeft) ||
    !Number.isFinite(pageWidth) ||
    pageWidth <= 0
  ) {
    return 0;
  }
  return Math.min(
    Math.max(0, Math.round(scrollLeft / pageWidth)),
    Math.max(0, pageCount - 1)
  );
}

export function getReaderPageScrollLeft(
  pageIndex: number,
  pageWidth: number,
  pageCount: number
): number {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) {
    return 0;
  }
  const clampedPage = Math.min(
    Math.max(0, Math.trunc(pageIndex)),
    pageCount - 1
  );
  return Math.max(0, clampedPage) * pageWidth;
}

export function getReaderPageForRect(
  rectLeft: number,
  containerLeft: number,
  scrollLeft: number,
  pageWidth: number,
  pageCount: number
): number {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) {
    return 0;
  }
  const page = Math.floor((rectLeft - containerLeft + scrollLeft) / pageWidth);
  return Math.min(Math.max(0, page), Math.max(0, pageCount - 1));
}
