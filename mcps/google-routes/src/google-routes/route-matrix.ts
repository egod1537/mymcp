import type { GoogleRoutesClient } from "./client.js";
import { normalizeLocation, normalizeMatrixElement } from "./normalize.js";
import type {
  ComputeRouteMatrixInput,
  ComputeRouteMatrixResult,
  GoogleComputeRouteMatrixRequest,
  RouteLocation,
} from "./types.js";
import {
  computeRouteMatrixInputSchema,
  readPositiveInteger,
  validateMatrixSize,
  validateWaypointFieldCount,
} from "../utils/validation.js";

export const ROUTE_MATRIX_FIELD_MASK = [
  "originIndex",
  "destinationIndex",
  "distanceMeters",
  "duration",
  "condition",
  "status",
].join(",");

export interface RouteMatrixOptions {
  maxElements?: number;
}

const GOOGLE_MAX_MATRIX_ELEMENTS = 625;
const GOOGLE_MAX_TRANSIT_MATRIX_ELEMENTS = 100;

function buildMatrix(
  originsCount: number,
  destinationsCount: number,
  elements: ComputeRouteMatrixResult["elements"],
): Array<Array<number | null>> {
  const matrix = Array.from({ length: originsCount }, () =>
    Array<number | null>(destinationsCount).fill(null),
  );
  for (const element of elements) {
    if (
      element.originIndex >= 0 &&
      element.originIndex < originsCount &&
      element.destinationIndex >= 0 &&
      element.destinationIndex < destinationsCount
    ) {
      matrix[element.originIndex]![element.destinationIndex] = element.durationSeconds ?? null;
    }
  }
  return matrix;
}

export async function computeRouteMatrix(
  client: GoogleRoutesClient,
  rawInput: ComputeRouteMatrixInput,
  options: RouteMatrixOptions = {},
): Promise<ComputeRouteMatrixResult> {
  const input = computeRouteMatrixInputSchema.parse(rawInput) as ComputeRouteMatrixInput;
  const configuredMaxElements = options.maxElements ?? readPositiveInteger(
    process.env.GOOGLE_ROUTES_MAX_MATRIX_ELEMENTS,
    100,
    "GOOGLE_ROUTES_MAX_MATRIX_ELEMENTS",
  );
  const travelMode = input.travelMode ?? "DRIVE";
  const googleMaximum = travelMode === "TRANSIT"
    ? GOOGLE_MAX_TRANSIT_MATRIX_ELEMENTS
    : GOOGLE_MAX_MATRIX_ELEMENTS;
  const maxElements = Math.min(configuredMaxElements, googleMaximum);
  validateMatrixSize(input.origins.length, input.destinations.length, maxElements);
  validateWaypointFieldCount([...input.origins, ...input.destinations] as RouteLocation[]);

  const request: GoogleComputeRouteMatrixRequest = {
    origins: input.origins.map((waypoint) => ({ waypoint: normalizeLocation(waypoint) })),
    destinations: input.destinations.map((waypoint) => ({ waypoint: normalizeLocation(waypoint) })),
    travelMode,
    ...(input.departureTime !== undefined && { departureTime: input.departureTime }),
    ...(input.departureTime !== undefined && travelMode === "DRIVE" && {
      routingPreference: "TRAFFIC_AWARE" as const,
    }),
  };

  const response = await client.computeRouteMatrix(request, ROUTE_MATRIX_FIELD_MASK);
  const elements = response.map(normalizeMatrixElement);
  return {
    originsCount: input.origins.length,
    destinationsCount: input.destinations.length,
    elements,
    durationsSeconds: buildMatrix(input.origins.length, input.destinations.length, elements),
  };
}
