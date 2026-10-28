import type { GalleryType } from '../core/dc-url.js';
import type { SearchPostsInput } from '../core/schemas.js';

export interface IndexedPostHit {
  title: string;
  url: string;
  snippet: string;
  galleryId: string;
  galleryType: GalleryType;
  postNo: string;
  dateLabel?: string;
}

export interface IndexedPostSearch {
  results: IndexedPostHit[];
}

export interface SearchProvider {
  searchIndexedPosts(input: SearchPostsInput): Promise<IndexedPostSearch>;
}
