/**
 * Custom EPUB parser using JSZip
 * Replaces epubjs to avoid path resolution issues
 */

import JSZip from "jszip";

export interface EpubMetadata {
  title?: string;
  creator?: string;
  publisher?: string;
  subject?: string | string[];
  pubdate?: string;
  modified_date?: string;
  coverId?: string; // ID of cover image from <meta name="cover" content="..."/>
}

export interface TocItem {
  href: string;
  label?: string;
  subitems?: TocItem[];
}

export interface Navigation {
  toc: TocItem[];
}

export interface SpineItem {
  id?: string;
  href: string;
  index: number;
  label?: string;
}

export interface Spine {
  items: SpineItem[];
}

export interface ManifestItem {
  id: string;
  href: string;
  type?: string;
  properties?: string; // e.g., "cover-image"
}

export interface EpubBook {
  metadata: EpubMetadata;
  navigation?: Navigation;
  spine: Spine;
  manifest: Record<string, ManifestItem>;
  zip: JSZip;
  
  /**
   * Load a file from the EPUB by href (relative to OEBPS/)
   * Returns the content as a string or ArrayBuffer
   */
  load(href: string): Promise<string>;
  
  /**
   * Get a file from the EPUB as ArrayBuffer
   */
  getFile(href: string): Promise<ArrayBuffer | null>;
  
  /**
   * Resolve an href to its actual path in the ZIP
   */
  resolve(href: string): string;
  
  /**
   * Create a blob URL for a resource
   */
  createUrl(href: string): Promise<string>;
}

/**
 * Sanitize XML to fix common parsing issues
 */
function sanitizeXml(xml: string): string {
  // Remove BOM and other invisible characters that might cause issues
  let sanitized = xml.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  
  // Fix unescaped ampersands (must be done before other replacements)
  // This is a common issue in malformed XML
  sanitized = sanitized.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g, '&amp;');
  
  // Fix invalid characters in attribute names
  // XML attribute names can only contain: letters, digits, hyphens, underscores, periods, and colons
  // Match attribute patterns: <tag attr= or <tag attr=" or <tag attr=' or <tag attr = 
  // This regex matches: tag name, then optional whitespace, then attribute name, then = sign
  sanitized = sanitized.replace(/(<[^\s>]+)(\s+)([^\s=]+?)(\s*=\s*)/g, (match, tag, whitespace, attrName, equals) => {
    // Skip if this looks like it might be part of the tag name or closing
    if (attrName.startsWith('/') || attrName.startsWith('?')) {
      return match;
    }
    // Check if attribute name contains invalid characters (not letters, digits, :, -, ., or _)
    // Valid XML attribute names: NameStartChar (Letter | '_' | ':') followed by NameChar* (NameStartChar | '-' | '.' | Digit | CombiningChar | Extender)
    if (/[^\w:.-]/.test(attrName)) {
      const fixedAttrName = attrName.replace(/[^\w:.-]/g, '_');
      console.warn(`[EPUB Parser] Fixed invalid attribute name: "${attrName}" -> "${fixedAttrName}"`);
      return `${tag}${whitespace}${fixedAttrName}${equals}`;
    }
    return match;
  });
  
  return sanitized;
}

/**
 * Parse content.opf XML to extract metadata, spine, and manifest
 */
