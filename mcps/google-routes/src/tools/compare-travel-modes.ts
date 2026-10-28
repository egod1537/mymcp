import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GoogleRoutesClient } from "../google-routes/client.js";
import { getTravelTime } from "../google-routes/compute-route.js";
import type {
  CompareTravelModesResult,
  RouteLocation,
  TravelMode,
  TravelModeComparison,
} from "../google-routes/types.js";
import {
  compareTravelModesInputSchema,
  compareTravelModesOutputSchema,
  errorMessage,
} from "../utils/validation.js";

const DEFAULT_TRAVEL_MODES: TravelMode[] = ["DRIVE", "TRANSIT", "WALK"];

export interface CompareTravelModesInput {
  origin: RouteLocation;
  destination: RouteLocation;
  travelModes?: TravelMode[];
  departureTime?: string;
}

export async function compareTravelModes(
  client: GoogleRoutesClient,
  rawInput: CompareTravelModesInput,
): Promise<CompareTravelModesResult> {
  const input = compareTravelModesInputSchema.parse(rawInput) as CompareTravelModesInput;
  const modes = [...new Set(input.travelModes ?? DEFAULT_TRAVEL_MODES)];

  const results = await Promise.all(modes.map(async (travelMode): Promise<TravelModeComparison> => {
    try {
      const route = await getTravelTime(client, {
        origin: input.origin,
        destination: input.destination,
        travelMode,
        ...(input.departureTime !== undefined && { departureTime: input.departureTime }),
      });
      return {
        travelMode,
        available: true,
        ...(route.distanceMeters !== undefined && { distanceMeters: route.distanceMeters }),
        ...(route.durationSeconds !== undefined && { durationSeconds: route.durationSeconds }),
      };
    } catch (error) {
      return { travelMode, available: false, error: errorMessage(error) };
    }
  }));

  return { results };
}

export function registerCompareTravelModes(server: McpServer, client: GoogleRoutesClient): void {
  server.registerTool("compare_travel_modes", {
    title: "Compare Google travel modes",
    description: "Compare multiple travel modes between the same origin and destination. Use this when the user wants to compare driving, transit, walking, bicycling, or two-wheel travel. Defaults to DRIVE, TRANSIT, and WALK. At most five modes are accepted. Each mode is reported independently, so one unavailable mode does not fail the whole tool.",
    inputSchema: compareTravelModesInputSchema.shape,
    outputSchema: compareTravelModesOutputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (input) => {
    client.logger.debug("tool called", {
      tool: "compare_travel_modes",
      travelModes: input.travelModes ?? DEFAULT_TRAVEL_MODES,
    });
    const result = await compareTravelModes(client, input);
    const structuredContent = { ...result };
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  });
}
