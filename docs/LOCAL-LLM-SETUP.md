# The model chain — setting it up by hand

What this builds:

```
  datamatter (Vercel)
        |
        |  https, shared secret in the Authorization header
        v
  llmpowerhouses.taila4b91f.ts.net:8443        Tailscale Funnel (public)
        |
        v
  127.0.0.1:11435   scripts/llm_funnel_proxy.js   checks the secret, allows two paths
        |
        v
  127.0.0.1:11434   Ollama            qwen3.8  -> first
                                      qwen3.6  -> second
        ⋮
  generativelanguage.googleapis.com   gemini   -> last, and only if the two above are silent
```

The order is fixed in code: **local primary → local secondary → commercial**. The chain
only moves down it, never up, and the page names the model that answered every time —
an answer from the commercial model is a different artifact from one by the tuned local
model, and a reader has to be able to tell.

---

## 1. Get the two local tags exactly right

```bash
ollama list
```

Copy the **NAME** column exactly — `qwen3.8:27b-q8` is a different string from
`qwen3.8 27b q8`, and the site checks the tag against the server's own list before it
sends anything. A tag the server does not hold is a reason to move down the chain, never
a reason to start a multi-gigabyte pull.

While you are there, keep the big model resident so the first question of the day is not
a cold load:

```bash
launchctl setenv OLLAMA_KEEP_ALIVE 30m     # then restart Ollama
```

## 2. A secret, and something that checks it

Ollama has no authentication. Funnel puts the port on the public internet. So nothing
should ever funnel straight to 11434.

```bash
openssl rand -base64 32        # this is LOCAL_LLM_SHARED_SECRET; keep it out of git
```

Run the proxy that ships with this repo:

```bash
cd /Volumes/AI_DATA/git/datamatter
LLM_SHARED_SECRET='<the secret>' node scripts/llm_funnel_proxy.js
# llm funnel proxy on 127.0.0.1:11435 -> http://127.0.0.1:11434
# allowed: /api/tags, /api/chat, /api/show, /v1/models, /v1/chat/completions
```

It checks the secret on `Authorization: Bearer` **or** `X-LLM-Secret` (the site sends
both), allows only tag-listing and chat, and answers **404** to everything else —
`/api/pull`, `/api/delete`, `/api/create` are how an open model server becomes somebody
else's disk and somebody else's GPU. It logs method, path, status and duration, and no
prompt text.

Verify locally before exposing anything:

```bash
S='<the secret>'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:11435/api/tags                       # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $S" http://127.0.0.1:11435/api/tags   # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $S" \
     -d '{}' http://127.0.0.1:11435/api/pull                                                   # 404
```

To keep it running across reboots, `~/Library/LaunchAgents/com.datamatter.llmproxy.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.datamatter.llmproxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Volumes/AI_DATA/git/datamatter/scripts/llm_funnel_proxy.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>LLM_SHARED_SECRET</key><string>THE-SECRET</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/tmp/llmproxy.err</string>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.datamatter.llmproxy.plist
```

(`which node` first — the path above must be the real one.)

## 3. Point the funnel at the proxy, not at Ollama

```bash
tailscale funnel --bg --https=8443 http://127.0.0.1:11435
tailscale funnel status
```

Funnel allows only ports 443, 8443 and 10000; 8443 is what the site is configured for.
`--bg` keeps it up across reboots. To take it down:

```bash
tailscale funnel --https=8443 off
```

Then check it from **off** your network — a phone on cellular is the honest test:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://llmpowerhouses.taila4b91f.ts.net:8443/api/tags   # 401
curl -s -H "Authorization: Bearer $S" https://llmpowerhouses.taila4b91f.ts.net:8443/api/tags       # your tags
```

A 401 from the open internet is the result you want: the port is reachable and useless
without the secret.

## 4. The commercial fallback

A key from Google AI Studio, and the OpenAI-compatible endpoint:

```bash
curl -s https://generativelanguage.googleapis.com/v1beta/openai/chat/completions \
  -H "Authorization: Bearer $GEMINI_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gemini-3.5-flash-lite","messages":[{"role":"user","content":"one word reply"}]}' \
  | head -c 300
```

If that returns a completion, the model id is right. Any other OpenAI-compatible
provider works the same way — set `CLOUD_LLM_BASE_URL` to its base and the model id to
whatever it calls the model.

## 5. Environment

Same six values in `.env.local` (for `npm run dev` and `npm run verify`) and in Vercel →
Settings → Environment Variables (Production and Preview):

```
LOCAL_LLM_FUNNEL_URL=https://llmpowerhouses.taila4b91f.ts.net:8443
LOCAL_LLM_SHARED_SECRET=<the secret from step 2>
LOCAL_LLM_MODEL_PRIMARY=<exact tag of qwen3.8, from step 1>
LOCAL_LLM_MODEL_SECONDARY=<exact tag of qwen3.6, from step 1>

CLOUD_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
CLOUD_LLM_MODEL=gemini-3.5-flash-lite
CLOUD_LLM_API_KEY=<the key from step 4>

JBOOK_TOKEN=<a long random string>      # without this, authoring stays closed
```

Nothing here is read at build time, so a change to any of them needs a redeploy only to
reach the running functions — `vercel env add` then redeploy, or set them in the
dashboard and redeploy.

Optional: `LLM_TIMEOUT_MS` (local, default 120000), `LLM_CLOUD_TIMEOUT_MS` (default
60000), `LLM_HEALTH_TIMEOUT_MS` (default 6000).

## 6. Verify the chain, from the site

```bash
curl -s https://datamatter.vercel.app/api/chat | python3 -m json.tool
```

Every link reports its own state:

| state | means |
|---|---|
| `ready` | answering |
| `model-missing` | the server answered but does not hold that tag — check step 1 |
| `refused` | the secret was rejected — the site and the proxy disagree |
| `unreachable` | asleep, funnel down, or the proxy is not running |

Then ask something and watch which link answers:

```bash
curl -sN -X POST https://datamatter.vercel.app/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"What must a Program Change Summary carry?"}]}' \
  | head -20
```

`event: link` names the model that started; `event: fallback` says why a link was passed
over; `event: done` names the model that finished. The page shows the same three things.

## 7. What you will see on the page

The chain strip under the chat shows all three links and their states, and the answer
carries a line saying which model produced it — gold for a local model, amber for the
commercial one. A fallback prints its reason above the answer ("the server is answering
but does not hold qwen3.8:27b-q8 — moved down the chain").

## Things worth knowing

- **Fallback happens before the first token, never after it.** Once a model has started
  writing, a failure is reported as a truncated answer rather than being silently
  replaced by a different model's text mid-paragraph.
- **Vercel functions stop at 120 seconds** (`maxDuration` in `app/api/chat/route.ts`). A
  27B model on a long question with a retrieval block can approach that. If answers
  truncate, make the 3.6 the primary or raise nothing and accept shorter answers — the
  cloud link is not a fix for slowness, it is a fix for silence.
- **The secret is the whole perimeter.** Rotate it by changing it in both places at
  once; the site sends it on every request and holds nothing.
- **No prompt, completion or key is ever logged** — not by the site, not by the proxy.
  The footer of datamatter says no controlled unclassified information transits it, and
  that has to stay true of the model path too.
