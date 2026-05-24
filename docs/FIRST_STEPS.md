# Mosaic — First Steps After Installation

This guide walks you through verifying that Mosaic is working correctly and connecting your first data source.
Run through this checklist after completing [INSTALL.md](INSTALL.md).

---

## 1. Verify the installation

Open **http://your-server:3001** and log in with your admin credentials.

Check **Settings → System Health** (in the left sidebar). You should see:

- **Mosaic core** — green ✓
- **Database** — green ✓
- **Anthropic API** — green ✓ (means your API key is valid)
- **Superset** — green ✓ (may take a minute on first load)
- **CISO Assistant** — green ✓ (may take 60–90 seconds on first boot)

If anything is red, expand it to see the error message. Most issues at this stage are:
- Invalid Anthropic API key → re-enter it in Settings → API Keys
- Service still starting → wait 2 minutes and refresh

---

## 2. Test the AI without a database

In the main chat, type:

> **What is OEE and how is it calculated?**

Mosaic should respond with a clear explanation. This confirms the AI is working even before you connect any data.

Then try:

> **What data sources are connected?**

It will tell you there are none yet — that's expected.

---

## 3. Connect your first data source

Go to **Settings → Data sources → + Add database**.

**If you have a real database ready**, enter its connection details.

**If you want to test first**, click **Add sandbox DB** at the top of the Data sources page. This creates a built-in SQLite database pre-loaded with sample manufacturing data (machines, OEE, downtime events, maintenance logs). Use it to verify the full query flow before connecting real systems.

After connecting a database, click **Test** next to it to confirm Mosaic can reach it.

---

## 4. Ask your first data question

Once a data source is connected, try:

> **Show me all machines and their current status**

> **How many downtime events happened this week?**

> **What is the OEE for each production line?**

You should see Mosaic query the database and return a formatted table or answer.

If you connected the sandbox database, all of these will work immediately.

---

## 5. Invite your first user

Go to **Settings → Users → Invite user**.

Enter their email address and assign them a role:
- **Admin** — full access including Settings
- **User** — chat, dashboards, reports; no Settings access

They'll receive an email invitation (if SMTP is configured) or you can share the login URL directly.

> To configure email notifications, go to **Settings → Authentication** and fill in your SMTP server details.

---

## 6. What to try next

| You want to… | Go to… |
|---|---|
| Connect more databases (Postgres, InfluxDB, SQL Server, MongoDB…) | Settings → Data sources → Databases |
| Connect REST APIs or SAP OData | Settings → Data sources → API connections |
| Connect file shares (SFTP, S3, SMB) | Settings → Data sources → File servers |
| Set up automated alerts when something crosses a threshold | Rules (left sidebar) |
| Build a dashboard with charts | Dashboards (left sidebar) |
| Run a root cause analysis | Chat → describe the problem in plain English |
| Configure AD/LDAP single sign-on | Settings → Authentication — then follow [KEYCLOAK.md](KEYCLOAK.md) |
| Understand how your secrets work | [SECRETS.md](SECRETS.md) |
| Apply future updates | [UPDATING.md](UPDATING.md) |

---

## Confirming everything is working (checklist)

- [ ] Settings → System Health shows all services green
- [ ] AI answers a general question (OEE definition)
- [ ] At least one data source is connected and shows a green test result
- [ ] A data question returns actual results from your database
- [ ] At least one non-admin user can log in and use the chat

Once all five are true, your installation is complete.
