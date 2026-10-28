import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { DcinsideClient } from "../dcinside/client.js";

export function registerGetComments(server: McpServer, client: DcinsideClient): void {
  server.registerTool("get_comments", {
    title: "Get DCInside post comments",
    description: "Retrieve comments and replies for a DCInside post. Use this when community reactions, opinions, corrections, recommendations, or follow-up discussion are important. Provide either url, or both galleryId and postId. Reply depth and parent IDs are preserved when available.",
    inputSchema: {
      galleryId: z.string().min(1).max(80).optional(),
      postId: z.string().regex(/^\d+$/).optional(),
      url: z.string().url().optional(),
      maxPages: z.number().int().min(1).max(20).default(10),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ galleryId, postId, url, maxPages }) => {
    client.logger.debug("tool called", { tool: "get_comments", galleryId, postId, hasUrl: Boolean(url), maxPages });
    const comments = await client.getComments({ galleryId, postId, url, maxPages });
    const structuredContent = { comments };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
