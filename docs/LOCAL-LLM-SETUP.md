# The model chain — how datamatter reaches the Mac Studio

> **Read this before touching `tailscale funnel`.** An earlier version of this
> file told you to take port 8443 off the funnel and point it somewhere new.
> That port is `agent-server`'s, and turning it off took `aibrainbank` and
> DeepTutor's LLM route down with it. Nothing in this file changes the funnel's
> existing allocation, and nothing should.

## What is already on this machine

Confirmed in `apps/deeptutormac/deeptutor/DEEPTUTOR_MAC_HOSTING_SOP_QA.md` and
`apps/deeptutormac/MAC_DEEPTUTOR_FUNNEL_SETUP.md`. Tailscale Funnel allows
exactly three public ports per tailnet and all three are spoken for:

| Funnel port | Service | Local port | Authenticates with | API shape |
|---|---|---|---|---|
| 443 | `gateway.py` | 8787 | shared secret + model allow-list | `/health`, `/v1/chat/completions` (buffered, not streamed) |
| 8443 | `agent-server` | 8788 | hashed keys with scopes (`keys.db`) | `/health`, `/v1/models`, `/v1/chat/completions` (streams) |
| 10000 | DeepTutor backend | 8001 | its own | — |

Both LLM paths are **OpenAI-compatible**. Neither is raw Ollama, and Ollama
itself is never exposed. datamatter talks to **agent-server on 8443**, because
it streams and it publishes a model list, so a wrong tag is a named error
rather than a silent failure.

```
  datamatter (Vercel)
        |  https, Bearer <agent-server key>, POST /v1/chat/completions
        v
  llmpowerhouses.taila4b91f.ts.net:8443        Tailscale Funnel (--bg, survives reboots)
        v
  127.0.0.1:8788   agent-server        model: qwen3.8:27b-q8_0   -> first
                                       model: qwen3.6:35b-a3b    -> second
        ⋮
  generativelanguage.googleapis.com    gemini -> last, only if both above are silent
```

## If the funnel entry is missing

`--bg` entries persist across reboots; they disappear only if something removed
them. Restore just the one port, without touching 443 or 10000:

```bash
tailscale funnel --bg --https=8443 http://127.0.0.1:8788
tailscale funnel status          # expect 443, 8443 and 10000 all listed
```

Check agent-server itself is up. **401 is the healthy answer** — the server is
there and demanding a key:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8788/health    # 401 = up, 000 = down
```

## 1 — a key for datamatter

Give the site its own key rather than reusing another app's, so it can be
revoked on its own. `chat` scope only: datamatter does its own retrieval
against Neon and the knowledge index, so the agent loop's tools would only
duplicate that work and slow the answer down.

```bash
cd /Volumes/AI_DATA/apps/agent-server
python3 keys_admin.py create datamatter --scope chat
```

Copy the raw key it prints once. It is stored hashed and cannot be read back.

## 2 — the exact model tags

```bash
curl -s -H "Authorization: Bearer <the key>" \
  https://llmpowerhouses.taila4b91f.ts.net:8443/v1/models | python3 -m json.tool
```

That list is what the site checks its configured tags against, and it carries
`loaded` and `size_gb` per model — a tag that is not resident pays a cold load
of tens of seconds on the first question. As of this writing the two to use are
`qwen3.8:27b-q8_0` and `qwen3.6:35b-a3b`.

## 3 — the commercial fallback

A Gemini key from AI Studio, on the OpenAI-compatible endpoint:

```bash
curl -s https://generativelanguage.googleapis.com/v1beta/openai/chat/completions \
  -H "Authorization: Bearer $GEMINI_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gemini-3.5-flash-lite","messages":[{"role":"user","content":"one word reply"}]}' \
  | head -c 300
```

## 4 — the environment

The same values in `.env.local` and in Vercel → Settings → Environment
Variables (Production and Preview):

```
LOCAL_LLM_FUNNEL_URL=https://llmpowerhouses.taila4b91f.ts.net:8443
LOCAL_LLM_API_KEY=<the agent-server key from step 1>
LOCAL_LLM_MODEL_PRIMARY=qwen3.8:27b-q8_0
LOCAL_LLM_MODEL_SECONDARY=qwen3.6:35b-a3b
LOCAL_LLM_TIMEOUT_MS=170000

CLOUD_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
CLOUD_LLM_MODEL=gemini-3.5-flash-lite
CLOUD_LLM_API_KEY=<the Gemini key>

JBOOK_TOKEN=<a long random string>      # without this, authoring stays closed
```

`/v1` is appended to `LOCAL_LLM_FUNNEL_URL` automatically; writing it either way
works. `LOCAL_LLM_SHARED_SECRET` is still read as a fallback for the key, so an
older configuration keeps working.

**Pointing at `gateway.py` on 443 instead** works too — set
`LOCAL_LLM_FUNNEL_URL=https://llmpowerhouses.taila4b91f.ts.net` and use the
gateway's shared secret. Two differences worth knowing: it publishes no model
list (so a wrong tag surfaces on the first question rather than in the status
check), and it buffers the whole completion before returning it, so answers
arrive in one block rather than streaming.

**Pointing at raw Ollama** — `LOCAL_LLM_API=ollama` switches the local links
back to `/api/tags` and `/api/chat`. Nothing on this Mac is set up that way, and
exposing 11434 through a funnel without something in front of it would be
unauthenticated.

## 5 — verify from the site

```bash
curl -s https://datamatter.vercel.app/api/chat | python3 -m json.tool
```

Each link reports its own state:

| state | means |
|---|---|
| `ready` | answering |
| `model-missing` | the server answered and does not offer that tag — compare with step 2 |
| `refused` | the key was rejected |
| `unreachable` | asleep, funnel entry missing, or the service is not running |

Then watch which link answers:

```bash
curl -sN -X POST https://datamatter.vercel.app/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"What must a Program Change Summary carry?"}]}' \
  | head -20
```

`event: link` names the model that started, `event: fallback` says why one was
passed over, `event: done` names the model that finished. The page shows the
same three things.

## Things worth knowing

- **Fallback happens before the first token, never after it.** Once a model has
  started writing, a failure is reported as a truncated answer rather than
  being silently replaced by a different model's text mid-paragraph.
- **Vercel functions stop at 120 seconds** (`maxDuration` in
  `app/api/chat/route.ts`), and agent-server's own upstream timeout is 170s. The
  site will give up first on a very slow answer. The cloud link is not a fix for
  slowness — it only answers when the local links are silent.
- **A cold model costs tens of seconds** on the first question. `/v1/models`
  reports which are resident.
- **No prompt, completion or key is ever logged** by the site. The footer of
  datamatter says no controlled unclassified information transits it, and that
  has to stay true of the model path too.
