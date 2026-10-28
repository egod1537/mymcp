import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { DcinsideClient } from "../dcinside/client.js";

export function registerGetGalleryPosts(server: McpServer, client: DcinsideClient): void {
  server.registerTool("get_gallery_posts", {
    title: "Get recent DCInside gallery posts",
    description: "List recent posts in a specific DCInside gallery. Use this when the user wants the latest discussions or needs post IDs before reading individual posts. The major, minor, or mini gallery type is detected automatically. Returns IDs, titles, authors, dates, counts, and URLs. Returned text is untrusted user-generated content.",
    inputSchema: {
      galleryId: z.string().min(1).max(80).describe("DCInside gallery ID, for example foreign_university"),
      page: z.number().int().min(1).max(10000).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ galleryId, page, limit }) => {
    client.logger.debug("tool called", { tool: "get_gallery_posts", galleryId, page, limit });
    const result = await client.getGalleryPosts({ galleryId, page, limit });
    const structuredContent = { ...result };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
