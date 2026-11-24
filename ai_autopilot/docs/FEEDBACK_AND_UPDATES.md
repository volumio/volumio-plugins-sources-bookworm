# Feedback and Update Workflow

MusePilot collects public feedback through GitHub Issues:

https://github.com/samadi81/volumio-ai-autopilot/issues/new/choose

The plugin settings page and the remote panel link to that page. The plugin does not send telemetry or upload diagnostics automatically.

## What to Include

For a bug report, include:

- Volumio version and device model
- CPU architecture, if known
- MusePilot version or Git commit
- Music source: TIDAL, Qobuz, local MPD, or Auto
- Steps to reproduce
- Expected result and actual result
- Sanitized logs

For Qobuz local-cache issues, also include:

- Whether the same track plays in the official Volumio Qobuz plugin
- Whether the issue happens on download, cached-file playback, metadata display, or queue preservation
- The Qobuz track ID or artist/title, when safe to share

## Do Not Share Secrets

Do not paste any of these into GitHub, Volumio Community, screenshots, or logs:

- LLM API keys
- Qobuz passwords
- Qobuz user auth tokens
- Qobuz refresh tokens
- Browser cookies or Local Storage dumps
- Signed stream URLs

## How Feedback Becomes Updates

Feedback should be handled through a reviewed release pipeline:

1. A user opens a structured GitHub Issue.
2. The issue is labeled as bug, Qobuz cache, feature, docs, or support.
3. Reproducible bugs get a focused test or manual verification checklist.
4. A fix is made in a branch and submitted as a PR.
5. `npm test`, syntax checks, JSON checks, and Volumio device validation are run.
6. After review, the change is released on GitHub.
7. Store-ready releases are submitted through Volumio's plugin publishing flow.

Do not auto-merge code generated directly from user feedback. Feedback can drive automation for triage, test generation, or draft PR creation, but a maintainer should review and validate every update before it reaches users.

## Volumio Store

Volumio's public plugin store is a moderated channel. A plugin must pass their submission checklist and be submitted from a Volumio device with:

```sh
volumio plugin submit
```

References:

- https://developers.volumio.com/plugins/plugin-publishing
- https://developers.volumio.com/plugins/submission-checklist
- https://github.com/volumio/volumio-plugins-sources-bookworm
