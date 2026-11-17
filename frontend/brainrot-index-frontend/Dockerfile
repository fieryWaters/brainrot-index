FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ARG VITE_APP_ENV=deployment
ENV VITE_APP_ENV=${VITE_APP_ENV}
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ARG VITE_STRIPE_PUBLISHABLE_KEY=
ENV VITE_STRIPE_PUBLISHABLE_KEY=${VITE_STRIPE_PUBLISHABLE_KEY}
ARG VITE_GIT_COMMIT=unknown
ENV VITE_GIT_COMMIT=${VITE_GIT_COMMIT}
ARG VITE_WEBSTORE_URL=
ENV VITE_WEBSTORE_URL=${VITE_WEBSTORE_URL}

RUN npm run build

# The browser extension, packed for download from /downloads/. The extension
# and scripts folders arrive as named build contexts (additional_contexts in
# docker-compose.yml).
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS extension

WORKDIR /work
COPY --from=extension-source . extension/
COPY --from=scripts package-extension.mjs scripts/
ARG VITE_GIT_COMMIT=unknown
RUN GIT_COMMIT=${VITE_GIT_COMMIT} node scripts/package-extension.mjs --out /out \
    && cp /out/brainrot-index-extension-*.zip /out/brainrot-index-extension.zip

FROM nginx:1.30.6-alpine@sha256:c59d1f8b1e0e42da75be973424cd72e23f7f8adfb54e982f4d1cd0216a5a5576

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=extension /out /usr/share/nginx/html/downloads

EXPOSE 80
