import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import https from "https";
import { EventEmitter } from "events";
import {
  PlexApiClient,
  PlexApiError,
  PlexAuthError,
  PlexConnectionError,
} from "./api-client.js";
import type { RawLibraryResponse } from "../types/index.js";

// ── Helpers ─────────────────────────────────────────────────────────

const CONFIG = { host: "192.168.1.100", port: 32400, token: "test-token-abc" };

/** Sample library response for success-path tests. */
const LIBRARIES_RESPONSE: RawLibraryResponse = {
  MediaContainer: {
    size: 1,
    Directory: [{ key: "1", title: "Music", type: "artist" }],
  },
};

/**
 * Create a fake IncomingMessage that emits the given body as JSON.
 * Extends EventEmitter so res.on("data"/"end"/"error") works.
 */
function createMockResponse(
  body: unknown,
  statusCode = 200,
  statusMessage = "OK",
): http.IncomingMessage {
  const res = new EventEmitter() as http.IncomingMessage;
  res.statusCode = statusCode;
  res.statusMessage = statusMessage;
  res.resume = vi.fn();

  // Emit body data on next tick so listeners are attached first
  process.nextTick(() => {
    if (statusCode >= 200 && statusCode < 300) {
      const json = typeof body === "string" ? body : JSON.stringify(body);
      res.emit("data", Buffer.from(json));
      res.emit("end");
    }
  });

  return res;
}

// ── Setup / Teardown ────────────────────────────────────────────────

let httpGetSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  httpGetSpy = vi.spyOn(http, "get");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Wire up httpGetSpy to invoke the callback with the given mock response
 * and return a fake ClientRequest (EventEmitter with destroy).
 */
function mockHttpGet(
  body: unknown,
  statusCode = 200,
  statusMessage = "OK",
): void {
  httpGetSpy.mockImplementation((_opts: unknown, cb: unknown) => {
    const res = createMockResponse(body, statusCode, statusMessage);
    (cb as (res: http.IncomingMessage) => void)(res);
    const req = new EventEmitter() as http.ClientRequest;
    req.destroy = vi.fn().mockReturnThis();
    return req;
  });
}

/**
 * Wire up httpGetSpy to emit an error on the request object.
 */
function mockHttpGetError(error: Error): void {
  httpGetSpy.mockImplementation(() => {
    const req = new EventEmitter() as http.ClientRequest;
    req.destroy = vi.fn().mockReturnThis();
    process.nextTick(() => req.emit("error", error));
    return req;
  });
}

/**
 * Wire up httpGetSpy to emit a timeout on the request object.
 */
function mockHttpGetTimeout(): void {
  httpGetSpy.mockImplementation(() => {
    const req = new EventEmitter() as http.ClientRequest;
    req.destroy = vi.fn().mockReturnThis();
    process.nextTick(() => req.emit("timeout"));
    return req;
  });
}

// ── URL / path construction ─────────────────────────────────────────

describe("URL construction", () => {
  it("builds correct path for getLibraries", async () => {
    mockHttpGet(LIBRARIES_RESPONSE);
    const client = new PlexApiClient(CONFIG);

    await client.getLibraries();

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.hostname).toBe("192.168.1.100");
    expect(opts.port).toBe(32400);
    expect(opts.path).toBe(
      "/library/sections?X-Plex-Token=test-token-abc",
    );
  });

  it("builds correct path for getAlbums with library key", async () => {
    mockHttpGet({ MediaContainer: { size: 0, Metadata: [] } });
    const client = new PlexApiClient(CONFIG);

    await client.getAlbums("1");

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.path).toBe(
      "/library/sections/1/all?type=9&X-Plex-Token=test-token-abc",
    );
  });

  it("builds correct path for getAlbums with sort param", async () => {
    mockHttpGet({ MediaContainer: { size: 0, Metadata: [] } });
    const client = new PlexApiClient(CONFIG);

    await client.getAlbums("1", undefined, "title:asc");

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.path).toBe(
      "/library/sections/1/all?type=9&sort=title%3Aasc&X-Plex-Token=test-token-abc",
    );
  });

  it("builds correct path for getAlbums with pagination and sort", async () => {
    mockHttpGet({ MediaContainer: { size: 0, Metadata: [] } });
    const client = new PlexApiClient(CONFIG);

    await client.getAlbums("1", { offset: 100, limit: 50 }, "originallyAvailableAt:desc");

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.path).toBe(
      "/library/sections/1/all?type=9&X-Plex-Container-Start=100&X-Plex-Container-Size=50&sort=originallyAvailableAt%3Adesc&X-Plex-Token=test-token-abc",
    );
  });

  it("builds correct path for getTracks with full album key", async () => {
    mockHttpGet({ MediaContainer: { size: 0, Metadata: [] } });
    const client = new PlexApiClient(CONFIG);

    await client.getTracks("/library/metadata/1001/children");

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.path).toBe(
      "/library/metadata/1001/children?X-Plex-Token=test-token-abc",
    );
  });

  it("builds correct path for getPlaylists", async () => {
    mockHttpGet({ MediaContainer: { size: 0, Metadata: [] } });
    const client = new PlexApiClient(CONFIG);

    await client.getPlaylists();

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.path).toBe(
      "/playlists?X-Plex-Token=test-token-abc",
    );
  });

  it("builds correct path for getPlaylistItems", async () => {
    mockHttpGet({ MediaContainer: { size: 0, Metadata: [] } });
    const client = new PlexApiClient(CONFIG);

    await client.getPlaylistItems("/playlists/5001/items");

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.path).toBe(
      "/playlists/5001/items?X-Plex-Token=test-token-abc",
    );
  });

  it("encodes special characters in token", async () => {
    mockHttpGet(LIBRARIES_RESPONSE);
    const client = new PlexApiClient({ ...CONFIG, token: "abc=123&x" });

    await client.getLibraries();

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.path).toContain("X-Plex-Token=abc%3D123%26x");
  });

  it("encodes special characters in library key", async () => {
    mockHttpGet({ MediaContainer: { size: 0, Metadata: [] } });
    const client = new PlexApiClient(CONFIG);

    await client.getAlbums("key/with spaces");

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.path).toContain("/library/sections/key%2Fwith%20spaces/all");
  });
});

