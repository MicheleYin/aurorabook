import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import ePub from "epubjs";
import { toast } from "sonner";

import type { AudioTrack, Book, BookProgress, Chapter, NavItem } from "../types/reader";
import {
  buildNavigationMap,
  createId,
  deriveTitleFromPath,
  ensureEpubSignature,
  ensureStringArray,
  extractPlainText,
  extractYear,
  normalizeChapterContent,
  sanitizeChapterHtml,
} from "../lib/epub";
import {
  countWords,
  estimatePagesFromWords,
  getChapterPageCount,
  getChapterWordCount,
} from "../lib/utils";

const WEB_LIBRARY_STORAGE_KEY = "tts-library-cache-v1";
const LIBRARY_STORE_PATH = "library.store.json";
const LIBRARY_STORE_KEY = "library";
const LIBRARY_STORE_VERSION = 1;

type PersistedLibraryEntry = {
  sourcePath: string;
  title?: string;
  author?: string;
  publisher?: string;
  publishedYear?: string;
  subjects?: string[];
  progress?: BookProgress;
  pageCount?: number;
};

type PersistedLibraryFile = {
  version: number;
  books: Array<PersistedLibraryEntry | Book>;
};

type StoreHandle = {
  set: (key: string, value: unknown) => Promise<void>;
  get: <T>(key: string) => Promise<T | null | undefined>;
  save: () => Promise<void>;
};

type IngestParams = {
  buffer: ArrayBuffer;
  sourcePath: string;
  fallbackTitle?: string;
  progress?: BookProgress;
  pageCountHint?: number;
};

type PersistentLibrary = {
  library: Book[];
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>;
  isHydrated: boolean;
  isImporting: boolean;
  importFromDialog: () => Promise<boolean>;
  handleWebFileSelection: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
};

