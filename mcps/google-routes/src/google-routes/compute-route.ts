import type { GoogleRoutesClient } from "./client.js";
import { locationsAreExactlyEqual, normalizeLocation, normalizeRoutesResponse } from "./normalize.js";
import type {
  ComputeRouteInput,
  ComputeRouteResult,
  GoogleComputeRoutesRequest,
  TravelTimeResult,
} from "./types.js";
import { computeRouteInputSchema, UnsupportedRouteError } from "../utils/validation.js";

export const COMPUTE_ROUTE_FIELD_MASK = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.staticDuration",
  "routes.polyline.encodedPolyline",
  "routes.description",
  "routes.warnings",
  "routes.legs.distanceMeters",
  "routes.legs.duration",
  "routes.legs.startLocation.latLng",
  "routes.legs.endLocation.latLng",
].join(",");

export const TRAVEL_TIME_FIELD_MASK = [
  "routes.distanceMeters",
  "routes.duration",
].join(",");

function buildRequest(input: ComputeRouteInput): GoogleComputeRoutesRequest {
  const travelMode = input.travelMode ?? "DRIVE";
  return {
    origin: normalizeLocation(input.origin),
    destination: normalizeLocation(input.destination),
    travelMode,
    ...(input.departureTime !== undefined && { departureTime: input.departureTime }),
    ...(input.departureTime !== undefined && travelMode === "DRIVE" && {
      routingPreference: "TRAFFIC_AWARE" as const,
    }),
    ...(input.computeAlternativeRoutes !== undefined && {
      computeAlternativeRoutes: input.computeAlternativeRoutes,
    }),
    ...(input.languageCode !== undefined && { languageCode: input.languageCode }),
    ...(input.units !== undefined && { units: input.units }),
  };
}

export async function computeRoute(
  client: GoogleRoutesClient,
  rawInput: ComputeRouteInput,
): Promise<ComputeRouteResult> {
  const input = computeRouteInputSchema.parse(rawInput) as ComputeRouteInput;
  if (locationsAreExactlyEqual(input.origin, input.destination)) {
    return { routes: [{ distanceMeters: 0, durationSeconds: 0, staticDurationSeconds: 0 }] };
  }

  const response = await client.computeRoutes(buildRequest(input), COMPUTE_ROUTE_FIELD_MASK);
  const routes = normalizeRoutesResponse(response);
  if (routes.length === 0) {
    throw new UnsupportedRouteError("No route is available for the requested locations and travel mode.");
  }
  return { routes };
}

export async function getTravelTime(
  client: GoogleRoutesClient,
  rawInput: Omit<ComputeRouteInput, "computeAlternativeRoutes" | "languageCode" | "units">,
): Promise<TravelTimeResult> {
  const parsed = computeRouteInputSchema.parse(rawInput) as ComputeRouteInput;
  if (locationsAreExactlyEqual(parsed.origin, parsed.destination)) {
    return { distanceMeters: 0, durationSeconds: 0, durationMinutes: 0 };
  }

  const response = await client.computeRoutes(buildRequest(parsed), TRAVEL_TIME_FIELD_MASK);
  const first = normalizeRoutesResponse(response)[0];
  if (!first) {
    throw new UnsupportedRouteError("No route is available for the requested locations and travel mode.");
  }

  return {
    ...(first.distanceMeters !== undefined && { distanceMeters: first.distanceMeters }),
    ...(first.durationSeconds !== undefined && {
      durationSeconds: first.durationSeconds,
      durationMinutes: first.durationSeconds / 60,
    }),
  };
}