// ── Request headers ─────────────────────────────────────────────────

describe("request headers", () => {
  it("sends Accept: application/json header", async () => {
    mockHttpGet(LIBRARIES_RESPONSE);
    const client = new PlexApiClient(CONFIG);

    await client.getLibraries();

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.headers).toEqual({ Accept: "application/json" });
  });

  it("sets timeout option", async () => {
    mockHttpGet(LIBRARIES_RESPONSE);
    const client = new PlexApiClient(CONFIG);

    await client.getLibraries();

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.timeout).toBe(10_000);
  });
});

// ── Successful responses ────────────────────────────────────────────

describe("successful responses", () => {
  it("returns parsed JSON for getLibraries", async () => {
    mockHttpGet(LIBRARIES_RESPONSE);
    const client = new PlexApiClient(CONFIG);

    const result = await client.getLibraries();

    expect(result).toEqual(LIBRARIES_RESPONSE);
  });

  it("returns parsed JSON for getAlbums", async () => {
    const albumsResponse = { MediaContainer: { size: 0, Metadata: [] } };
    mockHttpGet(albumsResponse);
    const client = new PlexApiClient(CONFIG);

    const result = await client.getAlbums("1");

    expect(result).toEqual(albumsResponse);
  });
});

// ── Error handling ──────────────────────────────────────────────────

