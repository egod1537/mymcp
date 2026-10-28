import { describe, expect, it } from "vitest";
import { GoogleRoutesClient } from "../src/google-routes/client.js";
import { computeRoute, getTravelTime } from "../src/google-routes/compute-route.js";
import { computeRouteMatrix } from "../src/google-routes/route-matrix.js";

const liveEnabled = process.env.RUN_LIVE_TESTS === "1" && Boolean(process.env.GOOGLE_MAPS_API_KEY);

describe.skipIf(!liveEnabled)("Google Routes live integration", () => {
  const client = new GoogleRoutesClient();

  it("computes Seoul Station to Gangnam Station by car", async () => {
    const result = await getTravelTime(client, {
      origin: { address: "Seoul Station, Seoul, South Korea" },
      destination: { address: "Gangnam Station, Seoul, South Korea" },
      travelMode: "DRIVE",
    });
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.durationSeconds).toBeGreaterThan(0);
  });

  it("computes Seoul Station to Gangnam Station by transit", async () => {
    const result = await computeRoute(client, {
      origin: { address: "Seoul Station, Seoul, South Korea" },
      destination: { address: "Gangnam Station, Seoul, South Korea" },
      travelMode: "TRANSIT",
    });
    expect(result.routes[0]?.durationSeconds).toBeGreaterThan(0);
  });

  it("computes a two-by-two matrix", async () => {
    const result = await computeRouteMatrix(client, {
      origins: [
        { address: "Seoul Station, Seoul, South Korea" },
        { address: "City Hall Station, Seoul, South Korea" },
      ],
      destinations: [
        { address: "Gangnam Station, Seoul, South Korea" },
        { address: "Jamsil Station, Seoul, South Korea" },
      ],
      travelMode: "TRANSIT",
    });
    expect(result.originsCount).toBe(2);
    expect(result.destinationsCount).toBe(2);
    expect(result.elements).toHaveLength(4);
  });

  it("checks a Japanese transit route", async () => {
    const result = await getTravelTime(client, {
      origin: { address: "Hakata Station, Fukuoka, Japan" },
      destination: { address: "Fukuoka Tower, Fukuoka, Japan" },
      travelMode: "TRANSIT",
    });
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.durationSeconds).toBeGreaterThan(0);
  });
});
