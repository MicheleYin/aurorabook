/**
 * Lazy chapter loader - loads chapter content from EPUB buffer on demand
 * This prevents keeping all chapter content in memory at once
 */

import { parseEpub, type EpubBook } from "./epub-parser";
import { getEpub } from "./epub-store";
import type { Chapter } from "../types/reader";
import {
  normalizeChapterContent,
  sanitizeChapterHtml,
  extractPlainText,
} from "./epub";
import { countWords, estimatePagesFromWords } from "./utils";

const LOADER_LOG_PREFIX = "[LazyChapterLoader]";

// Cache for loaded chapters to avoid reloading
const chapterCache = new Map<string, { contentHtml: string; plainText: string; wordCount: number }>();

// Cache for parsed EPUB books (only metadata, not full content)
const epubBookCache = new Map<string, EpubBook>();

/**
 * Clear cache for a book (useful when book is deleted or updated)
 */
export function clearBookCache(sourcePath: string): void {
  const bookId = sourcePath;
  // Clear all chapters for this book
  const keysToDelete: string[] = [];
  chapterCache.forEach((_, key) => {
    if (key.startsWith(`${bookId}:`)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => chapterCache.delete(key));
  epubBookCache.delete(bookId);
  console.debug(`${LOADER_LOG_PREFIX} cleared cache for book`, { sourcePath, clearedChapters: keysToDelete.length });
}

/**
 * Clear cache for all books except the specified one
 * Useful for keeping only the currently open book in memory
 */
export function clearAllCachesExcept(sourcePath: string): void {
  const keepBookId = sourcePath;
  let clearedChapters = 0;
  let clearedBooks = 0;
  
  // Clear all chapters except those for the specified book
  const keysToDelete: string[] = [];
  chapterCache.forEach((_, key) => {
    if (!key.startsWith(`${keepBookId}:`)) {
      keysToDelete.push(key);
      clearedChapters++;
    }
  });
  keysToDelete.forEach((key) => chapterCache.delete(key));
  
  // Clear all EPUB book caches except the specified one
  epubBookCache.forEach((_, bookId) => {
    if (bookId !== keepBookId) {
      epubBookCache.delete(bookId);
      clearedBooks++;
    }
  });
  
  console.debug(`${LOADER_LOG_PREFIX} cleared all caches except book`, {
    keepSourcePath: sourcePath,
    clearedChapters,
    clearedBooks,
  });
}

/**
 * Get or parse EPUB metadata (without loading chapter content)
 */
async function getEpubBookMetadata(sourcePath: string): Promise<EpubBook | null> {
  // Check cache first
  if (epubBookCache.has(sourcePath)) {
    return epubBookCache.get(sourcePath)!;
  }

  try {
    // Get EPUB buffer from store
    const buffer = await getEpub(sourcePath);
    if (!buffer) {
      console.warn(`${LOADER_LOG_PREFIX} EPUB not found in store`, { sourcePath });
      return null;
    }

    // Parse EPUB (this loads JSZip but we'll clear it after extracting metadata)
    const epubBook = await parseEpub(buffer);
    
    // Cache the book object (it has zip but we'll use it lazily)
    epubBookCache.set(sourcePath, epubBook);
    
    return epubBook;
  } catch (error) {
    console.error(`${LOADER_LOG_PREFIX} failed to load EPUB metadata`, { sourcePath, error });
    return null;
  }
}

/**
 * Load a single chapter's content from EPUB
 */
export async function loadChapterContent(
  sourcePath: string,
  chapter: Chapter,
): Promise<{ contentHtml: string; plainText: string; wordCount: number }> {
  const cacheKey = `${sourcePath}:${chapter.href}`;
  
  // Check cache first
  if (chapterCache.has(cacheKey)) {
    const cached = chapterCache.get(cacheKey)!;
    console.debug(`${LOADER_LOG_PREFIX} using cached chapter`, { sourcePath, href: chapter.href });
    return cached;
  }

  try {
    // Get EPUB book metadata
    const epubBook = await getEpubBookMetadata(sourcePath);
    if (!epubBook) {
      throw new Error(`EPUB not found: ${sourcePath}`);
    }

    // Load chapter HTML
    const rawHtml = await epubBook.load(chapter.href);
    const normalizedHtml = await normalizeChapterContent(rawHtml);
    if (!normalizedHtml) {
      throw new Error(`Failed to normalize chapter: ${chapter.href}`);
    }

    // Get manifest item for image resolution
    const manifestItem = Object.values(epubBook.manifest).find(
      (entry) => entry.href === chapter.href || entry.id === chapter.id.split("-").pop(),
    );
    const chapterHref = manifestItem?.href ?? chapter.href;

    // Resolve images
    const parser = new DOMParser();
    const doc = parser.parseFromString(normalizedHtml, "text/html");
    
    // Resolve image URLs
    const images = doc.querySelectorAll("img[src]");
    await Promise.all(
      Array.from(images).map(async (img) => {
        const src = img.getAttribute("src");
        if (!src) return;
        
        if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://")) {
          return;
        }
        
        try {
          let normalizedChapterHref = chapterHref;
          if (normalizedChapterHref.startsWith("OEBPS/")) {
            normalizedChapterHref = normalizedChapterHref.substring(6);
          }
          
          let resolvedPath: string;
          if (!src.startsWith("/") && !src.startsWith("OEBPS/") && !src.startsWith("http://") && !src.startsWith("https://")) {
            const chapterParts = normalizedChapterHref.split("/");
            const imageParts = src.split("/");
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
            resolvedPath = src;
          }
          
          resolvedPath = epubBook.resolve(resolvedPath);
          const imageUrl = await epubBook.createUrl(resolvedPath);
          img.setAttribute("src", imageUrl);
        } catch (error) {
          console.error(`Could not resolve image ${src} in chapter ${chapterHref}:`, error);
          img.setAttribute("data-image-error", "true");
        }
      }),
    );

    // Handle CSS background images
    const elementsWithBackground = doc.querySelectorAll("[style*='background']");
    await Promise.all(
      Array.from(elementsWithBackground).map(async (el) => {
        const style = el.getAttribute("style");
        if (!style) return;
        
        const urlMatches = style.match(/url\(['"]?([^'")]+)['"]?\)/gi);
        if (!urlMatches) return;
        
        let updatedStyle = style;
        for (const urlMatch of urlMatches) {
          const urlMatchContent = urlMatch.match(/url\(['"]?([^'")]+)['"]?\)/i);
          if (!urlMatchContent || !urlMatchContent[1]) continue;
          
          const imageSrc = urlMatchContent[1];
          if (imageSrc.startsWith("data:") || imageSrc.startsWith("http://") || imageSrc.startsWith("https://")) {
            continue;
          }
          
          try {
            let imagePath = imageSrc;
            let normalizedChapterHref = chapterHref;
            if (normalizedChapterHref.startsWith("OEBPS/")) {
              normalizedChapterHref = normalizedChapterHref.substring(6);
            }
            
            if (!imagePath.startsWith("/") && !imagePath.startsWith("OEBPS/") && !imagePath.startsWith("http://") && !imagePath.startsWith("https://")) {
              const chapterParts = normalizedChapterHref.split("/");
              const imageParts = imagePath.split("/");
              const chapterDirParts = chapterParts.slice(0, -1);
              
              const resolvedParts = [...chapterDirParts];
              for (const part of imageParts) {
                if (part === "..") {
                  resolvedParts.pop();
                } else if (part !== "." && part !== "") {
                  resolvedParts.push(part);
                }
              }
              
              imagePath = resolvedParts.join("/");
            }
            
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
    const sanitized = sanitizeChapterHtml(substitutedHtml);
    
    if (!sanitized.trim()) {
      throw new Error(`Chapter content is empty: ${chapter.href}`);
    }

    const plainText = extractPlainText(sanitized);
    const wordCount = countWords(plainText);

    // Cache the result
    const result = { contentHtml: sanitized, plainText, wordCount };
    chapterCache.set(cacheKey, result);
    
    console.debug(`${LOADER_LOG_PREFIX} loaded chapter`, {
      sourcePath,
      href: chapter.href,
      wordCount,
    });

    return result;
  } catch (error) {
    console.error(`${LOADER_LOG_PREFIX} failed to load chapter`, {
      sourcePath,
      href: chapter.href,
      error,
    });
    throw error;
  }
}

/**
 * Ensure a chapter is loaded, loading it if necessary
 */
export async function ensureChapterLoaded(
  sourcePath: string,
  chapter: Chapter,
): Promise<Chapter> {
  // If already loaded, return as-is
  if (chapter.contentHtml && chapter.plainText) {
    return chapter;
  }

  try {
    const { contentHtml, plainText, wordCount } = await loadChapterContent(sourcePath, chapter);
    
    return {
      ...chapter,
      contentHtml,
      plainText,
      wordCount: chapter.wordCount ?? wordCount,
      estimatedPageCount: chapter.estimatedPageCount ?? estimatePagesFromWords(wordCount),
      _loading: false,
    };
  } catch (error) {
    console.error(`${LOADER_LOG_PREFIX} failed to ensure chapter loaded`, {
      sourcePath,
      href: chapter.href,
      error,
    });
    // Return chapter with loading flag cleared even on error
    return { ...chapter, _loading: false };
  }
}

