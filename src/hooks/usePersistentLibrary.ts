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
          const chapterPageCount =
            getChapterPageCount(resolvedChapter) ??
            (typeof savedProgress.currentChapterPageCount === "number" &&
            Number.isFinite(savedProgress.currentChapterPageCount)
              ? Math.max(1, Math.round(savedProgress.currentChapterPageCount))
              : 1);
          const storedPageIndex =
            typeof savedProgress.currentChapterPageIndex === "number" &&
            Number.isFinite(savedProgress.currentChapterPageIndex)
              ? Math.round(savedProgress.currentChapterPageIndex)
              : 0;
          const pageIndex = Math.min(
            Math.max(storedPageIndex, 0),
            Math.max(chapterPageCount - 1, 0),
          );
          const percentSource =
            typeof savedProgress.chapterProgressPercent === "number" &&
            Number.isFinite(savedProgress.chapterProgressPercent)
              ? Math.min(Math.max(savedProgress.chapterProgressPercent, 0), 1)
              : chapterPageCount > 1
                ? pageIndex / (chapterPageCount - 1)
                : pageIndex > 0
                  ? 1
                  : 0;

          appliedProgress = {
            currentChapterId: resolvedChapter.id,
            currentChapterHref: resolvedChapter.href,
            currentChapterIndex: chapterIndex,
            currentChapterPageIndex: pageIndex,
            currentChapterPageCount: chapterPageCount,
            chapterProgressPercent: Number(percentSource.toFixed(4)),
            updatedAt: savedProgress.updatedAt ?? new Date().toISOString(),
          };
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

      const normalizedBook = applyDerivedFields(newBook);

      setLibrary((prev) => {
        if (prev.some((book) => book.sourcePath === sourcePath)) {
          return prev;
        }
        return [...prev, normalizedBook];
      });
    },
    [],
  );

  const persistLibrary = useCallback(
    async (books: Book[]) => {
      try {
        if (isTauriEnvironment()) {
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
            for (const entry of payload.books) {
              if (cancelled) {
                return;
              }
              if (!entry?.sourcePath) {
                continue;
              }
              if (entry.sourcePath.startsWith("web://")) {
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
              const storedBooks = parsed.books.filter(
                (entry): entry is Book =>
                  typeof entry === "object" &&
                  entry !== null &&
                  Array.isArray((entry as Book).chapters),
              );
              if (storedBooks.length) {
                const normalizedBooks = storedBooks.map((book) => applyDerivedFields(book));
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

