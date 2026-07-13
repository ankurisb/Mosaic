FEATURE_FLAGS = {
    'EMBEDDED_SUPERSET': True,
    'DASHBOARD_RBAC': False,
}
WTF_CSRF_ENABLED = True
TALISMAN_ENABLED = False
HTTP_HEADERS = {'X-Frame-Options': 'ALLOWALL'}
GUEST_TOKEN_JWT_AUDIENCE = 'http://localhost:8088/'
GUEST_TOKEN_JWT_EXP_SECONDS = 300
CONTENT_SECURITY_POLICY_WARNING = False

# ── Subpath hosting (Mosaic front door) ──────────────────────────────
# When served behind Caddy under https://<host>/superset, Superset must know
# its mount point or its asset/redirect URLs will point at the wrong paths.
# Defaults to '/' so direct access on :8088 is unaffected.
import os
APPLICATION_ROOT = os.environ.get('SUPERSET_APP_ROOT', '/')
if APPLICATION_ROOT != '/':
    # Flask session cookie must be scoped to the subpath.
    SESSION_COOKIE_PATH = APPLICATION_ROOT
