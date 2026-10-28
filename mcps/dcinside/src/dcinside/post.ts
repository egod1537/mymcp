import type { DcinsideClient } from "./client.js";
import { parsePost } from "./parser.js";
import type { GalleryType, ParsedPost, Post } from "./types.js";

const BASE_URL = "https://gall.dcinside.com";

export interface PostReference {
  galleryId?: string;
  postId?: string;
  url?: string;
}

interface ResolvedPostReference {
  galleryId: string;
  postId: string;
  galleryType: GalleryType;
}

function parsePostUrl(value: string): ResolvedPostReference {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid DCInside post URL");
  }
  if (url.origin !== BASE_URL) throw new Error("URL must use https://gall.dcinside.com");
  const pathTypes: Record<string, GalleryType> = {
    "/board/view/": "major",
    "/mgallery/board/view/": "minor",
    "/mini/board/view/": "mini",
  };
  const galleryType = pathTypes[url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`];
  const galleryId = url.searchParams.get("id") ?? "";
  const postId = url.searchParams.get("no") ?? "";
  if (!galleryType || !galleryId || !/^\d+$/.test(postId)) throw new Error("Invalid DCInside post URL");
  return { galleryId, postId, galleryType };
}

export async function resolvePostReference(
  client: DcinsideClient,
  reference: PostReference,
): Promise<ResolvedPostReference> {
  if (reference.url) {
    const resolved = parsePostUrl(reference.url);
    client.rememberGalleryType(resolved.galleryId, resolved.galleryType);
    return resolved;
  }
  if (!reference.galleryId || !reference.postId || !/^\d+$/.test(reference.postId)) {
    throw new Error("Provide either url or both galleryId and numeric postId");
  }
  return {
    galleryId: reference.galleryId,
    postId: reference.postId,
    galleryType: await client.detectGalleryType(reference.galleryId),
  };
}

export async function getPost(client: DcinsideClient, reference: PostReference): Promise<ParsedPost> {
  const resolved = await resolvePostReference(client, reference);
  const { html, url } = await client.getPostHtml(resolved.galleryId, resolved.postId, resolved.galleryType);
  const result = parsePost(html, resolved.galleryId, resolved.galleryType, resolved.postId, url);
  client.logger.debug("post parsed", { galleryId: resolved.galleryId, postId: resolved.postId });
  return result;
}

export function toPublicPost(post: ParsedPost): Post {
  const { commentToken: _commentToken, galleryType: _galleryType, ...result } = post;
  return result;
}
