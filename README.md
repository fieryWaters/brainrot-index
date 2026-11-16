# Brainrot Index

A browser extension classifies social media posts with an LLM and hides the
unwanted ones: brainrot, ragebait, and engagement bait. This repository holds
the website behind it: accounts, subscriptions, and the classification API.

It contains email/password and Google sign-in, the classification API the
extension calls, the worker that runs the model, a dashboard for settings, and
a feedback button, on a Django + Postgres backend and a plain JavaScript
frontend.

## How classification works

The extension sends each post it sees to `POST /api/classify/`. Every post is
stored once (`Post`, with its images downloaded to the `post_images` volume).
Each plugin (engagement bait, ragebait, brainrot, AI slop) is a rubric prompt
with immutable versions; a `Classification` row per (post, plugin version) is
the shared cache, so a post costs one model call per plugin version no matter
how many users see it. The `worker` service takes pending rows from Postgres
and calls the model; the endpoint waits up to 1.5 s so most posts come back
done on the first call. Each user's threshold and blur/hide choice per plugin
decide the action.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/extension/config/` | extension token | master switch, mode, pending action |
| `POST /api/classify/` | extension token | up to 25 posts in, allow/blur/hide out |
| `POST /api/extension/token/` | session | new extension token, returned once |
| `GET, PATCH /api/settings/` | session | `{enabled, mode, allow_reveal}` |
| `GET /api/plugins/` | session | `{plugins: [{slug, name, description, enabled, threshold, flagged_action}]}` |
| `PATCH /api/plugins/<slug>/` | session | change `enabled`, `threshold`, `flagged_action` |
| `POST /api/feedback/` | session, extension token, or none (20 an hour per address) | a problem report, stamped with the running commit |

## Working through feedback

Reports from the site's Feedback button and from the extension are `Feedback` rows,
stamped with the site and extension commits they were written against.

1. Read the open ones: `docker compose exec backend python manage.py list_feedback`
   (`--all` includes resolved ones). The admin at `/admin/` filters on Resolved too.
2. Fix the problem and commit.
3. Mark the reports resolved with that commit:
   `docker compose exec backend python manage.py resolve_feedback 17 20 --commit <hash> --note "what was wrong"`.
   Reports that are not fixed stay open. Rows are never deleted.

## Layout

| Path                                | What it is                                                        |
| ----------------------------------- | ----------------------------------------------------------------- |
| `backend/brainrot_index_service/`   | Django + Django REST Framework API, run by gunicorn. Python via uv. |
| `frontend/brainrot-index-frontend/` | Vite + Tailwind single-page app, no framework, served by nginx.   |
| `docker-compose.yml`                | `db` (Postgres 17), `backend`, `worker`, `web`.                   |
| `deploy.sh`                         | Rebuilds and restarts the stack.                                  |
| `.env.example`                      | Every setting the stack reads, with a one-line description.      |
| `DEPLOY.md`                         | Ports, addresses, email, and the future public tunnel.           |
| `legacy/`                           | The original proof of concept (Safari userscript, Node server, Ollama scoring). |
| `eval/`                             | Labeled posts and per-model results for scoring the classifier; see `eval/README.md`. |

## Deploy

```
cp .env.example .env    # then fill in the secrets
bash deploy.sh
docker compose ps       # wait for backend to be healthy
```

The site is then on `127.0.0.1:3400` and, on the tailnet, at
`https://brainrot.jacob-waters.com`. See `DEPLOY.md` for details.

## Origin

The backend and frontend foundation were copied from the YouArt Studios site
and stripped down to the parts that are not specific to that product.
