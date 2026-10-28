import { describe, expect, it, vi } from "vitest";
import matrixFixture from "./fixtures/route-matrix.json" with { type: "json" };
import routeFixture from "./fixtures/compute-routes.json" with { type: "json" };
import { GoogleRoutesClient } from "../src/google-routes/client.js";
import { computeRouteMatrix } from "../src/google-routes/route-matrix.js";
import { GoogleRoutesApiError, RateLimitError } from "../src/utils/validation.js";

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GoogleRoutesClient", () => {
  it("uses POST headers, keeps the API key out of the URL, and caches identical requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(routeFixture));
    const client = new GoogleRoutesClient({
      apiKey: "secret-test-key",
      baseUrl: "https://routes.test",
      fetch: fetchMock,
      logger: silentLogger,
      maxRetries: 0,
    });
    const request = {
      origin: { address: "Seoul Station" },
      destination: { address: "Gangnam Station" },
      travelMode: "TRANSIT" as const,
    };

    await client.computeRoutes(request, "routes.distanceMeters,routes.duration");
    await client.computeRoutes(request, "routes.distanceMeters,routes.duration");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://routes.test/directions/v2:computeRoutes");
    expect(String(url)).not.toContain("secret-test-key");
    expect(new Headers(init?.headers).get("X-Goog-Api-Key")).toBe("secret-test-key");
    expect(new Headers(init?.headers).get("X-Goog-FieldMask")).toBe(
      "routes.distanceMeters,routes.duration",
    );
  });

  it("maps non-retryable upstream errors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      error: { code: 400, status: "INVALID_ARGUMENT", message: "Bad waypoint" },
    }, 400));
    const client = new GoogleRoutesClient({
      apiKey: "test-key",
      fetch: fetchMock,
      logger: silentLogger,
      maxRetries: 3,
    });

    await expect(client.computeRoutes({
      origin: { address: "A" },
      destination: { address: "B" },
      travelMode: "DRIVE",
    }, "routes.duration")).rejects.toMatchObject({
      name: "GoogleRoutesApiError",
      httpStatus: 400,
      apiStatus: "INVALID_ARGUMENT",
    } satisfies Partial<GoogleRoutesApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 429 to RateLimitError", async () => {
    const client = new GoogleRoutesClient({
      apiKey: "test-key",
      fetch: async () => jsonResponse({ error: { status: "RESOURCE_EXHAUSTED" } }, 429),
      logger: silentLogger,
      maxRetries: 0,
    });
    await expect(client.computeRoutes({
      origin: { address: "A" },
      destination: { address: "B" },
      travelMode: "DRIVE",
    }, "routes.duration")).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("route matrix fixture", () => {
  it("normalizes elements without reordering and creates a duration matrix", async () => {
    const client = new GoogleRoutesClient({
      apiKey: "test-key",
      fetch: async () => jsonResponse(matrixFixture),
      logger: silentLogger,
      maxRetries: 0,
    });
    const result = await computeRouteMatrix(client, {
      origins: [{ address: "A" }, { address: "B" }],
      destinations: [{ address: "C" }, { address: "D" }],
      travelMode: "TRANSIT",
    });

    expect(result.elements.map(({ originIndex, destinationIndex }) => [originIndex, destinationIndex])).toEqual([
      [1, 0], [0, 0], [0, 1], [1, 1],
    ]);
    expect(result.durationsSeconds).toEqual([
      [600, null],
      [420, 901.25],
    ]);
  });

  it("rejects an oversized matrix before fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([]));
    const client = new GoogleRoutesClient({
      apiKey: "test-key",
      fetch: fetchMock,
      logger: silentLogger,
      maxRetries: 0,
    });
    await expect(computeRouteMatrix(client, {
      origins: Array.from({ length: 11 }, (_, index) => ({ lat: 37, lng: 127 + index / 100 })),
      destinations: Array.from({ length: 10 }, (_, index) => ({ lat: 36, lng: 128 + index / 100 })),
    })).rejects.toThrow("110 elements requested, maximum is 100");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps Google's transit cap even when the configured cap is higher", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([]));
    const client = new GoogleRoutesClient({
      apiKey: "test-key",
      fetch: fetchMock,
      logger: silentLogger,
      maxRetries: 0,
    });
    await expect(computeRouteMatrix(client, {
      origins: Array.from({ length: 11 }, (_, index) => ({ lat: 37, lng: 127 + index / 100 })),
      destinations: Array.from({ length: 10 }, (_, index) => ({ lat: 36, lng: 128 + index / 100 })),
      travelMode: "TRANSIT",
    }, { maxElements: 1_000 })).rejects.toThrow("maximum is 100");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
