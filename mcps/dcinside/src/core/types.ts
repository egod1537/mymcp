import type { GalleryType, ParsedPostUrl } from './dc-url.js';

export type DataSource = 'brave_index' | 'user_import' | 'deep_search_export' | 'authorized_direct';

export interface NormalizedComment {
  commentId?: string;
  parentCommentId?: string;
  text: string;
  postedAt?: string;
}

export interface Provenance {
  source: DataSource;
  capturedAt: string;
  provider?: string;
  parserVersion?: string;
}

export interface NormalizedPost extends ParsedPostUrl {
  title: string;
  bodyText: string;
  note?: string;
  imageUrls?: string[];
  authoredAt?: string;
  dateLabel?: string;
  metrics?: { views?: number; recommends?: number; dislikes?: number };
  comments?: { total?: number; items: NormalizedComment[]; partial: boolean };
  provenance: Provenance;
  contentAvailable: boolean;
}

export interface NormalizedPostSummary extends ParsedPostUrl {
  title: string;
  dateLabel?: string;
  commentCount?: number;
  views?: number;
  recommends?: number;
  matchedKeywords?: string[];
  snippet?: string;
  provenance: Provenance;
}

export interface RemoteReadProvider {
  readonly id: 'dcinside-js';
  listGalleryPosts(input: {
    galleryId: string;
    galleryType?: GalleryType;
    page: number;
    boardType: 'all' | 'recommend' | 'notice';
  }): Promise<NormalizedPostSummary[]>;
  getPost(input: ParsedPostUrl): Promise<NormalizedPost | null>;
  search?(input: {
    query: string;
    sort: 'relevance' | 'latest';
    limit: number;
    galleryId?: string;
    galleryType?: GalleryType;
  }): Promise<NormalizedPostSummary[]>;
}
