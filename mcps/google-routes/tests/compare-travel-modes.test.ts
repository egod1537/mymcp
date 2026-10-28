import { describe, expect, it, vi } from "vitest";
import { GoogleRoutesClient } from "../src/google-routes/client.js";
import { compareTravelModes } from "../src/tools/compare-travel-modes.js";

describe("compareTravelModes", () => {
  it("returns per-mode failures without failing the whole comparison", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { travelMode: string };
      if (body.travelMode === "BICYCLE") {
        return new Response(JSON.stringify({
          error: { code: 400, status: "INVALID_ARGUMENT", message: "Unsupported travel mode" },
        }), { status: 400 });
      }
      return new Response(JSON.stringify({
        routes: [{ distanceMeters: 1000, duration: "600s" }],
      }), { status: 200 });
    });
    const client = new GoogleRoutesClient({
      apiKey: "test-key",
      fetch: fetchMock,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      maxRetries: 0,
    });

    const result = await compareTravelModes(client, {
      origin: { address: "A" },
      destination: { address: "B" },
      travelModes: ["DRIVE", "BICYCLE"],
    });

    expect(result.results[0]).toEqual({
      travelMode: "DRIVE",
      available: true,
      distanceMeters: 1000,
      durationSeconds: 600,
    });
    expect(result.results[1]).toMatchObject({
      travelMode: "BICYCLE",
      available: false,
      error: expect.stringContaining("INVALID_ARGUMENT"),
    });
  });
});
