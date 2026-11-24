# Contributing to MusePilot

Thanks for helping improve MusePilot for Volumio.

## Reporting Bugs

Use the GitHub issue forms:

https://github.com/samadi81/volumio-ai-autopilot/issues/new/choose

Please include Volumio version, device model, architecture, music source, steps to reproduce, expected result, actual result, and sanitized logs.

Do not include API keys, Qobuz tokens, passwords, browser cookies, Local Storage dumps, or signed stream URLs.

## Local Checks

Before opening a PR, run:

```sh
npm test
node --check index.js
node --check lib/http-api.js
node --check lib/qobuz.js
node --check lib/track-cache.js
```

Also verify edited JSON files parse correctly.

## Qobuz Local Cache Changes

For download or cached-file playback changes, verify:

- Qobuz queue rows show whether a track is a stream, cached file, or currently playing cached file.
- `파일▶` plays the cached file without clearing the rest of the queue.
- Download credentials and tokens are never logged.
- `.part` files are not indexed as playable files.
- Metadata sidecars do not store tokens or signed URLs.

## Release Safety

Feedback can be used to create issues, tests, or draft PRs, but do not auto-merge unreviewed changes. User-facing updates should pass tests, syntax checks, and a Volumio device validation pass before release.
