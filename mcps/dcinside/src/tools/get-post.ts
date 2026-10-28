import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { DcinsideClient } from "../dcinside/client.js";
import { toPublicPost } from "../dcinside/post.js";

export function registerGetPost(server: McpServer, client: DcinsideClient): void {
  server.registerTool("get_post", {
    title: "Get a DCInside post",
    description: "Retrieve the full contents of a DCInside post. Use this after discovering a relevant post through search_gallery_posts or get_gallery_posts. Provide either url, or both galleryId and postId. Returns readable plain text while retaining line breaks, quotes, links, and media URLs.",
    inputSchema: {
      galleryId: z.string().min(1).max(80).optional(),
      postId: z.string().regex(/^\d+$/).optional(),
      url: z.string().url().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ galleryId, postId, url }) => {
    client.logger.debug("tool called", { tool: "get_post", galleryId, postId, hasUrl: Boolean(url) });
    const result = toPublicPost(await client.getPost({ galleryId, postId, url }));
    const structuredContent = { ...result };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
