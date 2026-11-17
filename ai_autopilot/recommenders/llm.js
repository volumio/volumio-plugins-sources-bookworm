'use strict';

const fetch = require('node-fetch');
const Base = require('./base');

/**
 * Multi-provider LLM recommender.
 *
 * Transport strategies:
 *   - 'anthropic'   native /v1/messages with x-api-key header
 *   - 'google'      native generativelanguage.googleapis.com
 *   - everything else → OpenAI-compatible /chat/completions
 *
 * All providers return a single JSON pick: {"artist": "...", "title": "..."}
 */

const PROVIDERS = {
  anthropic:  { kind: 'anthropic', baseUrl: 'https://api.anthropic.com',           defaultModel: 'claude-sonnet-4-6' },
  openai:     { kind: 'oai',       baseUrl: 'https://api.openai.com/v1',           defaultModel: 'gpt-4o-mini' },
  google:     { kind: 'google',    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash' },
  groq:       { kind: 'oai',       baseUrl: 'https://api.groq.com/openai/v1',      defaultModel: 'llama-3.3-70b-versatile' },
  deepseek:   { kind: 'oai',       baseUrl: 'https://api.deepseek.com/v1',         defaultModel: 'deepseek-chat' },
  xai:        { kind: 'oai',       baseUrl: 'https://api.x.ai/v1',                 defaultModel: 'grok-4-fast' },
  mistral:    { kind: 'oai',       baseUrl: 'https://api.mistral.ai/v1',           defaultModel: 'mistral-large-latest' },
  openrouter: { kind: 'oai',       baseUrl: 'https://openrouter.ai/api/v1',        defaultModel: 'anthropic/claude-sonnet-4.5',
                extraHeaders: { 'HTTP-Referer': 'https://volumio.org', 'X-Title': 'Volumio AI Autopilot' } },
  perplexity: { kind: 'oai',       baseUrl: 'https://api.perplexity.ai',           defaultModel: 'llama-3.1-sonar-large-128k-online' },
  together:   { kind: 'oai',       baseUrl: 'https://api.together.xyz/v1',         defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  ollama:     { kind: 'oai',       baseUrl: 'http://localhost:11434/v1',           defaultModel: 'llama3.2', noKey: true },
  custom:     { kind: 'oai',       baseUrl: '',                                     defaultModel: '' }
};

class LLMRecommender extends Base {
  async recommend(history, feedback) {
    const providerName = this.config.llm_provider || 'anthropic';
    const spec = PROVIDERS[providerName];
    if (!spec) throw new Error('Unknown LLM provider: ' + providerName);

    const apiKey = (this.config.llm_api_key || '').trim();
    if (!spec.noKey && !apiKey) throw new Error('LLM API key is not set for provider: ' + providerName);

    const model = (this.config.llm_model || '').trim() || spec.defaultModel;
    if (!model) throw new Error('Model name is required (provider: ' + providerName + ')');

    const baseUrl = (this.config.llm_base_url || '').trim() || spec.baseUrl;
    if (!baseUrl) throw new Error('Base URL is required for custom provider.');

    const recent = (history || []).slice(-20);
    const historyText = recent.length
      ? recent.map((t, i) => `${i + 1}. ${t.artist || 'Unknown'} — ${t.title}`).join('\n')
      : '(no history yet)';

    const defaultSystem =
      "You are a music recommender. Given a listener's recent play history, suggest exactly ONE next " +
      "song that fits their taste but isn't a duplicate of the recent list. Favor tracks likely to exist " +
      "on TIDAL/Qobuz streaming catalogs. Respond with ONLY a single-line JSON object of the form " +
      '{"artist": "Artist Name", "title": "Track Title"} and no other text.';

    const overrideSystem = (this.config.llm_system_prompt || '').trim();
    const hints = (this.config.llm_hints || '').trim();

    // Optional energy range (0 quiet – 10 loud). Omit when 0–10 (unconstrained).
    let eMin = Number(this.config.energy_min);
    let eMax = Number(this.config.energy_max);
    if (!Number.isFinite(eMin)) eMin = 0;
    if (!Number.isFinite(eMax)) eMax = 10;
    if (eMin > eMax) { const t = eMin; eMin = eMax; eMax = t; }
    const energyLine = (eMin > 0 || eMax < 10)
      ? `Energy level constraint: pick a track whose energy/intensity falls between ${eMin} and ${eMax} on a 0–10 scale (0 = silent/ambient/whisper, 10 = chaotic/peak/driving).`
      : '';

    // Avoid-same constraints (albums / artists within N recent tracks)
    const albumWin = Math.max(0, Number(this.config.avoid_same_album_window) || 0);
    const artistWin = Math.max(0, Number(this.config.avoid_same_artist_window) || 0);
    const avoidLines = [];
    if (albumWin > 0) {
      const albums = [...new Set(
        (history || []).slice(-albumWin).map((t) => (t.album || '').trim()).filter(Boolean)
      )];
      if (albums.length) {
        avoidLines.push('Do NOT recommend any track from these albums (already played within the last ' +
          albumWin + ' tracks): ' + albums.map((a) => '"' + a + '"').join(', '));
      }
    }
    if (artistWin > 0) {
      const artists = [...new Set(
        (history || []).slice(-artistWin).map((t) => (t.artist || '').trim()).filter(Boolean)
      )];
      if (artists.length) {
        avoidLines.push('Do NOT recommend any track by these artists (already played within the last ' +
          artistWin + ' tracks): ' + artists.map((a) => '"' + a + '"').join(', '));
      }
    }
    const avoidBlock = avoidLines.length ? 'Repetition constraints:\n' + avoidLines.join('\n') : '';

    // Feedback context (likes / dislikes)
    const fb = feedback || { likes: [], dislikes: [] };
    const fmt = (it) => (it.artist ? it.artist + ' — ' : '') + it.title + (it.source === 'skip' ? ' [skip]' : '');
    const feedbackParts = [];
    if (fb.likes && fb.likes.length) {
      feedbackParts.push('Tracks the listener LIKED (lean toward similar artists/tracks):\n' +
        fb.likes.map((it, i) => (i + 1) + '. ' + fmt(it)).join('\n'));
    }
    if (fb.dislikes && fb.dislikes.length) {
      feedbackParts.push('Tracks the listener DISLIKED or SKIPPED (AVOID these artists and anything very similar):\n' +
        fb.dislikes.map((it, i) => (i + 1) + '. ' + fmt(it)).join('\n'));
    }
    const feedbackBlock = feedbackParts.join('\n\n');

    const systemBase = overrideSystem || defaultSystem;
    const extras = [
      hints ? 'User taste hints: ' + hints : '',
      energyLine,
      avoidBlock,
      feedbackBlock
    ].filter(Boolean);
    const system = extras.length
      ? systemBase + '\n\n' + extras.join('\n\n')
      : systemBase;

    const userPrompt =
      `Recent play history (oldest to newest):\n${historyText}\n\n` +
      `Return one JSON object: {"artist":"...","title":"..."}`;

    this.log('LLM(' + providerName + '/' + model + ') requesting; promptMode=' +
      (overrideSystem ? 'OVERRIDE' : (hints ? 'DEFAULT+HINTS' : 'DEFAULT')));

    let text;
    if (spec.kind === 'anthropic') {
      text = await this._callAnthropic({ apiKey, model, system, userPrompt, baseUrl });
    } else if (spec.kind === 'google') {
      text = await this._callGemini({ apiKey, model, system, userPrompt, baseUrl });
    } else {
      text = await this._callOpenAICompat({ apiKey, model, system, userPrompt, baseUrl, extraHeaders: spec.extraHeaders, noKey: spec.noKey });
    }

    const pick = this._parse(text);
    if (!pick) throw new Error('LLM returned unparseable output: ' + text);
    return pick;
  }

  async _callAnthropic({ apiKey, model, system, userPrompt, baseUrl }) {
    const res = await fetch(baseUrl.replace(/\/$/, '') + '/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    if (!res.ok) throw new Error('Anthropic API ' + res.status + ': ' + (await res.text()));
    const data = await res.json();
    const block = (data.content || []).find((c) => c.type === 'text');
    return block ? block.text : '';
  }

  async _callGemini({ apiKey, model, system, userPrompt, baseUrl }) {
    const url = baseUrl.replace(/\/$/, '') +
      '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);

    // generationConfig:
    //  - responseMimeType/responseSchema force a clean JSON object so parsing is reliable.
    //  - maxOutputTokens is generous because Gemini 2.5 "thinking" models spend part of the
    //    budget on internal reasoning; a small cap makes them stop with empty text
    //    (finishReason MAX_TOKENS) and produce no answer at all.
    const generationConfig = {
      maxOutputTokens: 2048,
      temperature: 0.8,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          artist: { type: 'string' },
          title: { type: 'string' }
        },
        required: ['artist', 'title']
      }
    };

    // For 2.5 "flash" thinking models, disable thinking so the whole budget goes to the
    // answer (and responses are faster). gemini-2.5-pro can't disable thinking, so it just
    // relies on the larger token budget above.
    if (/2\.5-flash|flash-lite/i.test(model)) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig
      })
    });
    if (!res.ok) throw new Error('Gemini API ' + res.status + ': ' + (await res.text()));
    const data = await res.json();

    // Surface request-level blocks (e.g. safety filters on the prompt) with a clear reason.
    if (data.promptFeedback && data.promptFeedback.blockReason) {
      throw new Error('Gemini blocked the request: ' + data.promptFeedback.blockReason);
    }

    const cand = (data.candidates && data.candidates[0]) || null;
    const parts = (cand && cand.content && cand.content.parts) || [];
    const text = parts.map((p) => (p && p.text) || '').join('').trim();
    if (text) return text;

    // No usable text — explain why instead of bubbling up an empty "unparseable" error.
    const reason = cand && cand.finishReason ? cand.finishReason : 'unknown';
    if (reason === 'MAX_TOKENS') {
      throw new Error('Gemini hit the output token limit before returning an answer ' +
        '(finishReason=MAX_TOKENS). Try a non-thinking model such as gemini-2.0-flash.');
    }
    throw new Error('Gemini returned no text content (finishReason=' + reason + ').');
  }

  async _callOpenAICompat({ apiKey, model, system, userPrompt, baseUrl, extraHeaders, noKey }) {
    const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
    const headers = { 'content-type': 'application/json' };
    if (!noKey) headers.Authorization = 'Bearer ' + apiKey;
    if (extraHeaders) Object.assign(headers, extraHeaders);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: userPrompt }
        ],
        temperature: 0.8,
        max_tokens: 200
      })
    });
    if (!res.ok) throw new Error('LLM API ' + res.status + ': ' + (await res.text()));
    const data = await res.json();
    return data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
  }

  _parse(text) {
    if (!text) return null;

    // Strip markdown code fences some models wrap JSON in (```json ... ```).
    let cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1').trim();

    // Try a few candidates: the whole string, then the widest {...} span, then the first
    // balanced {...}. The first that parses into an object with a title wins.
    const candidates = [cleaned];
    const wide = cleaned.match(/\{[\s\S]*\}/);     // greedy: full object even when nested
    if (wide) candidates.push(wide[0]);
    const narrow = cleaned.match(/\{[\s\S]*?\}/);  // lazy: first flat object
    if (narrow) candidates.push(narrow[0]);

    for (const candidate of candidates) {
      try {
        const obj = JSON.parse(candidate);
        if (obj && obj.title) {
          return { artist: (obj.artist || '').toString().trim(), title: obj.title.toString().trim() };
        }
      } catch (e) {
        // try the next candidate
      }
    }
    return null;
  }
}

module.exports = LLMRecommender;
