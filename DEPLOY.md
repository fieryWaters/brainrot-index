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
| `worker`  | Same image; downloads post images and runs classifications, 16 at a time | none |
| `web`     | nginx: built frontend, proxies `/api/` to backend | `127.0.0.1:3400` |

All configuration lives in `.env` (see `.env.example`). Post images live in
the `post_images` volume, mounted at `/app/media` in `backend` and `worker`.

## Inference

`INFERENCE_SOURCE=openrouter` (default) uses `OPENROUTER_MODEL`
(default `google/gemini-2.5-flash-lite`). `INFERENCE_SOURCE=local` sends the
same requests to `LOCAL_INFERENCE_BASE_URL` (an OpenAI-compatible server, URL
ending in `/v1`) with `LOCAL_INFERENCE_MODEL`. Redeploy after changing them.

## Private address

`https://brainrot.jacob-waters.com` reaches `127.0.0.1:3400` through the Caddy
reverse proxy in `/home/jacob/git-repos/reverse-proxy` (tailnet only).

## Public address (not set up yet)

When `brainrotindex.com` is ready, add a Cloudflare Tunnel service to
`docker-compose.yml`, next to `web`:

1. In Cloudflare Zero Trust, go to `Networks -> Tunnels` and create a tunnel
   with the `Docker` connector.
2. Put the tunnel token in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
3. Add a Public Hostname rule: `brainrotindex.com` -> service type `HTTP`,
   URL `http://web:80`.
4. Add a `cloudflared` service running `tunnel --no-autoupdate run` with
   `TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}`, depending on `web`.
5. Set `SITE_URL=https://brainrotindex.com` in `.env` and redeploy.

## Email

`EMAIL_DELIVERY=console` (the default) writes every email, links included, to
the backend log instead of sending it: `docker compose logs backend`.
Set `EMAIL_DELIVERY=resend` once the Resend account can send from
`brainrotindex.com`.

## Google OAuth checklist

The Google OAuth Web client must list the site address (`SITE_URL`) as an
Authorized JavaScript origin, and the same client ID goes in `.env` as
`GOOGLE_CLIENT_ID`. The frontend has the id built in, so redeploy after changing it.

## Admin

The Django admin at `/admin/` lists posts, images, plugins, classifications,
user settings, and feedback. Make an account staff once:
`docker compose exec backend python manage.py shell -c "from django.contrib.auth.models import User; User.objects.filter(email='you@example.com').update(is_staff=True, is_superuser=True)"`

## Useful commands

- Logs: `docker compose logs -f web backend`
- Backend tests: `docker compose exec backend python manage.py test api classification feedback`
- Worker logs: `docker compose logs -f worker`
- Frontend tests: `docker build --target build -t brainrot-index-frontend-test frontend/brainrot-index-frontend && docker run --rm brainrot-index-frontend-test npx vitest run`
- Django shell: `docker compose exec backend python manage.py shell`
