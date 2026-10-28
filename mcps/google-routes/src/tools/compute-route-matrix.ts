import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GoogleRoutesClient } from "../google-routes/client.js";
import { computeRouteMatrix } from "../google-routes/route-matrix.js";
import { computeRouteMatrixInputSchema, routeMatrixOutputSchema } from "../utils/validation.js";

export function registerComputeRouteMatrix(server: McpServer, client: GoogleRoutesClient): void {
  server.registerTool("compute_route_matrix", {
    title: "Compute a Google route matrix",
    description: "Compute travel distances and durations between multiple origins and destinations. Use this for itinerary optimization, travel-time matrices, TSP-style planning, or comparing travel costs between many locations. The result retains Google's originIndex and destinationIndex and also includes a durationsSeconds matrix. The request is rejected before calling Google when origins × destinations exceeds the configured limit (100 by default).",
    inputSchema: computeRouteMatrixInputSchema.shape,
    outputSchema: routeMatrixOutputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (input) => {
    client.logger.debug("tool called", {
      tool: "compute_route_matrix",
      travelMode: input.travelMode ?? "DRIVE",
      originsCount: input.origins.length,
      destinationsCount: input.destinations.length,
      matrixElements: input.origins.length * input.destinations.length,
    });
    const result = await computeRouteMatrix(client, input);
    const structuredContent = { ...result };
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  });
}
