# Claude App — Deployment Guide
# For non-technical users · Takes about 20 minutes

You need 4 accounts (all free):
  1. github.com       — stores your code
  2. neon.tech        — free database
  3. vercel.com       — free hosting
  4. app.tavily.com   — free web search (1000/month)

And 1 paid account:
  5. console.anthropic.com — Claude AI (pay per use, ~$0.01 per conversation)

─────────────────────────────────────────────
STEP 1 — Get your API keys (10 minutes)
─────────────────────────────────────────────

A. Anthropic API key
   → Go to console.anthropic.com
   → Sign up / sign in
   → Click "API Keys" in the left menu
   → Click "Create Key"
   → Copy the key (starts with sk-ant-)
   → Save it somewhere safe (Notes app is fine)

B. Tavily API key (free web search)
   → Go to app.tavily.com
   → Sign up with Google or email
   → Your API key shows on the dashboard
   → Copy it (starts with tvly-)

C. Neon database URL
   → Go to neon.tech
   → Sign up (free, no credit card)
   → Click "New Project"
   → Name it "claude-app"
   → Click "Create project"
   → On the next screen, find "Connection string"
   → Click the copy icon next to the long URL
   → It looks like: postgresql://user:password@host/dbname?sslmode=require

D. Auth secret (a random password for your app's security)
   → Open Terminal on your Mac
      (Press Cmd+Space, type Terminal, press Enter)
   → Type this and press Enter:
        openssl rand -hex 32
   → Copy the long string it prints out

─────────────────────────────────────────────
STEP 2 — Put the code on GitHub (5 minutes)
─────────────────────────────────────────────

   → Go to github.com
   → Sign up / sign in
   → Click the green "New" button (top left)
   → Name your repo: claude-app
   → Make sure it's set to Private
   → Click "Create repository"

Now upload your files:
   → On the next page, click "uploading an existing file"
   → Drag and drop ALL the files from the claude-app folder
     (select all files: Cmd+A, then drag to the browser window)
   → Click "Commit changes"

─────────────────────────────────────────────
STEP 3 — Deploy on Vercel (5 minutes)
─────────────────────────────────────────────

   → Go to vercel.com
   → Click "Sign up" → "Continue with GitHub"
   → Click "Add New Project"
   → Find "claude-app" in the list → click "Import"
   → Click "Deploy" (don't change any settings yet)
   → Wait about 2 minutes for it to build

   ✗ It will FAIL on the first deploy — that's expected
     because we haven't added our API keys yet

─────────────────────────────────────────────
STEP 4 — Add your API keys to Vercel
─────────────────────────────────────────────

   → In Vercel, go to your project
   → Click "Settings" (top menu)
   → Click "Environment Variables" (left menu)
   → Add each of these one by one:

   NAME                  VALUE
   ─────────────────     ─────────────────────────────
   DATABASE_URL          (paste your Neon connection string)
   ANTHROPIC_API_KEY     (paste your sk-ant-... key)
   TAVILY_API_KEY        (paste your tvly-... key)
   AUTH_SECRET           (paste your openssl output)
   ADMIN_EMAIL           (your email address)
   ADMIN_PASSWORD        (choose a strong password)
   ADMIN_NAME            (your name)

   → Click "Save" after each one
   → When all 7 are saved, go to "Deployments"
   → Click the three dots (⋯) on the latest deployment
   → Click "Redeploy"
   → Wait 2 minutes

─────────────────────────────────────────────
STEP 5 — Open your app
─────────────────────────────────────────────

   → Go back to your Vercel project overview
   → Click the URL shown at the top (something like claude-app.vercel.app)
   → You should see the login screen
   → Sign in with the ADMIN_EMAIL and ADMIN_PASSWORD you set above
   → You're in!

─────────────────────────────────────────────
SOMETHING WENT WRONG?
─────────────────────────────────────────────

White screen or "Application error":
   → Go to Vercel → your project → "Functions" tab
   → Look for red error messages
   → Most likely a missing environment variable

"Invalid email or password":
   → Check ADMIN_EMAIL and ADMIN_PASSWORD in Vercel settings
   → Make sure there are no extra spaces

"Database error":
   → Check that DATABASE_URL is copied correctly from Neon
   → It must end with ?sslmode=require

Chat not working:
   → Check ANTHROPIC_API_KEY is correct
   → Make sure your Anthropic account has credits

─────────────────────────────────────────────
YOUR APP URL
─────────────────────────────────────────────

Vercel gives you a free URL like:  https://claude-app.vercel.app
You can add a custom domain later in Vercel settings.