describe("error handling", () => {
  it("throws PlexAuthError on 401 response", async () => {
    mockHttpGet(null, 401, "Unauthorized");
    const client = new PlexApiClient(CONFIG);

    await expect(client.getLibraries()).rejects.toThrow(PlexAuthError);
    await expect(client.getLibraries()).rejects.toThrow(
      "Unauthorized — check your Plex token",
    );
  });

  it("PlexAuthError has statusCode 401", async () => {
    mockHttpGet(null, 401, "Unauthorized");
    const client = new PlexApiClient(CONFIG);

    try {
      await client.getLibraries();
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PlexAuthError);
      expect(error).toBeInstanceOf(PlexApiError);
      expect((error as PlexApiError).statusCode).toBe(401);
    }
  });

  it("drains response body on 401", async () => {
    mockHttpGet(null, 401, "Unauthorized");
    const client = new PlexApiClient(CONFIG);

    // Capture the mock response to check resume() was called
    let capturedRes: http.IncomingMessage | undefined;
    httpGetSpy.mockImplementation((_opts: unknown, cb: unknown) => {
      capturedRes = createMockResponse(null, 401, "Unauthorized");
      (cb as (res: http.IncomingMessage) => void)(capturedRes);
      const req = new EventEmitter() as http.ClientRequest;
      req.destroy = vi.fn().mockReturnThis();
      return req;
    });

    await expect(client.getLibraries()).rejects.toThrow(PlexAuthError);
    expect(capturedRes!.resume).toHaveBeenCalled();
  });

  it("throws PlexApiError on 500 response", async () => {
    mockHttpGet(null, 500, "Internal Server Error");
    const client = new PlexApiClient(CONFIG);

    await expect(client.getLibraries()).rejects.toThrow(PlexApiError);
    await expect(client.getLibraries()).rejects.toThrow(
      "Plex API error: 500 Internal Server Error",
    );
  });

  it("throws PlexApiError on 404 response", async () => {
    mockHttpGet(null, 404, "Not Found");
    const client = new PlexApiClient(CONFIG);

    await expect(client.getLibraries()).rejects.toThrow(PlexApiError);
    await expect(client.getLibraries()).rejects.toThrow(
      "Plex API error: 404 Not Found",
    );
  });

  it("throws PlexConnectionError on network failure", async () => {
    mockHttpGetError(new Error("ECONNREFUSED"));
    const client = new PlexApiClient(CONFIG);

    await expect(client.getLibraries()).rejects.toThrow(PlexConnectionError);
    await expect(client.getLibraries()).rejects.toThrow(
      "Failed to connect to Plex server",
    );
  });

  it("throws PlexConnectionError on timeout", async () => {
    mockHttpGetTimeout();
    const client = new PlexApiClient(CONFIG);

    await expect(client.getLibraries()).rejects.toThrow(PlexConnectionError);
    await expect(client.getLibraries()).rejects.toThrow("timed out");
  });

  it("destroys request on timeout", async () => {
    let capturedReq: http.ClientRequest | undefined;
    httpGetSpy.mockImplementation(() => {
      capturedReq = new EventEmitter() as http.ClientRequest;
      capturedReq.destroy = vi.fn().mockReturnThis();
      process.nextTick(() => capturedReq!.emit("timeout"));
      return capturedReq;
    });
    const client = new PlexApiClient(CONFIG);

    await expect(client.getLibraries()).rejects.toThrow(PlexConnectionError);
    expect(capturedReq!.destroy).toHaveBeenCalled();
  });

  it("PlexConnectionError preserves original cause", async () => {
    const originalError = new Error("ECONNREFUSED");
    mockHttpGetError(originalError);
    const client = new PlexApiClient(CONFIG);

    try {
      await client.getLibraries();
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PlexConnectionError);
      expect((error as PlexConnectionError).cause).toBe(originalError);
    }
  });

  it("throws PlexConnectionError on malformed JSON", async () => {
    httpGetSpy.mockImplementation((_opts: unknown, cb: unknown) => {
      const res = new EventEmitter() as http.IncomingMessage;
      res.statusCode = 200;
      res.statusMessage = "OK";
      res.resume = vi.fn();
      (cb as (res: http.IncomingMessage) => void)(res);
      process.nextTick(() => {
        res.emit("data", Buffer.from("not valid json{{{"));
        res.emit("end");
      });
      const req = new EventEmitter() as http.ClientRequest;
      req.destroy = vi.fn().mockReturnThis();
      return req;
    });
    const client = new PlexApiClient(CONFIG);

    await expect(client.getLibraries()).rejects.toThrow(PlexConnectionError);
    await expect(client.getLibraries()).rejects.toThrow(
      "Failed to parse Plex API response as JSON",
    );
  });
});

// ── Configuration ───────────────────────────────────────────────────

describe("configuration", () => {
  it("uses custom timeout when provided", async () => {
    mockHttpGet(LIBRARIES_RESPONSE);
    const client = new PlexApiClient({ ...CONFIG, timeoutMs: 5000 });

    await client.getLibraries();

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.timeout).toBe(5000);
  });

  it("defaults timeout to 10000ms", async () => {
    mockHttpGet(LIBRARIES_RESPONSE);
    const client = new PlexApiClient(CONFIG);

    await client.getLibraries();

    const opts = httpGetSpy.mock.calls[0]![0] as http.RequestOptions;
    expect(opts.timeout).toBe(10_000);
  });
});

// ── HTTPS support ───────────────────────────────────────────────────

describe("HTTPS support", () => {
  let httpsGetSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    httpsGetSpy = vi.spyOn(https, "get");
  });

  function mockHttpsGet(
    body: unknown,
    statusCode = 200,
    statusMessage = "OK",
  ): void {
    httpsGetSpy.mockImplementation((_opts: unknown, cb: unknown) => {
      const res = createMockResponse(body, statusCode, statusMessage);
      (cb as (res: http.IncomingMessage) => void)(res);
      const req = new EventEmitter() as http.ClientRequest;
      req.destroy = vi.fn().mockReturnThis();
      return req;
    });
  }

  it("uses https module when https is true", async () => {
    mockHttpsGet(LIBRARIES_RESPONSE);
    const client = new PlexApiClient({ ...CONFIG, https: true });

    await client.getLibraries();

    expect(httpsGetSpy).toHaveBeenCalledTimes(1);
    expect(httpGetSpy).not.toHaveBeenCalled();
  });

  it("uses http module when https is false", async () => {
    mockHttpGet(LIBRARIES_RESPONSE);
    const client = new PlexApiClient({ ...CONFIG, https: false });

    await client.getLibraries();

    expect(httpGetSpy).toHaveBeenCalledTimes(1);
    expect(httpsGetSpy).not.toHaveBeenCalled();
  });

  it("uses http module when https is not specified", async () => {
    mockHttpGet(LIBRARIES_RESPONSE);
    const client = new PlexApiClient(CONFIG);

    await client.getLibraries();

    expect(httpGetSpy).toHaveBeenCalledTimes(1);
    expect(httpsGetSpy).not.toHaveBeenCalled();
  });
});
