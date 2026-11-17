# Deployment

The stack runs on spark from this checkout: `bash deploy.sh`
(compose down, then up with a rebuild). It builds the current commit
(`git rev-parse --short HEAD`) into the backend and frontend as `GIT_COMMIT`:
`GET /api/health/` reports it, the page footer shows it, and feedback is
stamped with it. Commit before deploying so the stamp means something. Migrations and collectstatic run
automatically in the backend entrypoint; wait for `docker compose ps` to show
`backend` healthy.

| Service   | What it is                                      | Host port        |
| --------- | ----------------------------------------------- | ---------------- |
| `db`      | Postgres 17, data in the `postgres_data` volume | none             |
| `backend` | Django API under gunicorn (2 workers x 16 threads) | `127.0.0.1:8400` |
| `worker`  | Same image; runs classifications, then archives post images, 48 at a time | none |
| `inference` | vLLM serving the local model (`Qwen/Qwen3.5-9B`, FP8) on the GPU, weights in the `inference_models` volume | none |
| `web`     | nginx: built frontend, proxies `/api/` to backend | `127.0.0.1:3400` (port 80); 8080 for the tunnel, not published |
| `cloudflared` | Cloudflare Tunnel to `brainrotindex.com`; profile `public` only | none |

All configuration lives in `.env` (see `.env.example`). Post images live in
the `post_images` volume, mounted at `/app/media` in `backend` and `worker`.

## Inference

`INFERENCE_SOURCE=openrouter` (default) uses `OPENROUTER_MODEL`
(default `google/gemini-2.5-flash-lite`). `INFERENCE_SOURCE=local` sends the
same requests to `LOCAL_INFERENCE_BASE_URL` (an OpenAI-compatible server, URL
ending in `/v1`) with `LOCAL_INFERENCE_MODEL`. Redeploy after changing them.

The `inference` service is that local server: NVIDIA's vLLM container
(`nvcr.io/nvidia/vllm:26.10.pre1-py3`) serving `Qwen/Qwen3.5-9B` from Hugging
Face, quantized to FP8 at load and named `Qwen/Qwen3.5-9B-FP8`, with thinking
off. Use it with `LOCAL_INFERENCE_BASE_URL=http://inference:8000/v1` and
`LOCAL_INFERENCE_MODEL=Qwen/Qwen3.5-9B-FP8`. It has no host port; the worker
reaches it on the compose network and starts only once it is healthy, which
takes about three minutes after a deploy. It budgets 35% of the GPU's unified
memory (about 43 GB). The weights (18 GB) download into the `inference_models`
volume on first start.

To go back to OpenRouter, set `INFERENCE_SOURCE=openrouter` in `.env` and run
`bash deploy.sh`.

## Addresses

Both addresses serve the same site. `SITE_URL` is the primary one (emailed
links point there); `EXTRA_SITE_URLS` lists the others. Both go into
`ALLOWED_HOSTS`, the CSRF trusted origins and CORS.

| Address | Path | nginx port |
| --- | --- | --- |
| `https://brainrot.jacob-waters.com` (tailnet only) | Caddy (`/home/jacob/git-repos/reverse-proxy`) -> `127.0.0.1:3400` | 80 |
| `https://brainrotindex.com` | Cloudflare -> `cloudflared` container -> `web:8080` | 8080 |

nginx works out the client address by port and sends it to Django as
`X-Real-IP` and as the only `X-Forwarded-For` entry, replacing whatever the
client sent. Port 8080 is not published on the host, so only the tunnel
reaches it, and there it uses `CF-Connecting-IP`. On port 80 it uses the
address Caddy wrote into `X-Forwarded-For`. Every throttle keys on that
address (`api/client_address.py`).

`/admin/` answers 404 for `brainrotindex.com` and `www.brainrotindex.com`
and for anything on port 8080. `www.brainrotindex.com` redirects to
`brainrotindex.com`.

## Going public

The tunnel `brainrotindex` (id `662bc646-f90d-4409-8f0b-95e92901a75d`)
exists; its credentials are in `~/.cloudflared-brainrotindex` on spark,
mounted read only into the `cloudflared` service, which runs as uid 1000 to
read them. `cloudflared/config.yml` sends `brainrotindex.com` and
`www.brainrotindex.com` to `http://web:8080`. The service is in the compose
profile `public`, so it starts only when that profile is on. On spark, in
this checkout:

1. Point the DNS names at the tunnel (once):

       docker run --rm -e HOME=/h -v ~/.cloudflared-brainrotindex:/h/.cloudflared --user $(id -u):$(id -g) cloudflare/cloudflared:latest tunnel route dns brainrotindex brainrotindex.com
       docker run --rm -e HOME=/h -v ~/.cloudflared-brainrotindex:/h/.cloudflared --user $(id -u):$(id -g) cloudflare/cloudflared:latest tunnel route dns brainrotindex www.brainrotindex.com

2. Make the public address primary and keep the private one, and turn the
   profile on (edit the existing `SITE_URL` and `EXTRA_SITE_URLS` lines):

       SITE_URL=https://brainrotindex.com
       EXTRA_SITE_URLS=https://brainrot.jacob-waters.com
       COMPOSE_PROFILES=public

3. Add `https://brainrotindex.com` to the Google OAuth client's Authorized
   JavaScript origins.

4. `bash deploy.sh`, then check: `docker compose ps cloudflared` and
   `docker compose logs cloudflared` (look for "Registered tunnel connection").

To go dark again: `docker compose stop cloudflared`, and remove
`COMPOSE_PROFILES=public` from `.env` so the next deploy does not start it.
The DNS records can stay; without a connector Cloudflare answers with an
error page.

## Accounts

- New accounts need an invite code while `SIGNUP_REQUIRES_INVITE=true`
  (email and Google sign-up alike; existing accounts never do). Make one:
  `docker compose exec backend python manage.py create_invite --note "for Sam" --max-uses 5`.
  The admin lists codes and their uses and can deactivate one.
- The extension (token, config, classify) works only for accounts with a
  verified email; Google sign-ins count as verified. For an older account that
  never verified:
  `docker compose exec backend python manage.py mark_email_verified you@example.com`
- Each account gets `DAILY_NEW_POST_QUOTA` (default 3000) posts a day (UTC)
  that nobody has classified yet; posts already classified are always
  answered. Counts are `DailyNewPostCount` rows (in the admin).
- Throttle counters live in the database cache table `django_cache`, made by
  the backend entrypoint (`createcachetable`).

## Email

`EMAIL_DELIVERY=console` (the default) writes every email, links included, to
the backend log instead of sending it: `docker compose logs backend`.
Set `EMAIL_DELIVERY=resend` once the Resend account can send from
`brainrotindex.com`. Emails are sent after the response, so a failed send
does not fail the sign-up; it is logged at error level with the reason:
`docker compose logs backend | grep failed`.

## Google OAuth checklist

The Google OAuth Web client must list the site address (`SITE_URL`) as an
Authorized JavaScript origin, and the same client ID goes in `.env` as
`GOOGLE_CLIENT_ID`. The frontend has the id built in, so redeploy after changing it.

## Admin

The Django admin at `/admin/` (private address only) lists posts, images,
plugins, classifications, user settings, invite codes, and feedback. Make an account staff once:
`docker compose exec backend python manage.py shell -c "from django.contrib.auth.models import User; User.objects.filter(email='you@example.com').update(is_staff=True, is_superuser=True)"`

## Useful commands

- Logs: `docker compose logs -f web backend`
- Backend tests: `docker compose exec backend python manage.py test api classification feedback`
- Evaluate a model against `eval/dataset.jsonl` (the folder is mounted, not built in; see `eval/README.md`): `docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/eval:/app/eval" --entrypoint python backend manage.py evaluate_plugins --dataset /app/eval/dataset.jsonl --inference-source openrouter --model google/gemini-2.5-flash-lite`
- Worker logs: `docker compose logs -f worker`
- Local model logs: `docker compose logs -f inference`
- nginx checks against the running stack (admin blocked on the public host, www redirect): `bash frontend/brainrot-index-frontend/check-nginx.sh`
- Frontend tests: `docker build --target build -t brainrot-index-frontend-test frontend/brainrot-index-frontend && docker run --rm brainrot-index-frontend-test npx vitest run`
- Django shell: `docker compose exec backend python manage.py shell`
