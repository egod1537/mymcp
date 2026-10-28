import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { DcinsideClient } from "../dcinside/client.js";
import { toPublicPost } from "../dcinside/post.js";
import type { PostWithComments } from "../dcinside/types.js";

export function registerGetPostWithComments(server: McpServer, client: DcinsideClient): void {
  server.registerTool("get_post_with_comments", {
    title: "Get a DCInside post with comments",
    description: "Retrieve a DCInside post and its comments in one call. Use this when both the original post and community reactions are needed for analysis, comparison, recommendation, or summarization. Provide either url, or both galleryId and postId.",
    inputSchema: {
      galleryId: z.string().min(1).max(80).optional(),
      postId: z.string().regex(/^\d+$/).optional(),
      url: z.string().url().optional(),
      maxCommentPages: z.number().int().min(1).max(20).default(10),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ galleryId, postId, url, maxCommentPages }) => {
    client.logger.debug("tool called", { tool: "get_post_with_comments", galleryId, postId, hasUrl: Boolean(url), maxCommentPages });
    const reference = { galleryId, postId, url };
    const post = toPublicPost(await client.getPost(reference));
    const comments = await client.getComments({ ...reference, maxPages: maxCommentPages });
    const result: PostWithComments = { post, comments };
    const structuredContent = { ...result };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
