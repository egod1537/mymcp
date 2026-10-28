import { describe, expect, it } from "vitest";
import routeFixture from "./fixtures/compute-routes.json" with { type: "json" };
import matrixFixture from "./fixtures/route-matrix.json" with { type: "json" };
import {
  locationsAreExactlyEqual,
  normalizeLocation,
  normalizeMatrixElement,
  normalizeRoutesResponse,
  parseDurationSeconds,
} from "../src/google-routes/normalize.js";

describe("RouteLocation normalization", () => {
  it("normalizes addresses, coordinates, and place IDs", () => {
    expect(normalizeLocation({ address: "  Seoul Station  " })).toEqual({ address: "Seoul Station" });
    expect(normalizeLocation({ lat: 37.5547, lng: 126.9707 })).toEqual({
      location: { latLng: { latitude: 37.5547, longitude: 126.9707 } },
    });
    expect(normalizeLocation({ placeId: " ChIJfixture " })).toEqual({ placeId: "ChIJfixture" });
  });

  it("only treats exact coordinates or place IDs as identical", () => {
    expect(locationsAreExactlyEqual({ placeId: "same" }, { placeId: "same" })).toBe(true);
    expect(locationsAreExactlyEqual({ lat: 1, lng: 2 }, { lat: 1, lng: 2 })).toBe(true);
    expect(locationsAreExactlyEqual({ address: "same" }, { address: "same" })).toBe(false);
  });
});

describe("duration normalization", () => {
  it("converts protobuf duration strings to seconds", () => {
    expect(parseDurationSeconds("1234s")).toBe(1234);
    expect(parseDurationSeconds("3.500s")).toBe(3.5);
    expect(parseDurationSeconds("-0.25s")).toBe(-0.25);
    expect(parseDurationSeconds(undefined)).toBeUndefined();
  });

  it("rejects malformed durations", () => {
    expect(() => parseDurationSeconds("10 minutes")).toThrow("Invalid Google duration");
  });
});

describe("Google response normalization", () => {
  it("normalizes route fields from a fixture", () => {
    const routes = normalizeRoutesResponse(routeFixture);
    expect(routes[0]).toMatchObject({
      distanceMeters: 5120,
      durationSeconds: 1740,
      staticDurationSeconds: 1500.5,
      polyline: "fixture-polyline",
      description: "Main Street",
      legs: [{
        distanceMeters: 5120,
        durationSeconds: 1740,
        startLocation: { lat: 37.5547, lng: 126.9707 },
      }],
    });
  });

  it("retains matrix indexes and per-element status", () => {
    const elements = matrixFixture.map(normalizeMatrixElement);
    expect(elements[0]).toMatchObject({ originIndex: 1, destinationIndex: 0, durationSeconds: 420 });
    expect(elements[2]).toEqual({
      originIndex: 0,
      destinationIndex: 1,
      condition: "ROUTE_NOT_FOUND",
      status: { code: 5, message: "No route found" },
    });
  });
});
