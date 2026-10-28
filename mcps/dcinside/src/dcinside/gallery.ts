import type { DcinsideClient } from "./client.js";
import { parseGalleryPosts } from "./parser.js";
import type { GalleryPostList } from "./types.js";

export interface GetGalleryPostsOptions {
  galleryId: string;
  page?: number;
  limit?: number;
}

export async function getGalleryPosts(
  client: DcinsideClient,
  options: GetGalleryPostsOptions,
): Promise<GalleryPostList> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const galleryType = await client.detectGalleryType(options.galleryId);
  const query = new URLSearchParams({ id: options.galleryId, page: String(page) });
  const html = await client.getGalleryHtml(galleryType, query);
  const parsed = parseGalleryPosts(html, options.galleryId, galleryType, page);
  const result = { galleryId: options.galleryId, page, posts: parsed.posts.slice(0, limit) };
  client.logger.debug("gallery page parsed", { galleryId: options.galleryId, page, count: result.posts.length });
  return result;
}
