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

The site has been public at `https://brainrotindex.com` since 2026-11-17.
These are the steps that made it so; run them again only after going dark.

The tunnel `brainrotindex` (id `662bc646-f90d-4409-8f0b-95e92901a75d`)
exists; its credentials are in `~/.cloudflared-brainrotindex` on spark,
mounted read only into the `cloudflared` service, which runs as uid 1000 to
read them. `cloudflared/config.yml` sends `brainrotindex.com` and
`www.brainrotindex.com` to `http://web:8080`. The service is in the compose
profile `public`, so it starts only when that profile is on. On spark, in
this checkout:

1. Point the DNS names at the tunnel (once; done):

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

- Sign-up is open (`SIGNUP_REQUIRES_INVITE=false`, the default). With
  `SIGNUP_REQUIRES_INVITE=true`, new accounts need an invite code (email and
  Google sign-up alike; existing accounts never do), and the sign-up page shows
  the code field (it asks `/api/auth/csrf/`). Make one:
  `docker compose exec backend python manage.py create_invite --note "for Sam" --max-uses 5`.
  The admin lists codes and their uses and can deactivate one.
- The extension (token, config, classify) works only for accounts with a
  verified email; Google sign-ins count as verified. For an older account that
  never verified:
  `docker compose exec backend python manage.py mark_email_verified you@example.com`
- Each account gets `DAILY_NEW_POST_QUOTA` (default 10000) posts a day (UTC)
  that nobody has classified yet; posts already classified are always
  answered. Counts are `DailyNewPostCount` rows (in the admin).
- Throttle counters live in the database cache table `django_cache`, made by
  the backend entrypoint (`createcachetable`).
- People manage their own account on `/account`: change the password, sign out
  of every browser and extension, download their data as JSON, and delete the
  account (which cancels a paid Stripe subscription first; posts and
  classifications stay, since they are not linked to anyone).

## The extension download and the Web Store

The `web` image packs `extension/` with `scripts/package-extension.mjs` while
it builds (compose passes `extension/` and `scripts/` as named build contexts)
and serves it at `/downloads/brainrot-index-extension.zip` (always the newest)
and `/downloads/brainrot-index-extension-<version>.zip`. The version is the one
in `extension/manifest.json`; bump it by hand when the extension changes, as
`extension/README.md` describes (Version numbers). The
packed manifest grants only `https://brainrotindex.com`.

`/install` explains Load unpacked from that zip. Once the Chrome Web Store
listing is live, set `WEBSTORE_URL=<listing address>` in `.env` and redeploy;
the page then shows a single "Add to Brave or Chrome" button. Submitting the
listing is described in `docs/webstore/README.md`.

## Contact

