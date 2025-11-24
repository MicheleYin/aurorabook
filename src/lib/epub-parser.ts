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
 * Parse content.opf XML to extract metadata, spine, and manifest
 */
function parseContentOpf(opfXml: string): {
  metadata: EpubMetadata;
  spine: Spine;
  manifest: Record<string, ManifestItem>;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opfXml, "text/xml");
  
  // Check for parsing errors
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error(`Failed to parse content.opf: ${parserError.textContent}`);
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
      if (id && href) {
        manifest[id] = {
          id,
          href,
          type: type || undefined,
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
function findContentOpfPath(zip: JSZip): string | null {
  // Check for container.xml first
  const containerXml = zip.file("META-INF/container.xml");
  if (containerXml) {
    return containerXml.async("string").then((xml) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, "text/xml");
      const rootfile = doc.querySelector("rootfile[media-type='application/oebps-package+xml']");
      const fullPath = rootfile?.getAttribute("full-path");
      return fullPath || null;
    });
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
      return Promise.resolve(path);
    }
  }
  
  return Promise.resolve(null);
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
      
      const file = zip.file(fullPath);
      if (!file) {
        throw new Error(`File not found in EPUB: ${fullPath} (resolved from ${href})`);
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
      
      const blob = new Blob([buffer]);
      return URL.createObjectURL(blob);
    },
  };
  
  return book;
}

