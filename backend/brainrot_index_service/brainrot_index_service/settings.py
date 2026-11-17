"""
Django settings for brainrot_index_service project.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/5.2/ref/settings/
"""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from decouple import config


def resolve_app_env():
    raw = os.environ.get('APP_ENV', 'deployment').strip().lower()
    aliases = {'dev': 'local', 'development': 'local', 'prod': 'deployment', 'production': 'deployment'}
    resolved = aliases.get(raw, raw)
    if resolved not in {'local', 'deployment'}:
        raise RuntimeError("APP_ENV must be either 'local' or 'deployment'")
    return resolved


def resolved_secret_key(secure_mode):
    secret_key = config('DJANGO_SECRET_KEY', default='').strip()
    insecure_defaults = {
        '',
        'replace-with-long-random-secret',
        'django-insecure-dev-only-key-change-me',
        'django-insecure-dev-only-key',
    }
    if secure_mode and secret_key in insecure_defaults:
        raise RuntimeError('Set a strong DJANGO_SECRET_KEY when APP_ENV=deployment')
    if not secret_key:
        return 'django-insecure-dev-only-key-change-me'
    return secret_key

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/

APP_ENV = resolve_app_env()
DEBUG = APP_ENV == 'local'
SECURE_MODE = APP_ENV == 'deployment'
RUNNING_TESTS = 'test' in sys.argv

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = resolved_secret_key(SECURE_MODE)

# The primary address of the site, for example https://brainrotindex.com.
# Emailed links point here.
SITE_URL = config('SITE_URL', default='').strip().rstrip('/')
# Other addresses that serve the same site, comma separated.
EXTRA_SITE_URLS = [
    url.strip().rstrip('/')
    for url in config('EXTRA_SITE_URLS', default='').split(',')
    if url.strip()
]
SITE_URLS = [SITE_URL] + EXTRA_SITE_URLS
# The git commit this build came from, passed in by deploy.sh.
GIT_COMMIT = os.environ.get('GIT_COMMIT', 'unknown')
SITE_DOMAIN = urlparse(SITE_URL).hostname or ''
GOOGLE_CLIENT_ID = config('GOOGLE_CLIENT_ID', default='').strip()

if APP_ENV == 'local':
    # Local mode is intended for LAN use (hostnames / IPs change frequently).
    ALLOWED_HOSTS = ['*']
    CORS_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
    CSRF_TRUSTED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
    FRONTEND_BASE_URL = 'http://localhost:5173'
else:
    if not SITE_DOMAIN:
        raise RuntimeError('SITE_URL must be set when APP_ENV=deployment')
    # A leading dot also allows subdomains, such as www.
    ALLOWED_HOSTS = [f'.{urlparse(url).hostname}' for url in SITE_URLS] + ['localhost', '127.0.0.1']
    CORS_ALLOWED_ORIGINS = SITE_URLS
    CSRF_TRUSTED_ORIGINS = SITE_URLS
    FRONTEND_BASE_URL = SITE_URL

# CORS_ALLOW_CREDENTIALS=True so the session cookie flows on the dev cross-origin
# Vite (:5173) -> Django (:8000) path. Production is same-origin via nginx.
CORS_ALLOW_CREDENTIALS = True

# New accounts need an invite code (see InviteCode); existing accounts never do.
SIGNUP_REQUIRES_INVITE = config('SIGNUP_REQUIRES_INVITE', default=True, cast=bool)
# Posts one account may send for classification per day (UTC) that no
# classification exists for yet. Posts already classified are always answered.
DAILY_NEW_POST_QUOTA = config('DAILY_NEW_POST_QUOTA', default=3000, cast=int)

LOCAL_AUTH_BYPASS = APP_ENV == 'local'
LOCAL_AUTH_USERNAME = 'local_dev'
LOCAL_AUTH_EMAIL = 'local@brainrotindex.local'

# Payments (Stripe test mode) and LLM classification (OpenRouter).
STRIPE_SECRET_KEY = config('STRIPE_TEST_SECRET_KEY', default='').strip()
STRIPE_WEBHOOK_SECRET = config('STRIPE_WEBHOOK_SECRET', default='').strip()
OPENROUTER_API_KEY = config('OPENROUTER_API_KEY', default='').strip()