const isTauriEnvironment = () =>
  typeof window !== "undefined" &&
  typeof (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
    .__TAURI_INTERNALS__?.invoke === "function";

const applyDerivedFields = (book: Book): Book => {
  let chaptersChanged = false;

  const normalizedChapters = book.chapters.map((chapter) => {
    const normalizedWordCount = getChapterWordCount(chapter);
    const normalizedPageCount = getChapterPageCount({
      ...chapter,
      wordCount: normalizedWordCount,
    });

    const needsWordCountUpdate =
      typeof chapter.wordCount !== "number" || chapter.wordCount !== normalizedWordCount;
    const needsPageCountUpdate =
      normalizedPageCount !== undefined && chapter.estimatedPageCount !== normalizedPageCount;

    if (!needsWordCountUpdate && !needsPageCountUpdate) {
      return chapter;
    }

    chaptersChanged = true;
    return {
      ...chapter,
      wordCount: normalizedWordCount,
      estimatedPageCount: normalizedPageCount ?? chapter.estimatedPageCount,
    };
  });

  const totalWords = normalizedChapters.reduce(
    (sum, chapter) => sum + getChapterWordCount(chapter),
    0,
  );
  const derivedPageCount = estimatePagesFromWords(totalWords);
  const normalizedPageCount =
    derivedPageCount !== undefined ? Math.max(1, Math.round(derivedPageCount)) : undefined;

  const existingPageCount =
    typeof book.pageCount === "number" && Number.isFinite(book.pageCount)
      ? Math.max(1, Math.round(book.pageCount))
      : undefined;
  const needsBookPageUpdate =
    normalizedPageCount !== undefined && normalizedPageCount !== existingPageCount;

  if (!chaptersChanged && !needsBookPageUpdate) {
    return book;
  }

  const nextBook: Book = {
    ...book,
    chapters: chaptersChanged ? normalizedChapters : book.chapters,
  };

  if (normalizedPageCount !== undefined) {
    nextBook.pageCount = normalizedPageCount;
  }

  return nextBook;
};

type LegacyProgressFields = {
  currentChapterPageIndex?: number;
  currentChapterPageCount?: number;
};

const LIBRARY_LOG_PREFIX = "[LibraryPersistence]";

const normalizeBookProgressShape = (book: Book): Book => {
  if (!book.progress) {
    console.debug(`${LIBRARY_LOG_PREFIX} normalize skipped (no progress)`, {
      bookId: book.id,
      title: book.title,
    });
    return book;
  }

  const progress = book.progress as BookProgress & LegacyProgressFields;

  const normalizedIndex =
    typeof progress.currentChapterIndex === "number" && Number.isFinite(progress.currentChapterIndex)
      ? Math.max(Math.round(progress.currentChapterIndex), 0)
      : 0;

  const elementId =
    typeof progress.currentChapterElementId === "string" &&
    progress.currentChapterElementId.length > 0
      ? progress.currentChapterElementId
      : null;
  const elementIndex =
    typeof progress.currentChapterElementIndex === "number" &&
    Number.isFinite(progress.currentChapterElementIndex)
      ? Math.max(Math.round(progress.currentChapterElementIndex), 0)
      : null;

  const scrollTop =
    typeof progress.currentChapterScrollTop === "number" &&
    Number.isFinite(progress.currentChapterScrollTop)
      ? Math.max(progress.currentChapterScrollTop, 0)
      : 0;
  const scrollHeight =
    typeof progress.currentChapterScrollHeight === "number" &&
    Number.isFinite(progress.currentChapterScrollHeight)
      ? Math.max(progress.currentChapterScrollHeight, 0)
      : 0;
  const clientHeight =
    typeof progress.currentChapterClientHeight === "number" &&
    Number.isFinite(progress.currentChapterClientHeight)
      ? Math.max(progress.currentChapterClientHeight, 0)
      : 0;

  let percent =
    typeof progress.chapterProgressPercent === "number" && Number.isFinite(progress.chapterProgressPercent)
      ? progress.chapterProgressPercent
      : undefined;

  if (
    (percent === undefined || percent === 0) &&
    scrollHeight > 0 &&
    clientHeight >= 0 &&
    scrollTop > 0
  ) {
    const maxScroll = Math.max(scrollHeight - clientHeight, 0);
    if (maxScroll > 0) {
      percent = Math.min(Math.max(scrollTop / maxScroll, 0), 1);
    }
  }

  if (percent === undefined) {
    if (
      typeof progress.currentChapterPageIndex === "number" &&
      Number.isFinite(progress.currentChapterPageIndex) &&
      typeof progress.currentChapterPageCount === "number" &&
      Number.isFinite(progress.currentChapterPageCount) &&
      progress.currentChapterPageCount > 1
    ) {
      percent = Math.min(
        Math.max(
          Math.round(progress.currentChapterPageIndex) /
            Math.max(Math.round(progress.currentChapterPageCount) - 1, 1),
          0,
        ),
        1,
      );
    } else {
      percent = 0;
    }
  }

  const normalizedPercent = Number(Math.min(Math.max(percent ?? 0, 0), 1).toFixed(4));

  const normalizedBook = {
    ...book,
    progress: {
      currentChapterId: progress.currentChapterId,
      currentChapterHref: progress.currentChapterHref,
      currentChapterIndex: normalizedIndex,
      currentChapterElementId: elementId,
      currentChapterElementIndex: elementIndex,
      currentChapterScrollTop: scrollTop,
      currentChapterScrollHeight: scrollHeight,
      currentChapterClientHeight: clientHeight,
      chapterProgressPercent: normalizedPercent,
      updatedAt: progress.updatedAt ?? new Date().toISOString(),
    },
  };

  console.debug(`${LIBRARY_LOG_PREFIX} normalized progress`, {
    bookId: book.id,
    title: book.title,
    progress: normalizedBook.progress,
  });

  return normalizedBook;
};

export function usePersistentLibrary(): PersistentLibrary {
  const [library, setLibrary] = useState<Book[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const libraryStoreRef = useRef<StoreHandle | null>(null);

  const ensureLibraryStore = useCallback(async (): Promise<StoreHandle | null> => {
    if (!isTauriEnvironment()) return null;
    if (libraryStoreRef.current) {
      return libraryStoreRef.current;
    }

    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load(LIBRARY_STORE_PATH);
      libraryStoreRef.current = store as StoreHandle;
      return libraryStoreRef.current;
    } catch (error) {
      console.warn("Reader library: unable to initialize store.", error);
      return null;
    }
  }, []);

  const ingestEpub = useCallback(
    async ({
      buffer,
      sourcePath,
      fallbackTitle,
      progress: savedProgress,
      pageCountHint,
    }: IngestParams) => {
      ensureEpubSignature(buffer);

      const epubBook = ePub(buffer) as any;
      await epubBook.opened;

      const [metadata, navigation, spine, coverUrl] = await Promise.all([
        epubBook.loaded.metadata,
        epubBook.loaded.navigation.catch(() => undefined),
        epubBook.loaded.spine,
        epubBook
          .coverUrl()
          .catch(() => undefined)
          .then((url: string | null | undefined) => url || undefined),
      ]);

      const navMap = buildNavigationMap(navigation?.toc as NavItem[] | undefined);
      const newBookId = createId();

      const spineItems = (spine?.items ?? []) as any[];
      const manifestItems = (epubBook.packaging?.manifest ?? {}) as Record<
        string,
        { href: string; type?: string }
      >;

      const chapters = await Promise.all(
        spineItems.map(async (item: any, index: number) => {
          try {
            const section = epubBook.spine.get(item?.href ?? index);
            const rawHtml = await (section
              ? section.render(epubBook.load.bind(epubBook))
              : epubBook.load(item.href));
            const normalizedHtml = await normalizeChapterContent(rawHtml);
            if (!normalizedHtml) {
              return null;
            }

            const substitutedHtml = section
              ? normalizedHtml
              : epubBook.resources?.substitute(
                  normalizedHtml,
                  section?.url ?? epubBook.resolve(item.href),
                ) ?? normalizedHtml;

            const sanitized = sanitizeChapterHtml(substitutedHtml);
            if (!sanitized.trim()) {
              return null;
            }

            const plainText = extractPlainText(sanitized);
            const manifestItem =
              (item?.idref && manifestItems[item.idref]) ||
              Object.values(manifestItems).find((entry) => entry.href === item?.href);

            const chapterHref = manifestItem?.href ?? item?.href ?? item?.url ?? "";
            if (!chapterHref) {
              return null;
            }

            const lookupKey = chapterHref.split("#")[0];
            const title =
              navMap.get(lookupKey) ?? item.label?.trim() ?? `Section ${index + 1}`;

            const wordCount = countWords(plainText);
            const estimatedChapterPages = estimatePagesFromWords(wordCount);

            return {
              id: `${newBookId}-${item?.idref ?? item?.id ?? index}`,
              title,
              contentHtml: sanitized,
              plainText,
              order: index,
              href: chapterHref,
              wordCount,
              estimatedPageCount: estimatedChapterPages,
            } as Chapter;
          } catch (chapterError) {
            console.warn("Could not load chapter", chapterError);
            return null;
          }
        }),
      );

      const filteredChapters = chapters.filter(
        (chapter): chapter is Chapter => Boolean(chapter && chapter.plainText.trim()),
      );

      const totalWordCount = filteredChapters.reduce(
        (sum, chapter) => sum + (chapter.wordCount ?? countWords(chapter.plainText)),
        0,
      );

      const estimatedPageCount =
        estimatePagesFromWords(totalWordCount) ??
        (typeof pageCountHint === "number" && Number.isFinite(pageCountHint) && pageCountHint > 0
          ? Math.max(1, Math.round(pageCountHint))
          : undefined);

      let appliedProgress: BookProgress | undefined;
      if (savedProgress && filteredChapters.length) {
        console.debug(`${LIBRARY_LOG_PREFIX} restoring saved progress`, {
          sourcePath,
          savedProgress,
        });
        const maxIndex = filteredChapters.length - 1;
        const storedIndex =
          typeof savedProgress.currentChapterIndex === "number"
            ? savedProgress.currentChapterIndex
            : 0;
        const normalizedIndex = Math.min(Math.max(storedIndex, 0), maxIndex);
        const candidateByHref = savedProgress.currentChapterHref
          ? filteredChapters.find(
              (chapter) =>
                chapter.href === savedProgress.currentChapterHref ||
                chapter.href.split("#")[0] === savedProgress.currentChapterHref.split("#")[0],
            )
          : undefined;
        const resolvedChapter =
          candidateByHref ??
          filteredChapters[normalizedIndex] ??
          filteredChapters[Math.min(normalizedIndex, maxIndex)];

        if (resolvedChapter) {
          const resolvedIndex = filteredChapters.findIndex(
            (chapter) => chapter.id === resolvedChapter.id,
          );
          const chapterIndex = resolvedIndex === -1 ? 0 : resolvedIndex;

          const storedScrollTop =
            typeof savedProgress.currentChapterScrollTop === "number" &&
            Number.isFinite(savedProgress.currentChapterScrollTop)
              ? Math.max(savedProgress.currentChapterScrollTop, 0)
              : 0;
          const storedScrollHeight =
            typeof savedProgress.currentChapterScrollHeight === "number" &&
            Number.isFinite(savedProgress.currentChapterScrollHeight)
              ? Math.max(savedProgress.currentChapterScrollHeight, 0)
              : 0;
          const storedClientHeight =
            typeof savedProgress.currentChapterClientHeight === "number" &&
            Number.isFinite(savedProgress.currentChapterClientHeight)
              ? Math.max(savedProgress.currentChapterClientHeight, 0)
              : 0;

          let percentSource =
            typeof savedProgress.chapterProgressPercent === "number" &&
            Number.isFinite(savedProgress.chapterProgressPercent)
              ? savedProgress.chapterProgressPercent
              : undefined;

          if (
            (percentSource === undefined || percentSource === 0) &&
            storedScrollHeight > 0 &&
            storedClientHeight >= 0 &&
            storedScrollTop > 0
          ) {
            const savedMaxScroll = Math.max(storedScrollHeight - storedClientHeight, 0);
            if (savedMaxScroll > 0) {
              percentSource = Math.min(Math.max(storedScrollTop / savedMaxScroll, 0), 1);
            }
          }

          if (percentSource === undefined) {
            const legacy = savedProgress as unknown as {
              currentChapterPageIndex?: number;
              currentChapterPageCount?: number;
            };
            if (
              typeof legacy.currentChapterPageIndex === "number" &&
              Number.isFinite(legacy.currentChapterPageIndex) &&
              typeof legacy.currentChapterPageCount === "number" &&
              Number.isFinite(legacy.currentChapterPageCount) &&
              legacy.currentChapterPageCount > 1
            ) {
              percentSource = Math.min(
                Math.max(
                  Math.round(legacy.currentChapterPageIndex) /
                    Math.max(Math.round(legacy.currentChapterPageCount) - 1, 1),
                  0,
                ),
                1,
              );
            } else {
              percentSource = 0;
            }
          }

          appliedProgress = {
            currentChapterId: resolvedChapter.id,
            currentChapterHref: resolvedChapter.href,
            currentChapterIndex: chapterIndex,
            currentChapterScrollTop: storedScrollTop,
            currentChapterScrollHeight: storedScrollHeight,
            currentChapterClientHeight: storedClientHeight,
            chapterProgressPercent: Number(Math.min(Math.max(percentSource ?? 0, 0), 1).toFixed(4)),
            updatedAt: savedProgress.updatedAt ?? new Date().toISOString(),
          };
          console.debug(`${LIBRARY_LOG_PREFIX} applied restored progress`, {
            sourcePath,
            bookId: newBookId,
            progress: appliedProgress,
          });
        }
      }

      if (!filteredChapters.length) {
        throw new Error("We couldn't extract any readable chapters from this ebook.");
      }

      const audioTracks = (
        await Promise.all(
          Object.entries(manifestItems)
            .filter(([, entry]) => entry.type?.startsWith("audio/"))
            .map(async ([id, entry], trackIndex) => {
              if (!entry.href) return null;
              try {
                const url = await epubBook.resources.createUrl(entry.href);
                if (typeof url !== "string") {
                  return null;
                }
                const filename = entry.href.split("/").pop() ?? id;
                const baseTitle = decodeURIComponent(filename)
                  .replace(/\.[^/.]+$/, "")
                  .replace(/[-_]+/g, " ")
                  .trim();
                const title = baseTitle.length ? baseTitle : `Track ${trackIndex + 1}`;
                return {
                  id: `${newBookId}-audio-${id}`,
                  title,
                  href: entry.href,
                  url,
                } as AudioTrack;
              } catch (error) {
                console.warn("Could not load audio track", entry.href, error);
                return null;
              }
            }),
        )
      ).filter((track): track is AudioTrack => Boolean(track));

      const fallbackTitleResolved =
        fallbackTitle ?? deriveTitleFromPath(sourcePath);

      const subjects = ensureStringArray(metadata.subject);
      const publisher = metadata.publisher?.trim() || undefined;
      const publishedYear =
        extractYear(metadata.pubdate) ?? extractYear(metadata.modified_date);
      const fileSizeBytes = buffer.byteLength;

      const newBook: Book = {
        id: newBookId,
        title: metadata.title?.trim() || fallbackTitleResolved,
        author: metadata.creator?.trim() || "Unknown author",
        chapters: filteredChapters,
        coverUrl,
        sourcePath,
        publisher,
        publishedYear,
        subjects,
        fileSizeBytes,
        audioTracks,
        progress: appliedProgress,
        pageCount: estimatedPageCount,
      };

      const normalizedBook = normalizeBookProgressShape(applyDerivedFields(newBook));

      setLibrary((prev) => {
        if (prev.some((book) => book.sourcePath === sourcePath)) {
          console.debug(`${LIBRARY_LOG_PREFIX} skipped duplicate import`, { sourcePath });
          return prev;
        }
        console.debug(`${LIBRARY_LOG_PREFIX} adding book to library`, {
          bookId: normalizedBook.id,
          title: normalizedBook.title,
        });
        return [...prev, normalizedBook];
      });
    },
    [],
  );

  const persistLibrary = useCallback(
    async (books: Book[]) => {
      try {
        if (isTauriEnvironment()) {
          console.debug(`${LIBRARY_LOG_PREFIX} persisting library to store`, {
            count: books.length,
          });
          const store = await ensureLibraryStore();
          if (store) {
            const payload: PersistedLibraryFile = {
              version: LIBRARY_STORE_VERSION,
              books: books.map((book) => ({
                sourcePath: book.sourcePath,
                title: book.title,
                author: book.author,
                publisher: book.publisher,
                publishedYear: book.publishedYear,
                subjects: book.subjects,
                progress: book.progress,
                pageCount: book.pageCount,
              })),
            };
            await store.set(LIBRARY_STORE_KEY, payload);
            await store.save();
          }
        } else if (typeof window !== "undefined") {
          console.debug(`${LIBRARY_LOG_PREFIX} persisting library to localStorage`, {
            count: books.length,
          });
          const payload: PersistedLibraryFile = {
            version: LIBRARY_STORE_VERSION,
            books,
          };
          window.localStorage.setItem(WEB_LIBRARY_STORAGE_KEY, JSON.stringify(payload));
        }
      } catch (error) {
        console.warn("Reader library: failed to persist library state.", error);
      }
    },
    [ensureLibraryStore],
  );

  useEffect(() => {
    if (!isHydrated) return;
    void persistLibrary(library);
  }, [library, isHydrated, persistLibrary]);

  useEffect(() => {
    let cancelled = false;

    const hydrateLibrary = async () => {
      if (isTauriEnvironment()) {
        try {
          const store = await ensureLibraryStore();
          const payload = await store?.get<PersistedLibraryFile>(LIBRARY_STORE_KEY);

          if (payload?.version === LIBRARY_STORE_VERSION && Array.isArray(payload.books)) {
            console.debug(`${LIBRARY_LOG_PREFIX} hydrating via store`, {
              bookCount: payload.books.length,
            });
            for (const entry of payload.books) {
              if (cancelled) {
                return;
              }
              if (!entry?.sourcePath) {
                continue;
              }
              if (entry.sourcePath.startsWith("web://")) {
                console.debug(`${LIBRARY_LOG_PREFIX} skipping web entry during store hydrate`, {
                  sourcePath: entry.sourcePath,
                });
                continue;
              }

              try {
                const entryWithMeta = entry as PersistedLibraryEntry & Partial<Book>;
                const binary = await readFile(entry.sourcePath);
                const arrayBuffer = binary.buffer.slice(
                  binary.byteOffset,
                  binary.byteOffset + binary.byteLength,
                );
                await ingestEpub({
                  buffer: arrayBuffer,
                  sourcePath: entry.sourcePath,
                  fallbackTitle: entry.title,
                  progress: entryWithMeta.progress,
                  pageCountHint: entryWithMeta.pageCount,
                });
                console.debug(`${LIBRARY_LOG_PREFIX} restored book from store`, {
                  sourcePath: entry.sourcePath,
                });
              } catch (restoreError) {
                console.warn(
                  `Reader library: failed to restore ${entry.sourcePath}.`,
                  restoreError,
                );
                toast.error(
                  `Couldn't restore ${entry.title ?? deriveTitleFromPath(entry.sourcePath)}.`,
                );
              }
            }
          }
        } catch (error) {
          console.warn("Reader library: failed to load stored library.", error);
        } finally {
          if (!cancelled) {
            setIsHydrated(true);
          }
        }
        return;
      }

      if (typeof window !== "undefined") {
        try {
          const serialized = window.localStorage.getItem(WEB_LIBRARY_STORAGE_KEY);
          if (serialized) {
            const parsed = JSON.parse(serialized) as PersistedLibraryFile;
            if (Array.isArray(parsed?.books) && !cancelled) {
              console.debug(`${LIBRARY_LOG_PREFIX} hydrating from localStorage`, {
                bookCount: parsed.books.length,
              });
              const storedBooks = parsed.books.filter(
                (entry): entry is Book =>
                  typeof entry === "object" &&
                  entry !== null &&
                  Array.isArray((entry as Book).chapters),
              );
              if (storedBooks.length) {
                const normalizedBooks = storedBooks.map((book) =>
                  normalizeBookProgressShape(applyDerivedFields(book)),
                );
                console.debug(`${LIBRARY_LOG_PREFIX} restored books from localStorage`, {
                  bookIds: normalizedBooks.map((book) => book.id),
                });
                setLibrary(normalizedBooks);
              }
            }
          }
        } catch (error) {
          console.warn("Reader library: failed to parse stored library.", error);
        }
      }

      if (!cancelled) {
        setIsHydrated(true);
      }
    };

    void hydrateLibrary();

    return () => {
      cancelled = true;
    };
  }, [ensureLibraryStore, ingestEpub]);

  const importFromDialog = useCallback(async (): Promise<boolean> => {
    if (isImporting) return false;

    if (!isTauriEnvironment()) {
      return false;
    }

    try {
      setIsImporting(true);

      const selection = await open({
        multiple: false,
        filters: [{ name: "EPUB files", extensions: ["epub"] }],
      });

      const filePath = Array.isArray(selection) ? selection[0] : selection ?? undefined;

      if (!filePath) return true;

      if (!filePath.toLowerCase().endsWith(".epub")) {
        toast.error("Please choose an EPUB (.epub) file.");
        return true;
      }

      if (library.some((book) => book.sourcePath === filePath)) {
        toast.error("This ebook is already in your library.");
        return true;
      }

      const binary = await readFile(filePath);
      const arrayBuffer = binary.buffer.slice(
        binary.byteOffset,
        binary.byteOffset + binary.byteLength,
      );

      await ingestEpub({
        buffer: arrayBuffer,
        sourcePath: filePath,
      });
      return true;
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong while importing that ebook.";
      toast.error(message);
      return true;
    } finally {
      setIsImporting(false);
    }
  }, [ingestEpub, isImporting, library]);

  const handleWebFileSelection = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }

      if (file.type && file.type !== "application/epub+zip") {
        toast.error("Please choose an EPUB file.");
        return;
      }

      if (!file.name.toLowerCase().endsWith(".epub")) {
        toast.error("Please choose an EPUB (.epub) file.");
        return;
      }

      const sourceKey = `web://${file.name}:${file.size}:${file.lastModified}`;

      if (library.some((book) => book.sourcePath === sourceKey)) {
        toast.error("This ebook is already in your library.");
        return;
      }

      setIsImporting(true);

      try {
        const buffer = await file.arrayBuffer();
        await ingestEpub({
          buffer,
          sourcePath: sourceKey,
          fallbackTitle: file.name,
        });
      } catch (error) {
        console.error(error);
        const message =
          error instanceof Error
            ? error.message
            : "Something went wrong while importing that ebook.";
        toast.error(message);
      } finally {
        setIsImporting(false);
      }
    },
    [ingestEpub, library],
  );

  return {
    library,
    setLibrary,
    isHydrated,
    isImporting,
    importFromDialog,
    handleWebFileSelection,
  };
}

