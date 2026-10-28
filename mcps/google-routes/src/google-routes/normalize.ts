import type {
  GoogleComputeRoutesResponse,
  GoogleLatLng,
  GoogleRouteMatrixElement,
  GoogleWaypoint,
  RouteCoordinates,
  RouteLocation,
  RouteMatrixElement,
  RouteResult,
} from "./types.js";
import { ValidationError } from "../utils/validation.js";

const DURATION_PATTERN = /^(?<sign>-?)(?<seconds>\d+)(?:\.(?<fraction>\d{1,9}))?s$/;

export function normalizeLocation(location: RouteLocation): GoogleWaypoint {
  if ("address" in location) {
    return { address: location.address.trim() };
  }

  if ("placeId" in location) {
    return { placeId: location.placeId.trim() };
  }

  return {
    location: {
      latLng: {
        latitude: location.lat,
        longitude: location.lng,
      },
    },
  };
}

export function parseDurationSeconds(duration: string | undefined): number | undefined {
  if (duration === undefined) return undefined;

  const match = DURATION_PATTERN.exec(duration);
  if (!match?.groups) {
    throw new ValidationError(`Invalid Google duration: ${duration}`);
  }

  const fraction = match.groups.fraction ?? "";
  const seconds = Number(match.groups.seconds) + (fraction ? Number(`0.${fraction}`) : 0);
  return match.groups.sign === "-" ? -seconds : seconds;
}

function normalizeCoordinates(latLng: GoogleLatLng | undefined): RouteCoordinates | undefined {
  if (!latLng) return undefined;
  return { lat: latLng.latitude, lng: latLng.longitude };
}

export function normalizeRoutesResponse(response: GoogleComputeRoutesResponse): RouteResult[] {
  return (response.routes ?? []).map((route) => ({
    ...(route.distanceMeters !== undefined && { distanceMeters: route.distanceMeters }),
    ...(route.duration !== undefined && {
      durationSeconds: parseDurationSeconds(route.duration),
    }),
    ...(route.staticDuration !== undefined && {
      staticDurationSeconds: parseDurationSeconds(route.staticDuration),
    }),
    ...(route.polyline?.encodedPolyline !== undefined && {
      polyline: route.polyline.encodedPolyline,
    }),
    ...(route.description !== undefined && { description: route.description }),
    ...(route.warnings !== undefined && { warnings: route.warnings }),
    ...(route.legs !== undefined && {
      legs: route.legs.map((leg) => ({
        ...(leg.distanceMeters !== undefined && { distanceMeters: leg.distanceMeters }),
        ...(leg.duration !== undefined && {
          durationSeconds: parseDurationSeconds(leg.duration),
        }),
        ...(leg.startLocation?.latLng !== undefined && {
          startLocation: normalizeCoordinates(leg.startLocation.latLng),
        }),
        ...(leg.endLocation?.latLng !== undefined && {
          endLocation: normalizeCoordinates(leg.endLocation.latLng),
        }),
      })),
    }),
  }));
}

export function normalizeMatrixElement(element: GoogleRouteMatrixElement): RouteMatrixElement {
  if (element.originIndex === undefined || element.destinationIndex === undefined) {
    throw new ValidationError("Google Routes matrix element is missing its indexes.");
  }

  return {
    originIndex: element.originIndex,
    destinationIndex: element.destinationIndex,
    ...(element.distanceMeters !== undefined && { distanceMeters: element.distanceMeters }),
    ...(element.duration !== undefined && {
      durationSeconds: parseDurationSeconds(element.duration),
    }),
    ...(element.condition !== undefined && { condition: element.condition }),
    ...(element.status !== undefined && {
      status: {
        ...(element.status.code !== undefined && { code: element.status.code }),
        ...(element.status.message !== undefined && { message: element.status.message }),
      },
    }),
  };
}

export function locationsAreExactlyEqual(a: RouteLocation, b: RouteLocation): boolean {
  if ("placeId" in a && "placeId" in b) return a.placeId === b.placeId;
  if ("lat" in a && "lat" in b) return a.lat === b.lat && a.lng === b.lng;
  return false;
}
