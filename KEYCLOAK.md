# Keycloak SSO Setup Guide

Mosaic supports Keycloak as a self-hosted OIDC identity provider, giving you enterprise AD/LDAP federation without sending credentials to any cloud service.

---

## Architecture

```
Browser → Mosaic login → Keycloak (OIDC) → AD/LDAP
                ↓
         id_token verified
                ↓
         Mosaic JWT issued
```

Keycloak handles all identity: password storage, MFA, AD/LDAP sync, group/role mapping. Mosaic only sees a verified `email` claim from the id_token — it never touches passwords.

---

## 1. Start Keycloak

Keycloak runs as an **optional Docker profile** — it does not start by default.

```bash
# Start Mosaic + Keycloak together
docker compose --profile sso up -d

# Or start Keycloak separately if Mosaic is already running
docker compose up -d keycloak
```

Default admin credentials (change in `.env` before production):
```
URL:      http://localhost:8080
Username: admin
Password: admin   (set KEYCLOAK_ADMIN_PASSWORD in .env)
```

---

## 2. Create a Realm

1. Open `http://localhost:8080` → sign in as admin
2. Click **Keycloak** (top-left dropdown) → **Create realm**
3. Realm name: `mosaic` (or your organisation name — use lowercase, no spaces)
4. Click **Create**

> Do not use the `master` realm for application SSO — `master` is for Keycloak administration only.

---

## 3. Create a Client

1. In the `mosaic` realm → **Clients** → **Create client**
2. **Client ID**: `mosaic`
3. **Client type**: OpenID Connect
4. Click **Next**
5. Enable **Client authentication** (this makes it a confidential client with a secret)
6. Enable **Standard flow** (authorization code flow)
7. Click **Next**
8. **Valid redirect URIs**:
   ```
   http://localhost:3001/api/auth/callback/keycloak
   ```
   For production, add your actual domain:
   ```
   https://mosaic.company.com/api/auth/callback/keycloak
   ```
9. **Web origins**: `http://localhost:3001` (or your production domain)
10. Click **Save**

### Get the Client Secret

1. Go to **Clients** → `mosaic` → **Credentials** tab
2. Copy the **Client secret** value

---

## 4. Connect AD/LDAP (optional but recommended for enterprise)

1. In the `mosaic` realm → **User federation** → **Add provider** → **LDAP**
2. Fill in your AD/LDAP connection details:
   - **Connection URL**: `ldap://your-ad-server:389`
   - **Bind DN**: `CN=svc-keycloak,OU=ServiceAccounts,DC=company,DC=com`
   - **Bind credential**: service account password
   - **Users DN**: `OU=Users,DC=company,DC=com`
   - **Username LDAP attribute**: `sAMAccountName` (AD) or `uid` (OpenLDAP)
   - **RDN LDAP attribute**: `cn`
   - **UUID LDAP attribute**: `objectGUID` (AD) or `entryUUID` (OpenLDAP)
3. Click **Test connection** → **Test authentication** to verify
4. Click **Save** → **Synchronize all users**

### Map AD groups to Keycloak roles (optional)

1. **User federation** → your LDAP provider → **Mappers** → **Create**
2. **Mapper type**: `role-ldap-mapper`
3. Map AD security groups → Keycloak realm roles

---

## 5. Configure Mosaic

1. Open Mosaic → **Settings** → **Authentication**
2. Click **Configure** on the **Keycloak** card
3. Fill in:
   - **Keycloak Server URL**: `http://localhost:8080` (or your production URL)
   - **Realm**: `mosaic`
   - **Client ID**: `mosaic`
   - **Client Secret**: (from step 3 above)
4. Click **Save configuration**

Mosaic auto-builds the OIDC discovery URL:
```
{server_url}/realms/{realm}/.well-known/openid-configuration
```

You can override this in the **Discovery URL** field if your Keycloak is behind a reverse proxy with a different URL.

---

## 6. Pre-provision users

Mosaic requires users to exist before they can SSO — this is by design to prevent unauthorised access from anyone with a valid Keycloak account.

1. Go to **Settings** → **Users** → invite the user with their **exact email address** (matching their Keycloak/AD email)
2. Assign them the appropriate role (admin or user)
3. They can then sign in via Keycloak

> Users who sign in via SSO do not need a Mosaic password — the password field is ignored for SSO logins.

---

## 7. Verify the flow

1. Open Mosaic login page — you should see a **Sign in with Keycloak** button
2. Click it → redirected to Keycloak login
3. Sign in with an AD/LDAP account
4. Redirected back to Mosaic → logged in

If it fails, check:
- Redirect URI in Keycloak matches exactly (including trailing slash)
- User's email in Keycloak matches the email in Mosaic's Users tab
- `NEXT_PUBLIC_APP_URL` in `.env` matches your actual URL

---

## 8. Production hardening

For production deployments, update `docker-compose.yml` or your deployment config:

```bash
# .env additions for production Keycloak
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=<strong-random-password>
```

And in Keycloak admin:
- **Realm settings** → **Login** → Enable **Require SSL**: `external requests`
- **Realm settings** → **Sessions** → set appropriate SSO session timeouts
- Use a proper database instead of `dev-file` (PostgreSQL recommended for production)

To use PostgreSQL for Keycloak data persistence:
```yaml
# In docker-compose.yml, replace KC_DB=dev-file with:
environment:
  - KC_DB=postgres
  - KC_DB_URL=jdbc:postgresql://keycloak-db:5432/keycloak
  - KC_DB_USERNAME=keycloak
  - KC_DB_PASSWORD=${KEYCLOAK_DB_PASSWORD:-keycloak}
```

---

## Role mapping

Keycloak roles can be mapped to Mosaic roles via the `email` claim. Currently Mosaic uses pre-provisioned role assignment (admin sets the role per user in Settings → Users). Automatic role mapping from Keycloak groups is on the roadmap.

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `account_not_provisioned` | User's email not in Mosaic | Add user in Settings → Users with exact email |
| `oidc_discovery_failed` | Wrong server URL or realm | Check URL + realm name, verify Keycloak is running |
| `token_exchange_failed` | Wrong client secret | Re-copy client secret from Keycloak Clients → Credentials |
| `no_email_in_token` | Keycloak not sending email claim | Realm settings → Client scopes → `email` scope must be default |
| Redirect loop | Redirect URI mismatch | Exact URI in Keycloak must match `NEXT_PUBLIC_APP_URL/api/auth/callback/keycloak` |

---

## What's next

- [ ] Automatic role sync from Keycloak groups (Phase D roadmap)
- [ ] Keycloak + Superset single-sign-on (Superset supports OIDC natively)
- [ ] MFA enforcement via Keycloak policies (no Mosaic changes needed — configure in Keycloak)
- [ ] Keycloak event log → Mosaic audit trail (via Keycloak event listener SPI)
