import type { DcinsideClient } from "./client.js";
import { parseComments } from "./parser.js";
import { getPost, type PostReference } from "./post.js";
import type { Comment } from "./types.js";

export interface GetCommentsOptions extends PostReference {
  maxPages?: number;
}

export async function getComments(client: DcinsideClient, options: GetCommentsOptions): Promise<Comment[]> {
  const post = await getPost(client, options);
  if (!post.commentToken) throw new Error("Failed to fetch comments: comment token was not found");

  const maxPages = options.maxPages ?? 10;
  const firstData = await client.getCommentsData(
    post.galleryId ?? "",
    post.id,
    post.galleryType,
    post.commentToken,
    1,
    "D",
    post.url,
  );
  const firstPage = parseComments(firstData, post.id, 1);
  const comments = [...firstPage.comments];
  const pagesToRead = Math.min(firstPage.totalPages, maxPages);

  for (let page = 2; page <= pagesToRead; page += 1) {
    const data = await client.getCommentsData(
      post.galleryId ?? "",
      post.id,
      post.galleryType,
      post.commentToken,
      page,
      "D",
      post.url,
    );
    comments.push(...parseComments(data, post.id, page).comments);
  }

  const unique = new Map<string, Comment>();
  const withoutId: Comment[] = [];
  for (const comment of comments) {
    if (comment.id) unique.set(comment.id, comment);
    else withoutId.push(comment);
  }
  const result = [...unique.values(), ...withoutId];
  client.logger.debug("comments parsed", { postId: post.id, count: result.length, pages: pagesToRead });
  return result;
}