There is no support mailbox. People reach the owner with the contact form at
`/contact` (the footer's Contact link) or the Feedback button on every page;
someone not signed in may add an email address for a reply to feedback, and
the contact form always asks for one. Each message is stored in the inbox
(`/inbox`, see README.md) and emailed, with a link to its inbox item, to
`ADMIN_EMAIL` through the normal transactional mail setup, with Reply-To set
to the sender's address. A failed email is logged and never fails the message.

## Payments (Stripe)

Every account gets a 7-day free trial when it is created, with no card. When
the trial ends, `/api/extension/config/` and `/api/classify/` answer 402 and
the dashboard and extension popup say "Your free trial has ended. Subscribe to
continue." Subscribing goes through Stripe Checkout ($5/month); the dashboard's
Manage subscription button opens the Stripe Customer Portal (cancel, change card,
invoices). A cancellation keeps access until the end of the paid month.

Which Stripe account: `STRIPE_SECRET_KEY` in `.env` (the Brainrot Index
account) when it is set, otherwise `STRIPE_TEST_SECRET_KEY` (the test mode of
the account shared with YouArt Studios). A key starting `sk_live_` or
`rk_live_` means live mode: real cards are charged.

Subscriptions keep the Stripe customer and subscription ids of the account
they were made in. After switching accounts, an id the new account does not
know is dropped the first time it is used, and that person counts as never
having subscribed (their 7-day trial still applies if it has not run out).

### First setup (once per Stripe account)

    docker compose exec backend python manage.py setup_stripe          # test key
    docker compose exec backend python manage.py setup_stripe --live   # live key

It creates the "Brainrot Index" product (card statements read
"BRAINROT INDEX") with its $5/month price (lookup key
`brainrot_index_monthly`) and this site's Customer Portal configuration. It is
safe to run again; whatever exists is left alone. With a live key it refuses
to run without `--live`, and `--live` with a test key is refused too.

Until the webhook exists, the site still works: the page Checkout returns to
asks the backend to read the finished payment from Stripe, the dashboard reads
the subscription from Stripe each time it loads, and when a paid month seems
over the backend asks Stripe whether it renewed.

### Free accounts

    docker compose exec backend python manage.py grant_comp you@example.com
    docker compose exec backend python manage.py grant_comp someone@example.com --revoke

A comp account is never asked to pay. The admin at `/admin/` lists every
subscription and the Stripe events received.

### Go-live: the webhook (once the site is public)

Stripe can only deliver webhooks to a public address, so this waits for
`brainrotindex.com` (see Public address above).

1. Finish "Going public" above. Checkout and the portal send people back to
   whichever site address they started from.
2. Create the webhook endpoint in the account the key belongs to and put its
   signing secret into `.env` without it appearing on screen. A secret from
   another Stripe account does not work, so after switching accounts this is
   run again. Run from this checkout on spark (live key; drop `--live` for a
   test key):

       secret=$(docker compose exec -T backend python manage.py setup_stripe --live --webhook-url https://brainrotindex.com/api/stripe/webhook/) && sed -i "s|^STRIPE_WEBHOOK_SECRET=.*|STRIPE_WEBHOOK_SECRET=${secret}|" .env; unset secret

   With `--webhook-url` the command writes only the secret to standard output
   (messages go to standard error) and refuses to run unless standard output is
   a pipe. Stripe shows a signing secret only when the endpoint is created; if
   an endpoint for that address exists already, the command stops and says so.
3. Check that the line is filled without printing it:
   `grep -c '^STRIPE_WEBHOOK_SECRET=whsec_' .env` prints `1`.
4. `bash deploy.sh`, so the backend reads the new secret.
5. In the Stripe dashboard, Developers -> Webhooks -> the new endpoint should
   show as enabled. Events for customers that are not ours are answered 200
   and ignored.

### Go-live: live payments

1. Put the Brainrot Index account's live secret key in `.env` as
   `STRIPE_SECRET_KEY=` (by hand; nothing prints it).
2. `bash deploy.sh`, then `setup_stripe --live` (First setup above).
3. The webhook steps above, with `--live`.

## Email

The live site sends through Resend (`EMAIL_DELIVERY=resend`) from
`noreply@brainrotindex.com`. `EMAIL_DELIVERY=console` (the default) writes
every email, links included, to the backend log instead:
`docker compose logs backend`. Emails are sent after the response, so a failed send
does not fail the sign-up; it is logged at error level with the reason:
`docker compose logs backend | grep failed`.

## Google OAuth checklist

The Google OAuth Web client must list the site address (`SITE_URL`) as an
Authorized JavaScript origin, and the same client ID goes in `.env` as
`GOOGLE_CLIENT_ID`. The frontend has the id built in, so redeploy after changing it.

## Admin

The Django admin at `/admin/` (private address only) lists posts, images,
plugins, classifications, user settings, invite codes, subscriptions, and
feedback. Exactly one account can open it: the one whose email is
`ADMIN_EMAIL` in `.env`, in a session that signed in with Google (the session
records how it signed in). Signing in with Google makes that account staff and
superuser; no other account gets in, whatever its `is_staff`. The admin's own
login page sends people to the site's `/login`. To open it: sign in with
Google at `https://brainrot.jacob-waters.com/login`, then go to `/admin/`.

## Useful commands

- Logs: `docker compose logs -f web backend`
- Backend tests: `docker compose exec backend python manage.py test api billing classification feedback`
- Score a model and the filters' rubrics against the owner's thumbs: `docker compose exec -T backend python manage.py evaluate_plugins --inference-source openrouter --model google/gemini-2.5-flash-lite`. `--plugin <slug>` (and `--rubric-version <n>`) scores one filter only.
- Run a feature set experiment (every filter composed of scored features, measured on the owner's thumbs beside the live filters; it opens on the site at `/tuning/features/<id>`): `docker compose exec -T backend python manage.py run_feature_experiment`. `--from-experiment <id>` runs a draft edited on the page instead of the saved feature set; `--resume <id>` finishes an interrupted run.
- Live filtering by feature scores: the four default filters are decided from one rating call per post (`FEATURE_SCORING`, on by default). To go back to one rubric call per filter, set `FEATURE_SCORING=false` in `.env` and run `docker compose up -d backend worker`. Ratings and rubric classifications are cached apart, so switching either way keeps both.
- Worker logs: `docker compose logs -f worker`
- Local model logs: `docker compose logs -f inference`
- nginx checks against the running stack (admin blocked on the public host, www redirect): `bash frontend/brainrot-index-frontend/check-nginx.sh`
- Frontend tests: `docker build --target build -t brainrot-index-frontend-test frontend/brainrot-index-frontend && docker run --rm brainrot-index-frontend-test npx vitest run`
- Django shell: `docker compose exec backend python manage.py shell`
