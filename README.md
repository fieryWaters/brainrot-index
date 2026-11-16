# Brainrot Index

A browser extension classifies social media posts with an LLM and hides the
unwanted ones: brainrot, ragebait, and engagement bait. This repository holds
the website behind it: accounts, subscriptions, and the classification API.

So far it contains the foundation: email/password and Google sign-in with
email verification and password reset, on a Django + Postgres backend and a
plain JavaScript frontend.

## Layout

| Path                                | What it is                                                        |
| ----------------------------------- | ----------------------------------------------------------------- |
| `backend/brainrot_index_service/`   | Django + Django REST Framework API, run by gunicorn. Python via uv. |
| `frontend/brainrot-index-frontend/` | Vite + Tailwind single-page app, no framework, served by nginx.   |
| `docker-compose.yml`                | `db` (Postgres 17), `backend`, `web`.                             |
| `deploy.sh`                         | Rebuilds and restarts the stack.                                  |
| `.env.example`                      | Every setting the stack reads, with a one-line description.      |
| `DEPLOY.md`                         | Ports, addresses, email, and the future public tunnel.           |
| `legacy/`                           | The original proof of concept (Safari userscript, Node server, Ollama scoring). |

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
