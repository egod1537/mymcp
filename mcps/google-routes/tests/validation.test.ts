import { describe, expect, it } from "vitest";
import { COMPUTE_ROUTE_FIELD_MASK, TRAVEL_TIME_FIELD_MASK } from "../src/google-routes/compute-route.js";
import { ROUTE_MATRIX_FIELD_MASK } from "../src/google-routes/route-matrix.js";
import {
  isValidRfc3339,
  validateMatrixSize,
  validateWaypointFieldCount,
} from "../src/utils/validation.js";

describe("RFC3339 validation", () => {
  it("accepts timestamps with Z or an offset", () => {
    expect(isValidRfc3339("2026-10-10T10:00:00+09:00")).toBe(true);
    expect(isValidRfc3339("2026-10-10T01:00:00.123Z")).toBe(true);
  });

  it("rejects loose or impossible dates", () => {
    expect(isValidRfc3339("2026-10-10 10:00:00")).toBe(false);
    expect(isValidRfc3339("2026-02-30T10:00:00+09:00")).toBe(false);
  });
});

describe("cost limits", () => {
  it("rejects route matrices before they exceed the configured limit", () => {
    expect(validateMatrixSize(10, 10, 100)).toBe(100);
    expect(() => validateMatrixSize(12, 12, 100)).toThrow(
      "Route matrix request is too large: 144 elements requested, maximum is 100.",
    );
  });

  it("enforces Google's combined address/place ID waypoint limit", () => {
    const locations = Array.from({ length: 51 }, (_, index) => ({ address: `Place ${index}` }));
    expect(() => validateWaypointFieldCount(locations)).toThrow("Google allows at most 50");
  });
});

describe("field masks", () => {
  it("keeps travel-time requests minimal", () => {
    expect(TRAVEL_TIME_FIELD_MASK).toBe("routes.distanceMeters,routes.duration");
    expect(TRAVEL_TIME_FIELD_MASK).not.toContain("polyline");
  });

  it("requests indexes and status for matrix responses", () => {
    expect(ROUTE_MATRIX_FIELD_MASK.split(",")).toEqual([
      "originIndex",
      "destinationIndex",
      "distanceMeters",
      "duration",
      "condition",
      "status",
    ]);
    expect(COMPUTE_ROUTE_FIELD_MASK).toContain("routes.polyline.encodedPolyline");
  });
});
