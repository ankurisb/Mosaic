#!/usr/bin/env bash
# wait for database to be ready
if [ ! -n "$DJANGO_SETTINGS_MODULE" ]; then
  export DJANGO_SETTINGS_MODULE=ciso_assistant.settings
fi
if [ ! -n "$DJANGO_SECRET_KEY" ]; then
  if [ ! -f db/django_secret_key ]; then
    openssl rand -hex 32 | install -m 600 /dev/stdin db/django_secret_key
    echo "generating initial Django secret key"
  fi
  export DJANGO_SECRET_KEY=$(<db/django_secret_key)
  echo "Django secret key read from file"
fi
while ! python manage.py showmigrations iam >/dev/null; do
  echo "database not ready; waiting"
  sleep 15
done
poetry run python manage.py migrate --settings="${DJANGO_SETTINGS_MODULE}"
poetry run python manage.py storelibraries --settings="${DJANGO_SETTINGS_MODULE}"

# Auto-load libraries marked autoload=True in the store (mappings, risk matrices, etc.)
poetry run python manage.py autoloadlibraries --settings="${DJANGO_SETTINGS_MODULE}"

# Explicitly load ISO 27001:2022 — not in the autoload set but required for
# the default compliance project. Idempotent: CISO Assistant skips already-loaded libs.
poetry run python manage.py shell --settings="${DJANGO_SETTINGS_MODULE}" -c "
from django.apps import apps
StoredLibrary = apps.get_model('core', 'StoredLibrary')
lib = StoredLibrary.objects.filter(urn='urn:intuitem:risk:library:iso27001-2022').first()
if lib and not lib.is_loaded:
    lib.load()
    print('ISO 27001:2022 loaded')
else:
    print('ISO 27001:2022 already loaded or not found — skipping')
"

if [ -n "$DJANGO_SUPERUSER_EMAIL" ]; then
  poetry run python manage.py createsuperuser --noinput --settings="${DJANGO_SETTINGS_MODULE}"
fi

# Set default values for Gunicorn configuration
GUNICORN_WORKERS=${GUNICORN_WORKERS:-3}
GUNICORN_TIMEOUT=${GUNICORN_TIMEOUT:-100}
GUNICORN_KEEPALIVE=${GUNICORN_KEEPALIVE:-30}
GUNICORN_LIMIT_REQUEST_LINE=${GUNICORN_LIMIT_REQUEST_LINE:-5120}
GUNICORN_PORT=${PORT:-8000}

exec gunicorn --chdir ciso_assistant \
  --bind :$GUNICORN_PORT \
  --timeout $GUNICORN_TIMEOUT \
  --keep-alive $GUNICORN_KEEPALIVE \
  --workers=$GUNICORN_WORKERS \
  --limit-request-line=$GUNICORN_LIMIT_REQUEST_LINE \
  --env RUN_MAIN=true \
  ciso_assistant.wsgi:application
