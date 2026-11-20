# BrainRot Index

A browser extension classifies social media posts with an LLM and hides the
unwanted ones: rude or toxic posts, ultra low effort posts, engagement bait,
and brainrot. This repository holds the website behind it: accounts,
subscriptions, and the classification API.

It contains email/password and Google sign-in, the classification API the
extension calls, the worker that runs the model, a dashboard for settings, and
a feedback button, on a Django + Postgres backend and a plain JavaScript
frontend.

The site is public at https://brainrotindex.com (Cloudflare Tunnel to spark).

## How classification works

The extension sends each post it sees to `POST /api/classify/`. Every post is
stored once (`Post`, with its images downloaded to the `post_images` volume).
Each plugin (the defaults are Rude or Toxic, Low Effort, Engagement Bait, and
Brainrot) is a rubric prompt with immutable versions. A version with criteria asks the model
only yes-or-no questions about the post, and the score is the sum of the
points of the criteria met, added up in code (`classification/scoring.py`);
an older version or a store plugin asks the model for the score. A
`Classification` row per (post, plugin version) is
the shared cache, so a post costs one model call per plugin version no matter
how many users see it. A YouTube video's transcript is fetched once by the
worker (`VideoTranscript`) before the video is classified, and the model reads
its first 2000 words; a video without one is classified on its title and
thumbnail. The `worker` service takes pending rows from Postgres
and calls the model; the endpoint waits up to 1.5 s so most posts come back
done on the first call. Each user's threshold and blur/hide choice per plugin
decide the action. An account may send `DAILY_NEW_POST_QUOTA` posts a day that
are not in the cache yet; past that, such posts come back `allow` with
`"notice": "daily_limit_reached"` and are not stored, while cached posts are
still answered.

Extension calls are answered 402 once an account's 7-day trial has ended
without a subscription; `billing.access.account_has_access` decides it. See
`DEPLOY.md`, Payments.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/extension/config/` | extension token, verified email | master switch, mode, pending action |
| `POST /api/classify/` | extension token, verified email | up to 25 posts in, allow/blur/hide out |
| `POST /api/extension/token/` | session, verified email | new extension token, returned once |
| `GET, PATCH /api/settings/` | session | `{enabled, mode, allow_reveal}` |
| `GET /api/plugins/` | session | `{plugins: [{slug, name, description, enabled, threshold, flagged_action}]}` |
| `PATCH /api/plugins/<slug>/` | session | change `enabled`, `threshold`, `flagged_action` |
| `GET /api/billing/` | session | trial days left, subscription status, `has_access` |
| `POST /api/billing/checkout/` | session | a Stripe Checkout address for the $5/month plan |
| `POST /api/billing/checkout/reconcile/` | session | `{session_id}`: reads a finished Checkout from Stripe |
| `POST /api/billing/portal/` | session | a Stripe Customer Portal address |
| `POST /api/stripe/webhook/` | Stripe signature | subscription and invoice events |
| `POST /api/feedback/` | session, extension token, or none (20 an hour per address) | a problem report, stamped with the running commit |
| `POST /api/contact/` | session or none (shares the feedback limit) | `{name, email, subject, message}` from the contact form |
| `GET /api/inbox/?status=open\|resolved\|all` | the owner (as for `/admin/`) | every inbox item with full context, newest first |
| `GET /api/inbox/<item id>/` | the owner | one item, such as `feedback-12` or `judgment-34` |
| `POST /api/inbox/<item id>/resolve/` | the owner | `{commit, note}`; the commit may be blank |
| `GET /api/onboarding/` | session | `{email_verified, extension_connected, feed_opened}` for the setup checklist |
| `POST /api/account/change-password/` | session | `{current_password, new_password}`; other sessions end |
| `POST /api/account/sign-out-everywhere/` | session | ends every session and disconnects every extension |
| `GET /api/account/export/` | session | the account's data as a JSON file |
| `POST /api/account/delete/` | session | `{email}` typed to confirm; cancels a paid subscription, deletes the account and its rows |

## Working through feedback

The inbox holds every `Feedback` row (the Feedback button, extension reports
and the contact form) and every reader's thumbs up or down on a post
(`PostJudgment`), newest first. Each item carries the sender, the message, the
post with its images, video and transcript, what every filter decided (score,
threshold, reasoning, and each rubric criterion with whether it was met), and
the site and extension commits it was written against.

- The owner reads it at `/inbox` on the site, signed in with Google as
  `ADMIN_EMAIL`; each alert email links to its item there.
- An agent on the server reads the same items as JSON:
  `docker compose exec backend python manage.py list_inbox` (`--status resolved`
  or `--status all` for the rest).
- Once fixed and committed, mark items resolved with that commit:
  `docker compose exec backend python manage.py resolve_inbox feedback-17 judgment-20 --commit <hash> --note "what was wrong"`.
  `--commit` may be left out when nothing needed fixing. Items are never deleted.
  A judgment the reader changes after it was resolved is open again.

## Layout

| Path                                | What it is                                                        |
| ----------------------------------- | ----------------------------------------------------------------- |
| `backend/brainrot_index_service/`   | Django + Django REST Framework API, run by gunicorn. Python via uv. |
| `frontend/brainrot-index-frontend/` | Vite + Tailwind single-page app, no framework, served by nginx.   |
| `docker-compose.yml`                | `db` (Postgres 17), `backend`, `worker`, `web`.                   |
| `extension/`                        | The browser extension; see `extension/README.md`.                 |
| `scripts/package-extension.mjs`     | Packs the extension into the zip the site serves and the Web Store takes. |
| `docs/webstore/`                    | Chrome Web Store listing text, permission reasons, data disclosures. |
| `deploy.sh`                         | Rebuilds and restarts the stack.                                  |
| `.env.example`                      | Every setting the stack reads, with a one-line description.      |
| `DEPLOY.md`                         | Ports, addresses, accounts, email, and going public.             |
| `cloudflared/config.yml`            | Cloudflare Tunnel routes for `brainrotindex.com`.                |
| `legacy/`                           | The original proof of concept (Safari userscript, Node server, Ollama scoring). |
| `eval/`                             | Labeled posts and per-model results for scoring the classifier; see `eval/README.md`. |

## Deploy

```
cp .env.example .env    # then fill in the secrets
bash deploy.sh
docker compose ps       # wait for backend to be healthy
```

The site is then on `127.0.0.1:3400`, at `https://brainrotindex.com` through
the tunnel, and on the tailnet at `https://brainrot.jacob-waters.com`. See
`DEPLOY.md` for details.

## Origin

The backend and frontend foundation were copied from the YouArt Studios site
and stripped down to the parts that are not specific to that product.
