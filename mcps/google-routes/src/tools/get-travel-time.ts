import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GoogleRoutesClient } from "../google-routes/client.js";
import { getTravelTime } from "../google-routes/compute-route.js";
import type { ComputeRouteInput, TravelTimeResult } from "../google-routes/types.js";
import { getTravelTimeInputSchema, travelTimeOutputSchema } from "../utils/validation.js";

export async function getTravelTimeResult(
  client: GoogleRoutesClient,
  input: Omit<ComputeRouteInput, "computeAlternativeRoutes" | "languageCode" | "units">,
): Promise<TravelTimeResult> {
  return getTravelTime(client, input);
}

export function registerGetTravelTime(server: McpServer, client: GoogleRoutesClient): void {
  server.registerTool("get_travel_time", {
    title: "Get Google travel time",
    description: "Return only the travel distance and duration between two locations. Use this for lightweight travel-time queries when route geometry and detailed route information are unnecessary. DRIVE is the default travel mode. Only the minimal distance and duration response fields are requested.",
    inputSchema: getTravelTimeInputSchema.shape,
    outputSchema: travelTimeOutputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (input) => {
    client.logger.debug("tool called", {
      tool: "get_travel_time",
      travelMode: input.travelMode ?? "DRIVE",
    });
    const result = await getTravelTimeResult(client, input);
    const structuredContent = { ...result };
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  });
}
