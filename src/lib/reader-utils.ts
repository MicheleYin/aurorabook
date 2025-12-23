import type { Book, BookProgress, Chapter } from "../types/book";

/**
 * Calculates the reading progress for a book based on scroll position and current chapter
 * @param scrollContainer - The scrollable container element
 * @param currentBook - The current book being read
 * @param currentChapter - The current chapter being read
 * @returns BookProgress object with all progress information
 */
export function calculateBookProgress(
  scrollContainer: HTMLDivElement,
  currentBook: Book,
  currentChapter: Chapter
): BookProgress {
  const scrollTop = scrollContainer.scrollTop;
  const scrollHeight = scrollContainer.scrollHeight;
  const clientHeight = scrollContainer.clientHeight;

  // Calculate chapter progress
  const chapterProgress =
    scrollHeight > clientHeight
      ? Math.min(100, (scrollTop / (scrollHeight - clientHeight)) * 100)
      : 100;

  // Find current chapter index
  const chapterIndex = currentBook.chapters.findIndex(
    (ch) => ch.id === currentChapter.id
  );

  // Calculate book progress
  const bookProgress =
    currentBook.chapters.length > 0
      ? ((chapterIndex + chapterProgress / 100) / currentBook.chapters.length) *
        100
      : 0;

  // Find current element (if any)
  let elementId: string | undefined;
  let elementIndex: number | undefined;

  const contentRef = scrollContainer.querySelector(".prose") as HTMLElement;
  if (contentRef && scrollContainer) {
    const elements = contentRef.querySelectorAll("p, h1, h2, h3, h4, h5, h6");
    let closestElement: HTMLElement | null = null;
    let closestDistance = Infinity;
    let foundIndex: number | undefined;

    elements.forEach((el, index) => {
      const htmlEl = el as HTMLElement;
      const rect = htmlEl.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const distance = Math.abs(rect.top - containerRect.top);

      if (distance < closestDistance && rect.top >= containerRect.top) {
        closestDistance = distance;
        closestElement = htmlEl;
        foundIndex = index;
      }
    });

    if (closestElement && foundIndex !== undefined) {
      elementIndex = foundIndex;
      const htmlElement = closestElement as HTMLElement;
      elementId = htmlElement.id || `element-${foundIndex}`;
      if (!htmlElement.id) {
        htmlElement.id = elementId;
      }
    }
  }

  return {
    currentChapterId: currentChapter.id,
    currentChapterHref: currentChapter.href,
    currentChapterIndex: chapterIndex,
    currentChapterElementId: elementId,
    currentChapterElementIndex: elementIndex,
    currentChapterScrollTop: scrollTop,
    currentChapterScrollHeight: scrollHeight,
    currentChapterClientHeight: clientHeight,
    chapterProgressPercent: chapterProgress,
    bookProgressPercent: bookProgress,
    updatedAt: new Date().toISOString(),
  };
}
