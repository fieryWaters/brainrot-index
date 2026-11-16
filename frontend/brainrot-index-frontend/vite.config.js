import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import process from 'node:process'

// The Google Sign-In script is only needed when a Google client id was built in.
// Without one, drop the tag so the page makes no request to Google at all.
function googleSignInTag(env) {
  return {
    name: 'google-sign-in-tag',
    transformIndexHtml: (html) => (env.VITE_GOOGLE_CLIENT_ID
      ? html
      : html.replace(/\s*<script src="https:\/\/accounts\.google\.com\/gsi\/client"[^>]*><\/script>/, '')),
  }
}

export default defineConfig(({ mode }) => {
  // Docker build args arrive as process.env, local dev from .env files; loadEnv covers both.
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [tailwindcss(), googleSignInTag(env)],
    server: {
      proxy: {
        '/api': {
          target: process.env.VITE_DEV_API_TARGET || 'http://localhost:8000',
          changeOrigin: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.js'],
    },
  }
})
