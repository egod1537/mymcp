import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { DcinsideClient } from "../dcinside/client.js";
import { searchTargets } from "../dcinside/types.js";

export function registerSearchGalleryPosts(server: McpServer, client: DcinsideClient): void {
  server.registerTool("search_gallery_posts", {
    title: "Search DCInside gallery posts",
    description: "Search posts in a specific DCInside gallery. Use this when the user wants posts about a keyword, topic, place, event, product, or other subject within that gallery. Traverses up to maxPages, follows DCInside search ranges, and removes duplicate post IDs. Returns post IDs, titles, dates, authors, counts, and URLs.",
    inputSchema: {
      galleryId: z.string().min(1).max(80),
      query: z.string().min(1).max(100),
      page: z.number().int().min(1).max(10000).default(1),
      maxPages: z.number().int().min(1).max(10).default(3),
      searchTarget: z.enum(searchTargets).default("title_content"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ galleryId, query, page, maxPages, searchTarget }) => {
    client.logger.debug("tool called", { tool: "search_gallery_posts", galleryId, page, maxPages, searchTarget });
    const result = await client.searchGalleryPosts({ galleryId, query, page, maxPages, searchTarget });
    const structuredContent = { ...result };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
