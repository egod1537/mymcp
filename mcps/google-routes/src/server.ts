import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GoogleRoutesClient } from "./google-routes/client.js";
import { registerCompareTravelModes } from "./tools/compare-travel-modes.js";
import { registerComputeRouteMatrix } from "./tools/compute-route-matrix.js";
import { registerComputeRoute } from "./tools/compute-route.js";
import { registerGetTravelTime } from "./tools/get-travel-time.js";

export function createServer(client = new GoogleRoutesClient()): McpServer {
  const server = new McpServer({
    name: "@mymcp/google-routes",
    version: "0.1.0",
  }, {
    instructions: "Use get_travel_time for a lightweight point-to-point answer, compute_route for alternatives or route detail, compare_travel_modes for mode comparisons, and compute_route_matrix for itinerary optimization. All tools are read-only but call a billable Google Maps Platform API. Never invent a route when Google reports that a mode or route is unavailable.",
  });

  registerComputeRoute(server, client);
  registerComputeRouteMatrix(server, client);
  registerCompareTravelModes(server, client);
  registerGetTravelTime(server, client);
  return server;
}
