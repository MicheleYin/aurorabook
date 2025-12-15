declare module "epubjs" {
  export interface EpubMetadata {
    title?: string;
    creator?: string;
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

  export interface Book {
    ready: Promise<void>;
    loaded: {
      metadata: Promise<EpubMetadata>;
      navigation: Promise<Navigation>;
      spine: Promise<Spine>;
    };
    load: (href: string) => Promise<string>;
    coverUrl: () => Promise<string | null | undefined>;
  }

  export default function ePub(
    data: ArrayBuffer | Uint8Array | string,
  ): Book;
}

