# Mosaic

On-premise AI intelligence platform for industrial and manufacturing environments.
Bring AI to your operational data — queries, root cause analysis, and dashboards — without your data ever leaving your network.

**Current version:** 1.2.0 · [Changelog](CHANGELOG.md)

---

## Documentation

| Document | Who it's for |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | IT administrator installing Mosaic for the first time |
| [docs/FIRST_STEPS.md](docs/FIRST_STEPS.md) | End user or administrator verifying Mosaic is working after install |
| [docs/UPDATING.md](docs/UPDATING.md) | IT administrator applying updates |
| [docs/BACKUP.md](docs/BACKUP.md) | IT administrator — what gets backed up, restore procedure |
| [docs/SECRETS.md](docs/SECRETS.md) | IT administrator managing credentials and secrets |
| [docs/NETWORK.md](docs/NETWORK.md) | Network/security team reviewing firewall requirements |
| [docs/KEYCLOAK.md](docs/KEYCLOAK.md) | IT administrator setting up enterprise SSO / AD federation |

---

## For developers

```bash
cp .env.example .env.local   # fill in at minimum: ANTHROPIC_API_KEY, AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npm run dev                   # http://localhost:3000
```

Stack: Next.js 15, React 19, SQLite (local) / Neon Postgres (cloud), Anthropic Claude, Docker Compose.
