import { describe, it, expect } from "vitest";
import { buildStreamUrl, buildResourceUrl } from "./stream-resolver.js";

const connection = {
  host: "192.168.1.100",
  port: 32400,
  token: "abc123token",
};

// ── buildStreamUrl — direct play ────────────────────────────────────

describe("buildStreamUrl — direct play", () => {
  it("builds correct direct play URL", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/2001/1234567/file.flac",
    });
    expect(url).toBe(
      "http://192.168.1.100:32400/library/parts/2001/1234567/file.flac?X-Plex-Token=abc123token"
    );
  });

  it("includes token parameter", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/1/2/file.mp3",
    });
    expect(url).toContain("X-Plex-Token=abc123token");
  });

  it("handles special characters in token", () => {
    const url = buildStreamUrl({
      host: "10.0.0.1",
      port: 32400,
      token: "token with spaces&symbols=yes",
      trackKey: "/library/parts/1/2/file.mp3",
    });
    expect(url).toContain("X-Plex-Token=token%20with%20spaces%26symbols%3Dyes");
  });

  it("uses & when trackKey already has query params", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/1/2/file.mp3?quality=high",
    });
    expect(url).toBe(
      "http://192.168.1.100:32400/library/parts/1/2/file.mp3?quality=high&X-Plex-Token=abc123token"
    );
  });

  it("defaults to direct play when transcode is not specified", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/1/2/file.flac",
    });
    expect(url).not.toContain("/transcode/");
    expect(url.startsWith("http://192.168.1.100:32400/library/parts/1/2/file.flac")).toBe(true);
  });
});

// ── buildStreamUrl — transcode ──────────────────────────────────────

describe("buildStreamUrl — transcode", () => {
  it("builds correct transcode URL for mp3", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/2001/1234567/file.flac",
      transcode: true,
      format: "mp3",
    });
    expect(url).toContain("/music/:/transcode/universal/start?");
    expect(url).toContain("path=%2Flibrary%2Fparts%2F2001%2F1234567%2Ffile.flac");
    expect(url).toContain("container=mp3");
    expect(url).toContain("audioCodec=mp3");
    expect(url).toContain("X-Plex-Token=abc123token");
  });

  it("builds correct transcode URL for flac", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/1/2/file.wav",
      transcode: true,
      format: "flac",
    });
    expect(url).toContain("container=flac");
    expect(url).toContain("audioCodec=flac");
  });

  it("builds correct transcode URL for aac", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/1/2/file.wav",
      transcode: true,
      format: "aac",
    });
    expect(url).toContain("container=mp4");
    expect(url).toContain("audioCodec=aac");
  });

  it("defaults to mp3 format when transcode is true but format is not specified", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/1/2/file.flac",
      transcode: true,
    });
    expect(url).toContain("container=mp3");
    expect(url).toContain("audioCodec=mp3");
  });

  it("includes mediaIndex and partIndex parameters", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/1/2/file.flac",
      transcode: true,
    });
    expect(url).toContain("mediaIndex=0");
    expect(url).toContain("partIndex=0");
  });

  it("includes protocol parameter", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/1/2/file.flac",
      transcode: true,
    });
    expect(url).toContain("protocol=http");
  });
});

// ── buildStreamUrl — HTTPS ───────────────────────────────────────────

describe("buildStreamUrl — HTTPS", () => {
  it("uses https:// when https is true", () => {
    const url = buildStreamUrl({
      ...connection,
      https: true,
      trackKey: "/library/parts/2001/1234567/file.flac",
    });
    expect(url).toBe(
      "https://192.168.1.100:32400/library/parts/2001/1234567/file.flac?X-Plex-Token=abc123token"
    );
  });

  it("uses http:// when https is false", () => {
    const url = buildStreamUrl({
      ...connection,
      https: false,
      trackKey: "/library/parts/1/2/file.mp3",
    });
    expect(url).toMatch(/^http:\/\//);
  });

  it("defaults to http:// when https is not specified", () => {
    const url = buildStreamUrl({
      ...connection,
      trackKey: "/library/parts/1/2/file.mp3",
    });
    expect(url).toMatch(/^http:\/\//);
  });

  it("uses https protocol parameter in transcode URL", () => {
    const url = buildStreamUrl({
      ...connection,
      https: true,
      trackKey: "/library/parts/1/2/file.flac",
      transcode: true,
    });
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("protocol=https");
  });

  it("uses http protocol parameter in transcode URL when https is false", () => {
    const url = buildStreamUrl({
      ...connection,
      https: false,
      trackKey: "/library/parts/1/2/file.flac",
      transcode: true,
    });
    expect(url).toContain("protocol=http");
  });
});

// ── buildResourceUrl — HTTPS ────────────────────────────────────────

describe("buildResourceUrl — HTTPS", () => {
  it("uses https:// when https is true", () => {
    const url = buildResourceUrl(
      { ...connection, https: true },
      "/library/metadata/1001/thumb/1609459200"
    );
    expect(url).toBe(
      "https://192.168.1.100:32400/library/metadata/1001/thumb/1609459200?X-Plex-Token=abc123token"
    );
  });

  it("uses http:// when https is not specified", () => {
    const url = buildResourceUrl(connection, "/some/path");
    expect(url).toMatch(/^http:\/\//);
  });
});

// ── buildResourceUrl ────────────────────────────────────────────────

describe("buildResourceUrl", () => {
  it("builds correct artwork URL", () => {
    const url = buildResourceUrl(
      connection,
      "/library/metadata/1001/thumb/1609459200"
    );
    expect(url).toBe(
      "http://192.168.1.100:32400/library/metadata/1001/thumb/1609459200?X-Plex-Token=abc123token"
    );
  });

  it("includes token parameter", () => {
    const url = buildResourceUrl(connection, "/some/path");
    expect(url).toContain("X-Plex-Token=abc123token");
  });

  it("handles special characters in token", () => {
    const url = buildResourceUrl(
      { host: "10.0.0.1", port: 32400, token: "a&b=c" },
      "/some/path"
    );
    expect(url).toContain("X-Plex-Token=a%26b%3Dc");
  });

  it("uses & when path already has query params", () => {
    const url = buildResourceUrl(connection, "/library/metadata/1001/thumb/123?size=large");
    expect(url).toBe(
      "http://192.168.1.100:32400/library/metadata/1001/thumb/123?size=large&X-Plex-Token=abc123token"
    );
  });
});
