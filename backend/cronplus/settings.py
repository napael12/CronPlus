from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("SECRET_KEY", "dev-insecure-key-change-in-production")
DEBUG = os.getenv("DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
CSRF_TRUSTED_ORIGINS = os.getenv(
    "CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:8000"
).split(",")

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "huey.contrib.djhuey",
    "channels",
    "core",
    "api",
    "scheduler",
    "ws",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "cronplus.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

ASGI_APPLICATION = "cronplus.asgi.application"
WSGI_APPLICATION = "cronplus.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / os.getenv("DB_NAME", "cronplus.db"),
    }
}

AUTH_USER_MODEL = "core.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Django REST Framework
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "api.pagination.StandardPagination",
    "PAGE_SIZE": 10,
}

# CORS
CORS_ALLOWED_ORIGINS = os.getenv(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174"
).split(",")
CORS_ALLOW_CREDENTIALS = True

# Django Channels — in-memory channel layer for MVP
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}

# Session
SESSION_COOKIE_AGE = int(os.getenv("SESSION_COOKIE_AGE", 86400))  # 24 hours
SESSION_COOKIE_HTTPONLY = True

# CSRF — keep cookie readable by JS so axios can pick it up
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"

# Huey — SQLite broker
HUEY = {
    "name": "cronplus",
    "huey_class": "huey.SqliteHuey",
    "filename": str(BASE_DIR / "huey.db"),
    "results": True,
    "store_none": False,
    "immediate": False,
    "utc": True,
    "consumer": {
        "workers": int(os.getenv("HUEY_WORKERS", 4)),
        "worker_type": "thread",
        "scheduler_interval": 1,
    },
}

# Application settings (overridden by DB-stored settings at runtime)
CRONPLUS_INSTANCE_NAME = os.getenv("CRONPLUS_INSTANCE_NAME", "CronPlus")
LOG_RETENTION_DAYS = int(os.getenv("LOG_RETENTION_DAYS", 60))
LOG_MAX_OUTPUT_BYTES = int(os.getenv("LOG_MAX_OUTPUT_BYTES", 10 * 1024 * 1024))  # 10 MB

# SMTP Notification defaults (overridden by DB settings)
NOTIFICATION_MAILHOST = os.getenv("NOTIFICATION_MAILHOST", "")
NOTIFICATION_PORT = int(os.getenv("NOTIFICATION_PORT", 587))
NOTIFICATION_SENDER = os.getenv("NOTIFICATION_SENDER", "")
NOTIFICATION_USERNAME = os.getenv("NOTIFICATION_USERNAME", "")
NOTIFICATION_PASSWORD = os.getenv("NOTIFICATION_PASSWORD", "")