function parseContentOpf(opfXml: string): {
  metadata: EpubMetadata;
  spine: Spine;
  manifest: Record<string, ManifestItem>;
} {
  // Try to sanitize the XML first
  let sanitizedXml = sanitizeXml(opfXml);
  
  const parser = new DOMParser();
  let doc = parser.parseFromString(sanitizedXml, "text/xml");
  
  // Check for parsing errors
  let parserError = doc.querySelector("parsererror");
  if (parserError) {
    const errorText = parserError.textContent || '';
    const lines = opfXml.split('\n');
    
    // Extract line and column numbers from error message
    const lineMatch = errorText.match(/line (\d+)/i);
    const colMatch = errorText.match(/column (\d+)/i);
    
    let errorMsg = `Failed to parse content.opf: ${errorText}`;
    
    if (lineMatch) {
      const lineNum = parseInt(lineMatch[1], 10);
      if (lineNum > 0 && lineNum <= lines.length) {
        const problematicLine = lines[lineNum - 1];
        const colNum = colMatch ? parseInt(colMatch[1], 10) : null;
        
        errorMsg += `\n\nProblematic line ${lineNum}:`;
        errorMsg += `\n${problematicLine}`;
        
        if (colNum) {
          // Add a caret pointing to the problematic column
          const indent = ' '.repeat(Math.max(0, colNum - 1));
          errorMsg += `\n${indent}^`;
        }
        
        // Try to identify the issue
        if (colNum && colNum <= problematicLine.length) {
          const charAtError = problematicLine[colNum - 1];
          errorMsg += `\n\nCharacter at error position: "${charAtError}" (code: ${charAtError.charCodeAt(0)})`;
          
          // Check for common issues
          if (/[^\w:.\-=_"'\s<>\/]/.test(charAtError)) {
            errorMsg += `\nThis appears to be an invalid character in an attribute name or value.`;
          }
        }
      }
    }
    
    // Log the raw XML around the error for debugging
    if (lineMatch) {
      const lineNum = parseInt(lineMatch[1], 10);
      const contextLines = 3;
      const startLine = Math.max(0, lineNum - contextLines - 1);
      const endLine = Math.min(lines.length, lineNum + contextLines);
      
      console.error('[EPUB Parser] XML parsing error context:', {
        errorLine: lineNum,
        context: lines.slice(startLine, endLine).map((line, idx) => ({
          lineNum: startLine + idx + 1,
          content: line,
        })),
      });
    }
    
    throw new Error(errorMsg);
  }
  
  // Extract metadata
  const metadata: EpubMetadata = {};
  const metadataEl = doc.querySelector("metadata");
  if (metadataEl) {
    const titleEl = metadataEl.querySelector("title");
    if (titleEl) metadata.title = titleEl.textContent?.trim();
    
    const creatorEl = metadataEl.querySelector("creator");
    if (creatorEl) metadata.creator = creatorEl.textContent?.trim();
    
    const publisherEl = metadataEl.querySelector("publisher");
    if (publisherEl) metadata.publisher = publisherEl.textContent?.trim();
    
    const subjectEls = metadataEl.querySelectorAll("subject");
    if (subjectEls.length > 0) {
      const subjects = Array.from(subjectEls).map(el => el.textContent?.trim()).filter(Boolean) as string[];
      metadata.subject = subjects.length === 1 ? subjects[0] : subjects;
    }
    
    const dateEl = metadataEl.querySelector("date[event='publication'], date");
    if (dateEl) metadata.pubdate = dateEl.textContent?.trim();
    
    const modifiedEl = metadataEl.querySelector("meta[property='dcterms:modified']");
    if (modifiedEl) metadata.modified_date = modifiedEl.textContent?.trim();
    
    // Extract cover reference from metadata
    const coverMetaEl = metadataEl.querySelector("meta[name='cover']");
    if (coverMetaEl) {
      const coverContent = coverMetaEl.getAttribute("content");
      if (coverContent) {
        metadata.coverId = coverContent.trim();
      }
    }
  }
  
  // Extract manifest
  const manifest: Record<string, ManifestItem> = {};
  const manifestEl = doc.querySelector("manifest");
  if (manifestEl) {
    const items = manifestEl.querySelectorAll("item");
    items.forEach((item) => {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      const type = item.getAttribute("media-type");
      const properties = item.getAttribute("properties");
      if (id && href) {
        manifest[id] = {
          id,
          href,
          type: type || undefined,
          properties: properties || undefined,
        };
      }
    });
  }
  
  // Extract spine
  const spine: Spine = { items: [] };
  const spineEl = doc.querySelector("spine");
  if (spineEl) {
    const itemrefs = spineEl.querySelectorAll("itemref");
    itemrefs.forEach((itemref, index) => {
      const idref = itemref.getAttribute("idref");
      if (idref && manifest[idref]) {
        const manifestItem = manifest[idref];
        spine.items.push({
          id: idref,
          href: manifestItem.href,
          index,
        });
      }
    });
  }
  
  return { metadata, spine, manifest };
}

/**
 * Parse navigation document (nav.xhtml or toc.ncx)
 */
async function parseNavigation(
  zip: JSZip,
  manifest: Record<string, ManifestItem>,
): Promise<Navigation | undefined> {
  // Try to find nav.xhtml first (EPUB 3)
  const navItem = Object.values(manifest).find(
    (item) => item.type === "application/xhtml+xml" && item.href.includes("nav"),
  );
  
  if (navItem) {
    try {
      const navPath = navItem.href.startsWith("OEBPS/") ? navItem.href : `OEBPS/${navItem.href}`;
      const navXml = await zip.file(navPath)?.async("string");
      if (navXml) {
        return parseNavXhtml(navXml);
      }
    } catch (error) {
      console.warn("Failed to parse nav.xhtml:", error);
    }
  }
  
  // Fallback to toc.ncx (EPUB 2)
  const tocItem = Object.values(manifest).find(
    (item) => item.type === "application/x-dtbncx+xml" || item.href.includes("toc.ncx"),
  );
  
  if (tocItem) {
    try {
      const tocPath = tocItem.href.startsWith("OEBPS/") ? tocItem.href : `OEBPS/${tocItem.href}`;
      const tocXml = await zip.file(tocPath)?.async("string");
      if (tocXml) {
        return parseTocNcx(tocXml);
      }
    } catch (error) {
      console.warn("Failed to parse toc.ncx:", error);
    }
  }
  
  return undefined;
}

/**
 * Parse EPUB 3 navigation document (nav.xhtml)
 */
function parseNavXhtml(navXml: string): Navigation {
  const parser = new DOMParser();
  const doc = parser.parseFromString(navXml, "text/xml");
  
  const toc: TocItem[] = [];
  const navEl = doc.querySelector("nav[epub\\:type='toc'], nav[epub:type='toc']");
  
  if (navEl) {
    const ol = navEl.querySelector("ol");
    if (ol) {
      parseNavList(ol, toc);
    }
  }
  
  return { toc };
}

function parseNavList(ol: Element, items: TocItem[]): void {
  const lis = ol.querySelectorAll(":scope > li");
  lis.forEach((li) => {
    const a = li.querySelector("a");
    if (a) {
      const href = a.getAttribute("href") || "";
      const label = a.textContent?.trim();
      const item: TocItem = { href, label };
      
      const nestedOl = li.querySelector(":scope > ol");
      if (nestedOl) {
        item.subitems = [];
        parseNavList(nestedOl, item.subitems);
      }
      
      items.push(item);
    }
  });
}

/**
 * Parse EPUB 2 navigation document (toc.ncx)
 */
function parseTocNcx(ncxXml: string): Navigation {
  const parser = new DOMParser();
  const doc = parser.parseFromString(ncxXml, "text/xml");
  
  const toc: TocItem[] = [];
  const navMap = doc.querySelector("navMap");
  
  if (navMap) {
    const navPoints = navMap.querySelectorAll("navPoint");
    navPoints.forEach((navPoint) => {
      const item = parseNavPoint(navPoint);
      if (item) {
        toc.push(item);
      }
    });
  }
  
  return { toc };
}

function parseNavPoint(navPoint: Element): TocItem | null {
  const navLabel = navPoint.querySelector("navLabel");
  const content = navPoint.querySelector("content");
  
  if (!navLabel || !content) {
    return null;
  }
  
  const label = navLabel.querySelector("text")?.textContent?.trim();
  const href = content.getAttribute("src") || "";
  
  const item: TocItem = { href, label };
  
  const subNavPoints = navPoint.querySelectorAll(":scope > navPoint");
  if (subNavPoints.length > 0) {
    item.subitems = [];
    subNavPoints.forEach((subNavPoint) => {
      const subItem = parseNavPoint(subNavPoint);
      if (subItem) {
        item.subitems!.push(subItem);
      }
    });
  }
  
  return item;
}

/**
 * Find the content.opf file in the EPUB
 */
async function findContentOpfPath(zip: JSZip): Promise<string | null> {
  // Check for container.xml first
  const containerXml = zip.file("META-INF/container.xml");
  if (containerXml) {
    const xml = await containerXml.async("string");
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const rootfile = doc.querySelector("rootfile[media-type='application/oebps-package+xml']");
    const fullPath = rootfile?.getAttribute("full-path");
    return fullPath || null;
  }
  
  // Fallback: look for content.opf in common locations
  const commonPaths = [
    "OEBPS/content.opf",
    "content.opf",
    "OEBPS/package.opf",
    "package.opf",
  ];
  
  for (const path of commonPaths) {
    if (zip.file(path)) {
      return path;
    }
  }
  
  return null;
}

/**
 * Parse an EPUB file and return a book object
 */
export async function parseEpub(buffer: ArrayBuffer): Promise<EpubBook> {
  const zip = await JSZip.loadAsync(buffer);
  
  // Find content.opf
  const opfPath = await findContentOpfPath(zip);
  if (!opfPath) {
    throw new Error("Could not find content.opf in EPUB");
  }
  
  // Load and parse content.opf
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error(`content.opf not found at ${opfPath}`);
  }
  
  const opfXml = await opfFile.async("string");
  const { metadata, spine, manifest } = parseContentOpf(opfXml);
  
  // Parse navigation
  const navigation = await parseNavigation(zip, manifest);
  
  // Determine OEBPS base path
  const oebpsBase = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "OEBPS/";
  
  // Create book object
  const book: EpubBook = {
    metadata,
    navigation,
    spine,
    manifest,
    zip,
    
    async load(href: string): Promise<string> {
      // Normalize href - remove leading slash and OEBPS/ if present
      let normalizedHref = href.replace(/^\/+/, "");
      if (normalizedHref.startsWith("OEBPS/")) {
        normalizedHref = normalizedHref.substring(6);
      }
      
      // Resolve relative to OEBPS base
      const fullPath = normalizedHref.startsWith(oebpsBase) 
        ? normalizedHref 
        : `${oebpsBase}${normalizedHref}`;
      
      let file = zip.file(fullPath);
      
      // Try alternative paths if primary path fails
      if (!file) {
        const alternatives = [
          `OEBPS/${normalizedHref}`,
          normalizedHref,
          href,
          href.replace(/^\/+/, ""),
        ];
        
        for (const alt of alternatives) {
          file = zip.file(alt);
          if (file) {
            console.debug(`[EPUB Parser] File found at alternative path: ${alt} (requested: ${href}, primary: ${fullPath})`);
            break;
          }
        }
      }
      
      if (!file) {
        // Log available files for debugging (first 20 files that contain the href)
        const availableFiles = Object.keys(zip.files)
          .filter(name => name.toLowerCase().includes(normalizedHref.toLowerCase()))
          .slice(0, 20);
        
        throw new Error(
          `File not found in EPUB: ${fullPath} (resolved from ${href}). ` +
          `Available similar files: ${availableFiles.join(", ")}`
        );
      }
      
      return await file.async("string");
    },
    
    async getFile(href: string): Promise<ArrayBuffer | null> {
      // Normalize href - remove leading slash and OEBPS/ if present
      let normalizedHref = href.replace(/^\/+/, "");
      if (normalizedHref.startsWith("OEBPS/")) {
        normalizedHref = normalizedHref.substring(6);
      }
      
      // Resolve relative to OEBPS base
      const fullPath = normalizedHref.startsWith(oebpsBase) 
        ? normalizedHref 
        : `${oebpsBase}${normalizedHref}`;
      
      const file = zip.file(fullPath);
      if (!file) {
        // Try alternative paths for debugging
        const alternatives = [
          `OEBPS/${normalizedHref}`,
          normalizedHref,
          href,
        ];
        for (const alt of alternatives) {
          if (zip.file(alt)) {
            console.warn(`[EPUB Parser] File found at alternative path: ${alt} (requested: ${href}, resolved: ${fullPath})`);
            return await zip.file(alt)!.async("arraybuffer");
          }
        }
        // Log at debug level for optional files (like SMIL), error level for required files
        const isOptionalFile = href.endsWith('.smil') || href.includes('smil');
        if (isOptionalFile) {
          console.debug(`[EPUB Parser] Optional file not found: ${href}`, {
            normalizedHref,
            fullPath,
            oebpsBase,
          });
        } else {
          console.error(`[EPUB Parser] File not found: ${href}`, {
            normalizedHref,
            fullPath,
            oebpsBase,
            alternatives: alternatives.map(alt => ({ path: alt, exists: !!zip.file(alt) })),
          });
        }
        return null;
      }
      
      return await file.async("arraybuffer");
    },
    
    resolve(href: string): string {
      // Normalize href - remove leading slash
      let normalizedHref = href.replace(/^\/+/, "");
      
      // If it already has OEBPS/, return as-is
      if (normalizedHref.startsWith("OEBPS/")) {
        return normalizedHref;
      }
      
      // Otherwise, prepend OEBPS base
      return normalizedHref.startsWith(oebpsBase) 
        ? normalizedHref 
        : `${oebpsBase}${normalizedHref}`;
    },
    
    async createUrl(href: string): Promise<string> {
      const buffer = await this.getFile(href);
      if (!buffer) {
        throw new Error(`File not found: ${href}`);
      }
      
      // Validate buffer is not empty
      if (buffer.byteLength === 0) {
        throw new Error(`File is empty: ${href}`);
      }
      
      // Determine MIME type based on file extension
      // First try to find it in manifest
      let mimeType: string | undefined;
      const manifestItem = Object.values(this.manifest).find(item => item.href === href);
      if (manifestItem?.type) {
        mimeType = manifestItem.type;
      } else {
        // Fallback to extension-based detection
        if (href.endsWith(".mp3")) {
          mimeType = "audio/mpeg";
        } else if (href.endsWith(".wav")) {
          mimeType = "audio/wav";
        } else if (href.endsWith(".m4a")) {
          mimeType = "audio/mp4";
        } else if (href.endsWith(".png")) {
          mimeType = "image/png";
        } else if (href.endsWith(".jpg") || href.endsWith(".jpeg")) {
          mimeType = "image/jpeg";
        } else if (href.endsWith(".gif")) {
          mimeType = "image/gif";
        } else if (href.endsWith(".webp")) {
          mimeType = "image/webp";
        } else if (href.endsWith(".svg")) {
          mimeType = "image/svg+xml";
        }
      }
      
      const blob = new Blob([buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      console.debug("[EPUB Parser] Created blob URL", {
        href,
        bufferSize: buffer.byteLength,
        mimeType,
        url: url.substring(0, 50) + "...",
      });
      
      return url;
    },
  };
  
  return book;
}

