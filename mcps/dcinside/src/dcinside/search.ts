import type { DcinsideClient } from "./client.js";
import { parseGalleryPosts } from "./parser.js";
import type { GalleryPostSummary, SearchResult, SearchTarget } from "./types.js";

const searchParameters: Record<SearchTarget, string> = {
  title: "search_subject",
  title_content: "search_subject_memo",
};

export interface SearchGalleryPostsOptions {
  galleryId: string;
  query: string;
  page?: number;
  maxPages?: number;
  searchTarget?: SearchTarget;
}

export async function searchGalleryPosts(
  client: DcinsideClient,
  options: SearchGalleryPostsOptions,
): Promise<SearchResult> {
  const galleryType = await client.detectGalleryType(options.galleryId);
  const maxPages = options.maxPages ?? 3;
  let page = options.page ?? 1;
  let searchPosition: string | undefined;
  const posts = new Map<string, GalleryPostSummary>();

  for (let scanned = 0; scanned < maxPages; scanned += 1) {
    const parameters = new URLSearchParams({
      id: options.galleryId,
      page: String(page),
      s_type: searchParameters[options.searchTarget ?? "title_content"],
      s_keyword: options.query,
    });
    if (searchPosition) parameters.set("search_pos", searchPosition);

    const html = await client.getGalleryHtml(galleryType, parameters);
    const parsed = parseGalleryPosts(html, options.galleryId, galleryType, page);
    for (const post of parsed.posts) posts.set(post.id, post);
    client.logger.debug("search page parsed", {
      galleryId: options.galleryId,
      page,
      searchPosition,
      count: parsed.posts.length,
    });

    if (parsed.nextPage !== undefined) {
      page = parsed.nextPage;
      continue;
    }
    if (parsed.nextSearchPosition && parsed.nextSearchPosition !== searchPosition) {
      searchPosition = parsed.nextSearchPosition;
      page = 1;
      continue;
    }
    break;
  }

  return { galleryId: options.galleryId, query: options.query, posts: [...posts.values()] };
}
