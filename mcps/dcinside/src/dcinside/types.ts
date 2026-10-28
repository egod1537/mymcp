export const galleryTypes = ["major", "minor", "mini"] as const;
export type GalleryType = (typeof galleryTypes)[number];

export const searchTargets = ["title", "title_content"] as const;
export type SearchTarget = (typeof searchTargets)[number];

export interface GalleryPostSummary {
  id: string;
  title: string;
  author?: string;
  date?: string;
  views?: number;
  recommendations?: number;
  comments?: number;
  url: string;
  isNotice?: boolean;
}

export interface GalleryPostList {
  galleryId: string;
  page: number;
  posts: GalleryPostSummary[];
}

export interface SearchResult {
  galleryId: string;
  query: string;
  posts: GalleryPostSummary[];
}

export interface Post {
  id: string;
  galleryId?: string;
  title: string;
  author?: string;
  date?: string;
  views?: number;
  recommendations?: number;
  content: string;
  imageUrls?: string[];
  links?: string[];
  url: string;
}

export interface ParsedPost extends Post {
  galleryType: GalleryType;
  commentToken: string;
}

export interface Comment {
  id?: string;
  author?: string;
  content: string;
  date?: string;
  depth?: number;
  parentId?: string;
  isDeleted?: boolean;
}

export interface ParsedGalleryPage extends GalleryPostList {
  galleryName: string;
  galleryType: GalleryType;
  nextPage?: number;
  nextSearchPosition?: string;
}

export interface ParsedCommentPage {
  postId: string;
  page: number;
  totalCount: number;
  totalPages: number;
  comments: Comment[];
}

export interface PostWithComments {
  post: Post;
  comments: Comment[];
}
