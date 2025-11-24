import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { parseEpub } from "../lib/epub-parser";

import type {
  AudioTrack,
  Book,
  BookAudioState,
  BookProgress,
  Chapter,
  NavItem,
} from "../types/reader";
import {
  buildAudioSyncMap,
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
  audioState?: BookAudioState;
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
  audioState?: BookAudioState;
};

type PersistentLibrary = {
  library: Book[];
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>;
  isHydrated: boolean;
  isImporting: boolean;
  importFromDialog: () => Promise<boolean | { book: Book; buffer: ArrayBuffer }>;
  handleWebFileSelection: (event: ChangeEvent<HTMLInputElement>) => Promise<void | { book: Book; buffer: ArrayBuffer }>;
  ingestEpub: (params: IngestParams) => Promise<Book | null>;
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
      audioState: savedAudioState,
    }: IngestParams) => {
      ensureEpubSignature(buffer);

      const epubBook = await parseEpub(buffer);

      const navMap = buildNavigationMap(epubBook.navigation?.toc as NavItem[] | undefined);
      const newBookId = createId();

      const spineItems = epubBook.spine.items;
      const manifestItems = epubBook.manifest;

      // Find cover image using multiple methods (in order of preference)
      let coverUrl: string | undefined;
      try {
        let coverItem: typeof manifestItems[string] | undefined;
        
        // Method 1: Check metadata for cover reference (<meta name="cover" content="..."/>)
        if (epubBook.metadata.coverId) {
          coverItem = manifestItems[epubBook.metadata.coverId];
          if (coverItem) {
            console.debug("[EPUB] Found cover via metadata coverId:", epubBook.metadata.coverId);
          }
        }
        
        // Method 2: Check for items with properties="cover-image"
        if (!coverItem) {
          coverItem = Object.values(manifestItems).find(
            (item) => item.properties === "cover-image" || item.properties?.includes("cover-image"),
          );
          if (coverItem) {
            console.debug("[EPUB] Found cover via cover-image property:", coverItem.id);
          }
        }
        
        // Method 3: Check for items with id="cover"
        if (!coverItem) {
          coverItem = manifestItems["cover"];
          if (coverItem) {
            console.debug("[EPUB] Found cover via id='cover':", coverItem.id);
          }
        }
        
        // Method 4: Check for items with "cover" in href (but only if it's an image)
        if (!coverItem) {
          coverItem = Object.values(manifestItems).find(
            (item) => {
              const isImage = item.type?.startsWith("image/");
              return isImage && (item.href.includes("cover") || item.id.includes("cover"));
            },
          );
          if (coverItem) {
            console.debug("[EPUB] Found cover via href/id containing 'cover':", coverItem.id);
          }
        }
        
        if (coverItem) {
          coverUrl = await epubBook.createUrl(coverItem.href);
          console.debug("[EPUB] Successfully created cover URL for:", coverItem.href);
        } else {
          console.debug("[EPUB] No cover image found in EPUB");
        }
      } catch (error) {
        console.debug("Could not load cover image", error);
      }

      const chapters = await Promise.all(
        spineItems.map(async (item, index: number) => {
          try {
            const rawHtml = await epubBook.load(item.href);
            const normalizedHtml = await normalizeChapterContent(rawHtml);
            if (!normalizedHtml) {
              return null;
            }

            // Get chapter href first (needed for image resolution)
            const manifestItem = manifestItems[item.id || ""] || 
              Object.values(manifestItems).find((entry) => entry.href === item.href);
            const chapterHref = manifestItem?.href ?? item.href ?? "";
            if (!chapterHref) {
              return null;
            }

            // Basic HTML substitution for relative links/images
            const parser = new DOMParser();
            const doc = parser.parseFromString(normalizedHtml, "text/html");
            
            // Resolve image URLs - convert relative paths to blob URLs
            const images = doc.querySelectorAll("img[src]");
            await Promise.all(
              Array.from(images).map(async (img) => {
                const src = img.getAttribute("src");
                if (!src) return;
                
                // Skip data URLs and absolute URLs
                if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://")) {
                  return;
                }
                
                try {
                  // Resolve relative image path
                  // Images are relative to the chapter file location
                  const imagePath = src;
                  
                  // Normalize chapter href - remove leading OEBPS/ if present for path resolution
                  let normalizedChapterHref = chapterHref;
                  if (normalizedChapterHref.startsWith("OEBPS/")) {
                    normalizedChapterHref = normalizedChapterHref.substring(6);
                  }
                  
                  // First, try to resolve relative to chapter directory
                  let resolvedPath: string;
                  
                  // If it's a relative path (not starting with / or OEBPS/), resolve it relative to chapter
                  if (!imagePath.startsWith("/") && !imagePath.startsWith("OEBPS/") && !imagePath.startsWith("http://") && !imagePath.startsWith("https://")) {
                    // Build path relative to chapter
                    const chapterParts = normalizedChapterHref.split("/");
                    const imageParts = imagePath.split("/");
                    const chapterDirParts = chapterParts.slice(0, -1);
                    
                    const resolvedParts = [...chapterDirParts];
                    for (const part of imageParts) {
                      if (part === "..") {
                        if (resolvedParts.length > 0) {
                          resolvedParts.pop();
                        }
                      } else if (part !== "." && part !== "") {
                        resolvedParts.push(part);
                      }
                    }
                    
                    resolvedPath = resolvedParts.join("/");
                  } else {
                    // Already absolute or OEBPS/ path
                    resolvedPath = imagePath;
                  }
                  
                  // Use epubBook.resolve() to add OEBPS/ prefix if needed
                  resolvedPath = epubBook.resolve(resolvedPath);
                  console.debug(`Resolving image: ${src} -> ${resolvedPath} (chapter: ${chapterHref})`);
                  
                  // Create blob URL for the image
                  // createUrl will handle the path correctly via getFile
                  const imageUrl = await epubBook.createUrl(resolvedPath);
                  console.debug(`Successfully created blob URL for image: ${src}`);
                  img.setAttribute("src", imageUrl);
                } catch (error) {
                  console.error(`Could not resolve image ${src} in chapter ${chapterHref}:`, error);
                  // Mark it so we know it failed - browser might still try to load it
                  img.setAttribute("data-image-error", "true");
                }
              }),
            );
            
            // Also handle CSS background images
            const elementsWithBackground = doc.querySelectorAll("[style*='background']");
            await Promise.all(
              Array.from(elementsWithBackground).map(async (el) => {
                const style = el.getAttribute("style");
                if (!style) return;
                
                // Match url(...) patterns in CSS
                const urlMatches = style.match(/url\(['"]?([^'")]+)['"]?\)/gi);
                if (!urlMatches) return;
                
                let updatedStyle = style;
                for (const urlMatch of urlMatches) {
                  const urlMatchContent = urlMatch.match(/url\(['"]?([^'")]+)['"]?\)/i);
                  if (!urlMatchContent || !urlMatchContent[1]) continue;
                  
                  const imageSrc = urlMatchContent[1];
                  
                  // Skip data URLs and absolute URLs
                  if (imageSrc.startsWith("data:") || imageSrc.startsWith("http://") || imageSrc.startsWith("https://")) {
                    continue;
                  }
                  
                  try {
                    // Resolve relative image path
                    let imagePath = imageSrc;
                    
                    // Normalize chapter href - remove leading OEBPS/ if present for path resolution
                    let normalizedChapterHref = chapterHref;
                    if (normalizedChapterHref.startsWith("OEBPS/")) {
                      normalizedChapterHref = normalizedChapterHref.substring(6);
                    }
                    
                    // Resolve relative paths properly
                    if (!imagePath.startsWith("/") && !imagePath.startsWith("OEBPS/") && !imagePath.startsWith("http://") && !imagePath.startsWith("https://")) {
                      // Build full path by resolving relative to chapter
                      const chapterParts = normalizedChapterHref.split("/");
                      const imageParts = imagePath.split("/");
                      
                      // Remove filename from chapter parts to get directory
                      const chapterDirParts = chapterParts.slice(0, -1);
                      
                      // Resolve .. and . in image path
                      const resolvedParts = [...chapterDirParts];
                      for (const part of imageParts) {
                        if (part === "..") {
                          resolvedParts.pop(); // Go up one directory
                        } else if (part !== "." && part !== "") {
                          resolvedParts.push(part); // Add directory/file
                        }
                      }
                      
                      imagePath = resolvedParts.join("/");
                    }
                    
                    // epubBook.createUrl will handle OEBPS/ prefix internally
                    const imageUrl = await epubBook.createUrl(imagePath);
                    updatedStyle = updatedStyle.replace(urlMatch, `url('${imageUrl}')`);
                  } catch (error) {
                    console.warn(`Could not resolve background image ${imageSrc} in chapter ${chapterHref}:`, error);
                  }
                }
                
                if (updatedStyle !== style) {
                  el.setAttribute("style", updatedStyle);
                }
              }),
            );

            const substitutedHtml = new XMLSerializer().serializeToString(doc);
            
            // Debug: Check if images have blob URLs before sanitization
            const tempDoc = new DOMParser().parseFromString(substitutedHtml, "text/html");
            const tempImages = tempDoc.querySelectorAll("img[src]");
            tempImages.forEach((img) => {
              const src = img.getAttribute("src");
              if (src && src.startsWith("blob:")) {
                console.debug(`Image has blob URL before sanitization: ${src.substring(0, 50)}...`);
              }
            });
            
            const sanitized = sanitizeChapterHtml(substitutedHtml);
            
            // Debug: Check if images still have blob URLs after sanitization
            const sanitizedDoc = new DOMParser().parseFromString(sanitized, "text/html");
            const sanitizedImages = sanitizedDoc.querySelectorAll("img[src]");
            sanitizedImages.forEach((img) => {
              const src = img.getAttribute("src");
              if (src && src.startsWith("blob:")) {
                console.debug(`Image still has blob URL after sanitization: ${src.substring(0, 50)}...`);
              } else if (src) {
                console.warn(`Image src changed after sanitization: ${src.substring(0, 50)}...`);
              } else {
                console.error(`Image src was removed by sanitization!`);
              }
            });
            
            if (!sanitized.trim()) {
              return null;
            }

            const plainText = extractPlainText(sanitized);

            const lookupKey = chapterHref.split("#")[0];
            const title =
              navMap.get(lookupKey) ?? item.label?.trim() ?? `Section ${index + 1}`;

            const wordCount = countWords(plainText);
            const estimatedChapterPages = estimatePagesFromWords(wordCount);

            return {
              id: `${newBookId}-${item.id ?? index}`,
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
                const url = await epubBook.createUrl(entry.href);
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
                console.error("Could not load audio track", {
                  href: entry.href,
                  id,
                  error: error instanceof Error ? error.message : String(error),
                  stack: error instanceof Error ? error.stack : undefined,
                });
                return null;
              }
            }),
        )
      ).filter((track): track is AudioTrack => Boolean(track));

      // Build audio sync map from SMIL files if available
      const audioSyncMap = await buildAudioSyncMap(epubBook, filteredChapters);

      let restoredAudioState: BookAudioState | undefined;
      if (savedAudioState && audioTracks.length) {
        const resolvedTrack =
          audioTracks.find((track) => track.href === savedAudioState.currentTrackHref) ??
          audioTracks[savedAudioState.currentTrackIndex] ??
          audioTracks.find((track) => track.id === savedAudioState.currentTrackId);
        if (resolvedTrack) {
          const resolvedIndex = audioTracks.findIndex((track) => track.id === resolvedTrack.id);
          const normalizedSeconds =
            typeof savedAudioState.currentTimeSeconds === "number" &&
            Number.isFinite(savedAudioState.currentTimeSeconds)
              ? Math.max(savedAudioState.currentTimeSeconds, 0)
              : 0;
          restoredAudioState = {
            currentTrackId: resolvedTrack.id,
            currentTrackHref: resolvedTrack.href,
            currentTrackIndex: resolvedIndex === -1 ? 0 : resolvedIndex,
            currentTimeSeconds: Number(normalizedSeconds.toFixed(3)),
            updatedAt: savedAudioState.updatedAt ?? new Date().toISOString(),
          };
        }
      }

      const fallbackTitleResolved =
        fallbackTitle ?? deriveTitleFromPath(sourcePath);

      const subjects = ensureStringArray(epubBook.metadata.subject);
      const publisher = epubBook.metadata.publisher?.trim() || undefined;
      const publishedYear =
        extractYear(epubBook.metadata.pubdate) ?? extractYear(epubBook.metadata.modified_date);
      
      // Calculate file size from buffer (this will be the converted EPUB size if re-ingesting after conversion)
      const fileSizeBytes = buffer.byteLength;
      const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
      
      console.debug(`${LIBRARY_LOG_PREFIX} computed file size`, {
        sourcePath,
        fileSizeBytes,
        fileSizeMB,
        hasAudioTracks: audioTracks.length > 0,
      });

      const newBook: Book = {
        id: newBookId,
        title: epubBook.metadata.title?.trim() || fallbackTitleResolved,
        author: epubBook.metadata.creator?.trim() || "Unknown author",
        chapters: filteredChapters,
        coverUrl,
        sourcePath,
        publisher,
        publishedYear,
        subjects,
        fileSizeBytes,
        audioTracks,
        audioState: restoredAudioState,
        audioSyncMap,
        progress: appliedProgress,
        pageCount: estimatedPageCount,
      };

      const normalizedBook = normalizeBookProgressShape(applyDerivedFields(newBook));

      setLibrary((prev) => {
        // Check if book with same sourcePath already exists
        const existingIndex = prev.findIndex((book) => book.sourcePath === sourcePath);
        if (existingIndex !== -1) {
          // Replace existing book (for in-place conversion)
          const oldBook = prev[existingIndex];
          console.debug(`${LIBRARY_LOG_PREFIX} replacing existing book`, {
            bookId: normalizedBook.id,
            title: normalizedBook.title,
            sourcePath,
            oldFileSizeBytes: oldBook.fileSizeBytes,
            newFileSizeBytes: normalizedBook.fileSizeBytes,
            oldFileSizeMB: oldBook.fileSizeBytes ? (oldBook.fileSizeBytes / (1024 * 1024)).toFixed(2) : "N/A",
            newFileSizeMB: normalizedBook.fileSizeBytes ? (normalizedBook.fileSizeBytes / (1024 * 1024)).toFixed(2) : "N/A",
          });
          const updated = [...prev];
          updated[existingIndex] = normalizedBook;
          return updated;
        }
        console.debug(`${LIBRARY_LOG_PREFIX} adding book to library`, {
          bookId: normalizedBook.id,
          title: normalizedBook.title,
        });
        return [...prev, normalizedBook];
      });
      
      return normalizedBook;
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
              audioState: book.audioState,
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
                // Try to get EPUB buffer - first from store (for converted audiobooks), then from file
                let arrayBuffer: ArrayBuffer | null = null;
                
                // If it's a converted audiobook (has audioState), try to get from store first
                if (entryWithMeta.audioState) {
                  const { getConvertedEpub } = await import("../lib/epub-store");
                  arrayBuffer = await getConvertedEpub(entry.sourcePath);
                }
                
                // If not found in store, try to read from file system
                if (!arrayBuffer) {
                  try {
                    const binary = await readFile(entry.sourcePath);
                    arrayBuffer = binary.buffer.slice(
                      binary.byteOffset,
                      binary.byteOffset + binary.byteLength,
                    );
                  } catch (fileError) {
                    // File doesn't exist - if it's a converted audiobook, we already tried store
                    if (entryWithMeta.audioState && !arrayBuffer) {
                      console.warn(
                        `${LIBRARY_LOG_PREFIX} converted audiobook not found in store or file system`,
                        { sourcePath: entry.sourcePath },
                      );
                      toast.error(
                        `Couldn't restore ${entry.title ?? deriveTitleFromPath(entry.sourcePath)}. The converted audiobook is missing.`,
                      );
                      continue;
                    }
                    throw fileError;
                  }
                }
                
                const book = await ingestEpub({
                  buffer: arrayBuffer,
                  sourcePath: entry.sourcePath,
                  fallbackTitle: entry.title,
                  progress: entryWithMeta.progress,
                  pageCountHint: entryWithMeta.pageCount,
                  audioState: entryWithMeta.audioState,
                });
                
                console.debug(`${LIBRARY_LOG_PREFIX} restored book from store`, {
                  sourcePath: entry.sourcePath,
                  bookId: book?.id,
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

  const importFromDialog = useCallback(async (): Promise<boolean | { book: Book; buffer: ArrayBuffer }> => {
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

      const book = await ingestEpub({
        buffer: arrayBuffer,
        sourcePath: filePath,
      });
      
      if (!book) {
        return true;
      }
      
      // Return book and buffer for potential conversion check
      return { book, buffer: arrayBuffer };
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
        const book = await ingestEpub({
          buffer,
          sourcePath: sourceKey,
          fallbackTitle: file.name,
        });
        
        // Return book and buffer for potential conversion check
        return book ? { book, buffer } : undefined;
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
    ingestEpub,
  };
}


