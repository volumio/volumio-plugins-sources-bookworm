# MusePilot for Volumio

MusePilot is an AI-driven auto-queue plugin for Volumio 3 and 4. It learns your taste from listening history + 👍/👎 feedback, then uses an LLM (or another recommender back-end) to pick the next track and queue it from your TIDAL, Qobuz, or local library.

한국어 설명서는 [docs/USER_GUIDE_KO.md](docs/USER_GUIDE_KO.md)를 보세요.

Feedback, bug reports, and feature requests are tracked in [GitHub Issues](https://github.com/samadi81/volumio-ai-autopilot/issues/new/choose). Never paste API keys, Qobuz tokens, passwords, or signed stream URLs into an issue.

## Features

- **Multi-provider LLM**: Anthropic (Claude), OpenAI, Google (Gemini), Groq, DeepSeek, xAI (Grok), Mistral, OpenRouter, Perplexity, Together AI, Ollama (local), or any OpenAI-compatible endpoint
- **Bring your own API key** — no LLM key is bundled; each user enters their own provider key
- **Per-provider API key slots** — switch providers without losing saved keys
- **27 prompt presets** with **250+ sub-variants** — genre curators (jazz, rock, electronic, hip-hop, classical, metal, folk, soul/funk, world, ambient, pop, country, blues, R&B), plus mood, discovery, era, deep-cuts, cinematic, activity, sonic-signature and lyrical-theme modes
- **35 taste hint presets** + freeform editing
- **Energy range** (0 quiet ↔ 10 loud) as a constraint
- **Feedback loop**: skip detection (implicit 👎) + explicit 👍/👎 buttons; feedback is injected into every recommendation prompt
- **Three trigger modes**: queue empty / keep N ahead / manual only
- **Sources**: TIDAL, Qobuz, local MPD, or "Auto (any)"
- **Qobuz local cache**: save Qobuz queue tracks as local files, show whether playback is from Qobuz or the cached file, and play cached files without clearing the rest of the queue
- **Fallback recommenders**: Last.fm / ListenBrainz, Spotify Recommendations API, local history heuristic

## Requirements

- Volumio 3 or 4 (armhf, arm64, amd64, i386)
- A source plugin installed/active (MyVolumio TIDAL/Qobuz, or built-in MPD for local library)
- Your own API key for the LLM provider you choose, or an Ollama server you run yourself

## LLM API Keys

MusePilot does **not** include, share, resell, proxy, or hide any LLM API key. Every user must bring their own key from the provider they choose.

- If you choose Anthropic, OpenAI, Google, Groq, DeepSeek, xAI, Mistral, OpenRouter, Perplexity, or Together AI, create an account with that provider and paste **your own API key** into MusePilot settings.
- If you choose Ollama, leave the API key empty and set the base URL to the machine running Ollama, for example `http://127.0.0.1:11434/v1` on the Volumio device or `http://192.168.1.50:11434/v1` for a Mac/PC/NAS on your network.
- API keys are stored locally in Volumio's plugin configuration and are only sent to the provider you selected.
- API usage, quotas, billing, model availability, and content policies are controlled by your chosen provider, not by MusePilot.
- For privacy, use a provider you trust, or use Ollama/local models so prompts stay on your own network.

## Installation

### Via `volumio plugin install` (over SSH)

Enable SSH in the Volumio dev UI (`http://<your-volumio>/dev`), then from your local machine:

```sh
git clone -b claude/gemini-llm-issues-2ATXy https://github.com/samadi81/volumio-ai-autopilot.git
cd volumio-ai-autopilot
rsync -avz --exclude node_modules ./ volumio@<your-volumio>:/home/volumio/ai_autopilot/
ssh -t volumio@<your-volumio> "cd /home/volumio/ai_autopilot && volumio plugin install"
```

Or use the included helper:

```sh
./deploy.sh volumio@<your-volumio>            # install
./deploy.sh volumio@<your-volumio> fast       # quick update after code changes
./deploy.sh volumio@<your-volumio> logs       # tail plugin logs
./deploy.sh volumio@<your-volumio> reinstall  # uninstall + install
```

After install, enable the plugin via **Plugins → Installed Plugins → MusePilot**.

### Remote panel (phone/browser)

The plugin serves a standalone remote at **`http://<volumio-ip>:8488/`** (port set by `http_api_port`; if that port is busy the server automatically moves to the next free one and the Actions button shows the real URL). Open it in any browser — outside the Volumio app — to get:

- **Now playing** with album art and a live progress bar
- **Transport**: previous / play-pause / next, plus a **volume** slider
- **Current queue** with thumbnails
- **Tap any queue item to play it**
- **Quick settings** you can change on the fly without opening the plugin menu: autopilot on/off, energy range, and LLM provider/model
- **Prompt settings**: mood preset + sub-variant, hint preset, and free-text system-prompt / hints editors
- **General settings**: source, trigger mode, keep-ahead count, cooldown, history window, same-album / same-artist avoidance
- **👍 Like / 👎 Dislike** the current track, **🤖 AI 추천** to queue an AI pick now, and a **list of liked songs**
- An **update button** that runs the in-plugin self-update from the browser

On iOS Safari, **Share → Add to Home Screen** turns it into a one-tap app. (The in-app "Open remote" button can't always hand off to an external browser, so opening the URL directly in Safari is the reliable path.)

### Updating

After the first install you can update without SSH: open plugin settings → **Actions → "Check for updates"**. This pulls the latest code from GitHub's `main` branch and installs it in place, keeping your history, feedback, prompts, and API keys. Disable and re-enable the plugin (or restart Volumio) afterward to load the new code.

Note: the Qobuz local-cache work is currently on the `claude/gemini-llm-issues-2ATXy` branch. Until that branch is validated and merged into `main`, update branch builds by reinstalling from the branch with the SSH commands above.

## Configuration

Open plugin settings:

- **General** — on/off, source, trigger mode, N-ahead, cooldown, history window, verbose log
- **Recommender** — pick back-end, enter your own API key, pick model, prompt/sub-prompt preset, hint preset, energy range
- **Actions** — Dry run (no queue), Pick next track now, List installed sources, 👍/👎 buttons, clear feedback/history

### Quick start (5 min)

1. Install plugin, enable it.
2. Open settings → Recommender.
3. Pick provider (e.g. Anthropic) → click "Get … key →" if you need one.
4. Create or copy **your own** API key from that provider and paste it into the matching key field. Leave it empty only for Ollama.
5. Pick prompt preset (e.g. Jazz Curator → ECM).
6. Click "Load selected prompt → textarea". Reload page. You'll see the prompt filled in.
7. Save settings.
8. General tab → Trigger mode = "Keep N tracks ahead", N = 3. Save.
9. Play a few tracks from Qobuz/TIDAL to seed history, then the AI will start auto-queueing.

### Feedback

- 👍 Like / 👎 Dislike buttons in the Actions section record a verdict on the currently-playing track.
- Skipping a track before ~30% completion is auto-recorded as 👎 (implicit).
- Feedback is sent to the LLM on every request so it learns in real time.

## Community Feedback

- Report bugs or request features in [GitHub Issues](https://github.com/samadi81/volumio-ai-autopilot/issues/new/choose).
- The in-plugin settings page and the remote panel both link to the same issue form.
- For Qobuz download problems, include your Volumio version, device architecture, whether the track plays in the official Qobuz plugin, and sanitized logs. Do not include Qobuz tokens, passwords, API keys, or signed URLs.
- Feedback-driven updates are not merged automatically. Issues are triaged into fixes or feature work, covered by tests where possible, validated on a Volumio device, then released through GitHub and the Volumio plugin submission flow.

## Volumio Plugin Store Status

This plugin is not yet visible in the public Volumio Plugin Store. Volumio requires the plugin to pass their submission checklist, be committed and pushed to a plugin-sources fork, and be submitted from a Volumio device with `volumio plugin submit`. See [Volumio's publish documentation](https://developers.volumio.com/plugins/plugin-publishing) and the [submission checklist](https://developers.volumio.com/plugins/submission-checklist).

### LLM providers — getting keys

- **Anthropic (Claude)** — [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- **OpenAI** — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Google (Gemini)** — [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- **Groq** — [console.groq.com/keys](https://console.groq.com/keys) (fast, generous free tier)
- **DeepSeek** — [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) (cheap)
- **xAI (Grok)** — [console.x.ai](https://console.x.ai/)
- **Mistral** — [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys/)
- **OpenRouter** (multi-model gateway) — [openrouter.ai/keys](https://openrouter.ai/keys)
- **Perplexity** — [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api)
- **Together AI** — [api.together.xyz/settings/api-keys](https://api.together.xyz/settings/api-keys)
- **Ollama** — no key, runs locally (ollama pull <model>)

## Troubleshooting

**Nothing gets queued.**  
Enable verbose log. Check `journalctl -u volumio | grep ai_autopilot`. Common causes: LLM 400 (wrong model name → use dropdown), zero search matches (LLM picked a track not in your source's catalog), cooldown blocking rapid triggers.

**The same track keeps showing up.**  
Your history window is too short, or the LLM is being too conservative. Try the "Discovery" prompt preset or raise history_window.

**LLM returns invalid JSON.**  
Switch to a stronger model. Some small models (e.g. llama-3.2-3b) struggle with structured output.

**How do I know which source plugins are installed?**  
Click "List installed sources" under Actions. Check the log for `plugins[music_service] = [...]`.

## Architecture

```
ai_autopilot/
├─ index.js              # plugin class (lifecycle, UI config, orchestration)
├─ config.json           # defaults
├─ UIConfig.json         # WebUI form
├─ package.json
├─ install.sh / uninstall.sh / deploy.sh
├─ LICENSE               # MIT
├─ i18n/
│  ├─ strings_en.json
│  └─ strings_ko.json
├─ lib/
│  ├─ history.js         # persistent history (ring buffer)
│  ├─ feedback.js        # persistent feedback (likes/dislikes/skips)
│  ├─ presets.js         # built-in prompt + hint library
│  └─ queue-monitor.js   # polls Volumio state, fires triggers, detects skips
└─ recommenders/
   ├─ base.js
   ├─ llm.js             # all LLM providers
   ├─ lastfm.js          # track.getSimilar
   ├─ spotify.js         # /v1/recommendations
   └─ local.js           # offline heuristic
```

To add a new recommender, implement `recommend(history, feedback) -> Promise<{artist,title}|null>` and register it in `index.js` under `Recommenders`.

## Privacy

- **Listening history** and **feedback** live on your Volumio device at `/data/plugins/music_service/ai_autopilot/*.json`. They never leave your device, except when passed as text to the LLM you configured.
- **API keys** are supplied by each user, stored locally in Volumio's config system, and only sent to the provider whose endpoint you selected.
- This plugin does not call home, collect telemetry, or talk to any server other than (a) your configured LLM provider and (b) `localhost` (Volumio's own REST API) for search fallback.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

Issues and PRs welcome. Please run `npm test`, `node --check` on any `.js` you modify, and verify JSON syntax before submitting.