# Where classification inference runs: openrouter or local (any OpenAI-compatible
# chat completions server). Both use the same client code.
INFERENCE_SOURCE = config('INFERENCE_SOURCE', default='openrouter').strip()
OPENROUTER_MODEL = config('OPENROUTER_MODEL', default='google/gemini-2.5-flash-lite').strip()
LOCAL_INFERENCE_BASE_URL = config('LOCAL_INFERENCE_BASE_URL', default='').strip().rstrip('/')
LOCAL_INFERENCE_MODEL = config('LOCAL_INFERENCE_MODEL', default='').strip()


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'anymail',
    'api',
    'classification',
    'feedback',
    'billing',
    'store',
    'families',
]

# -- Email -------------------------------------------------------------------
# EMAIL_DELIVERY=console writes each email, links included, to the backend log.
# EMAIL_DELIVERY=resend sends it through Resend (django-anymail).
EMAIL_DELIVERY = config('EMAIL_DELIVERY', default='console')
EMAIL_BACKEND = {
    'console': 'api.console_email.ConsoleTextEmailBackend',
    'resend': 'anymail.backends.resend.EmailBackend',
}[EMAIL_DELIVERY]
ANYMAIL = {
    'RESEND_API_KEY': config('RESEND_API_KEY', default=''),
}
DEFAULT_FROM_EMAIL = 'Brainrot Index <noreply@brainrotindex.com>'

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'brainrot_index_service.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'brainrot_index_service.wsgi.application'


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'brainrot_index',
        'USER': 'brainrot_index',
        'PASSWORD': config('POSTGRES_PASSWORD', default=''),
        'HOST': 'db',
        'PORT': 5432,
    }
}


# Throttle counters live in Postgres, so every gunicorn worker shares them and
# they survive restarts. The table is made by `manage.py createcachetable`.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
        'LOCATION': 'django_cache',
        # Past this many rows Django deletes a third of them, throttle counters included.
        'OPTIONS': {'MAX_ENTRIES': 100000},
    }
}


# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 12},
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.Argon2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher',
    'django.contrib.auth.hashers.BCryptSHA256PasswordHasher',
]

SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
SESSION_SAVE_EVERY_REQUEST = True


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Original post images, kept on the post_images volume.
MEDIA_ROOT = BASE_DIR / 'media'

# Cloudflare Tunnel and reverse proxy support
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True

# Baseline browser/security hardening
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_HTTPONLY = True
# Frontend reads csrftoken cookie and echoes it as X-CSRFToken (double-submit).
CSRF_COOKIE_HTTPONLY = False
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin-allow-popups'

if SECURE_MODE:
    # The Django test client speaks plain HTTP, so skip the redirect under tests.
    SECURE_SSL_REDIRECT = not RUNNING_TESTS
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # No includeSubDomains or preload: the domain is new, and both are hard
    # to take back once browsers have seen them.
    SECURE_HSTS_SECONDS = 31536000

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'api.authentication.LocalBypassAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'api.throttling.AnonRateThrottle',
        'api.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '30/hour',
        'user': '120/hour',
        'auth_google': '30/hour',
        'auth_login': '10/hour',
        'auth_login_account': '5/hour',
        'auth_reset_request': '5/hour',
        'auth_reset_confirm': '10/hour',
        'auth_verify': '20/hour',
        'feedback_anon': '20/hour',
        # The extension sends a batch of up to 25 posts about every 150 ms while
        # the reader scrolls, plus re-asks for pending posts, from every open tab.
        'classify': '600/minute',
        # Asked on every Reddit or X page load and every popup opening.
        'extension_config': '60/minute',
        'extension_token': '20/hour',
        # Each try of a draft rubric is one model call.
        'store_try': '20/hour',
        'store_publish': '20/day',
        'store_review': '60/hour',
        'family_change': '60/hour',
        # Joining checks an invite code, so it is limited like a sign-in.
        'family_join': '20/hour',
    },
}

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {'class': 'logging.StreamHandler'},
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django.request': {
            'handlers': ['console'],
            'level': 'ERROR',
            'propagate': False,
        },
    },
}

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
