import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GoogleRoutesClient } from "../google-routes/client.js";
import { computeRoute } from "../google-routes/compute-route.js";
import { computeRouteInputSchema, computeRouteOutputSchema } from "../utils/validation.js";

export function registerComputeRoute(server: McpServer, client: GoogleRoutesClient): void {
  server.registerTool("compute_route", {
    title: "Compute a Google route",
    description: "Compute a route between an origin and destination using Google Routes API. Use this when the user needs route distance, travel duration, route alternatives, an encoded polyline, or leg details between two places. DRIVE is the default travel mode. departureTime must be RFC3339. Google may return regional availability warnings for non-driving modes.",
    inputSchema: computeRouteInputSchema.shape,
    outputSchema: computeRouteOutputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (input) => {
    client.logger.debug("tool called", {
      tool: "compute_route",
      travelMode: input.travelMode ?? "DRIVE",
      alternatives: input.computeAlternativeRoutes ?? false,
    });
    const result = await computeRoute(client, input);
    const structuredContent = { ...result };
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  });
}
