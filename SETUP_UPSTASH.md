# Setting Up Upstash Redis for the Issues System

This walkthrough shows you **exactly where to click in Vercel** to make the
Issues feature persist data across all users. The code already auto-detects
Upstash — you only need to install the integration once. No code changes
required after this.

---

## TL;DR

1. Open `https://vercel.com/integrations/upstash` → click **Install**
2. Pick your 0v Ai project → **Continue**
3. Choose **Upstash Redis** → name it `0vai-issues` → pick a region close to your users → **Create**
4. Back in Vercel → **Settings → Environment Variables** — confirm you now see `KV_REST_API_URL` and `KV_REST_API_TOKEN` (and probably also `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`)
5. **Deployments → ⋯ menu on the latest deployment → Redeploy**
6. Open your site → submit an issue → open DevTools → Network → click the `issues` request → check the **Response Headers** for `X-Issues-Storage: upstash-redis`

If the header says `upstash-redis`, you're done. If it says `memory-fallback`,
the env vars didn't propagate — go back to step 4.

---

## Step-by-step (with screenshots described)

### Step 1 — Open the Upstash integration page on Vercel

Go to this exact URL in your browser:

```
https://vercel.com/integrations/upstash
```

(You can also reach it from the Vercel dashboard: click **Storage** in the
left sidebar → **Connect Database** → **Upstash Redis**. Same destination.)

You'll see a page titled **Upstash for Vercel** with an **Install** / **Add
Integration** button in the top-right.

Click **Install**.

---

### Step 2 — Pick which Vercel project to connect

Vercel shows a list of all your projects. Tick the box next to your **0v Ai**
project (the one that deploys `index.html` + the `api/` folder).

Click **Continue**.

If you have a Personal Account plus a Team, pick the one that owns the project.

---

### Step 3 — Choose "Create New Upstash Account" or "Link Existing"

You'll get two paths:

- **Create New Upstash Account** — Vercel manages billing & everything for you. Pick this if you don't already have an Upstash account. You stay inside Vercel the whole time.
- **Link Existing Upstash Account** — pick this if you already have an Upstash console login. You'll be bounced to `console.upstash.com` to authorize.

For first-timers, **Create New** is simpler. Pick that.

---

### Step 4 — Configure the Redis database

You'll see a configuration form. Fill it in:

| Field             | What to type                                  |
| ----------------- | --------------------------------------------- |
| Database Name     | `0vai-issues` (anything memorable)           |
| Primary Region    | Pick the region closest to your Vercel project's region. If you don't know, pick `us-east-1` (AWS US East) — Vercel's default. |
| Plan              | **Free** (10,000 commands/day, plenty for a bug tracker) |

Click **Create**.

Vercel will now:
1. Provision the Upstash Redis DB
2. **Automatically** inject these environment variables into your Vercel project:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

You don't have to copy-paste anything.

---

### Step 5 — Verify the env vars landed

In Vercel, go to:

```
Your Project → Settings → Environment Variables
```

(URL pattern: `https://vercel.com/[your-team]/[your-project]/[~]/settings/environment-variables`)

You should see at minimum:

```
KV_REST_API_URL        = https://xxx.upstash.io
KV_REST_API_TOKEN      = Ax...long-string...
```

The Issues API reads these names directly. If you see them, you're ready.

If you DON'T see them, scroll back up to the integration page
(`https://vercel.com/integrations/upstash` → **Manage**) and make sure the
project is linked to the database. There's a **Connect Project** step that's
easy to miss.

---

### Step 6 — Redeploy so the env vars are visible to your functions

Env vars added after a deployment don't apply to already-running deployments.
You need to trigger one new deploy:

1. Go to **Deployments** tab in your project
2. Find the latest deployment (top of the list)
3. Click the **⋯** (three-dots) menu on the right
4. Click **Redeploy**
5. Leave "Use existing Build Cache" unchecked → **Redeploy**

Wait ~30 seconds for it to go green.

---

### Step 7 — Verify it actually works end-to-end

Open your live site (`https://0vai.vercel.app` or your custom domain).

1. Open browser DevTools (F12) → **Network** tab
2. Click the sidebar → **Issues**
3. Click **Web Problems** → tap the **+** floating button
4. Fill in the form → **Submit Issue**
5. In DevTools Network, find the `POST /api/issues` request → click it → **Response Headers**
6. Look for: `X-Issues-Storage: upstash-redis`

If you see `upstash-redis` — ✅ every visitor to the site now sees the same
issues, they survive refresh, they survive Vercel cold starts, and the owner
panel can reply / change status / delete with everything syncing live.

If you see `memory-fallback` — the env vars didn't reach the function. Go
back to step 5 and confirm they're in the Vercel dashboard, then redeploy
again (step 6).

---

### Step 8 — Sanity-check in the Upstash console (optional)

Go to `https://console.upstash.com/` → log in → click your `0vai-issues`
database → **Data** tab.

You should see a single key:

```
issues:all:v1
```

Click it. The value is a JSON array of every submitted issue. You can
manually edit it here if you ever need to do emergency cleanup (e.g. wipe
spam).

You can also use the **CLI** tab inside Upstash to run Redis commands
directly:

```
GET issues:all:v1
DEL issues:all:v1
```

---

## Troubleshooting

**"I installed Upstash but the header still says `memory-fallback`"**
→ The most common cause is forgetting to **Redeploy** (step 6). Env vars are
read at function startup. Without a redeploy, the function still has the old
(no-env-var) environment.

**"Vercel says the integration is connected but I don't see the env vars in my project settings"**
→ The integration probably linked to a different project. Go to
`https://vercel.com/integrations/upstash` → **Manage** → look at the
"Connected Projects" list. Add your project if it's missing.

**"My function returns 500"**
→ Check the function logs: Vercel dashboard → your project → **Logs** tab →
filter by `Issues`. The most likely cause is a typo'd env var name, but the
code already reads both `UPSTASH_REDIS_REST_*` and `KV_REST_API_*` so this
shouldn't happen unless the integration was uninstalled partway.

**"Free tier says 10k commands/day — will I hit that?"**
→ Each issue list refresh is 1 GET. Each submit is 1 GET (dup check) + 1
SET = 2 commands. Each status update / reply = 1 GET + 1 SET = 2 commands.
The client also polls every 15s while the Issues overlay is open. So a heavy
day might look like: 100 visitors × 4 polls each = 400 + ~50 submissions +
~20 owner updates = ~500 commands. You're at 5% of the free limit on a busy
day. Don't worry about it.

**"I want to wipe all issues"**
→ Easiest: Upstash console → your DB → **Data** tab → click the trash icon
next to `issues:all:v1`. Or run `DEL issues:all:v1` in the Upstash CLI.
Or use the Owner panel's Delete button on each issue.

---

## What changed in the code

Only **one file** changed for this Upstash switch: `api/issues.js`. The
diff:

```js
// Before — only read KV_* names
const KV_URL   = process.env?.KV_REST_API_URL;
const KV_TOKEN = process.env?.KV_REST_API_TOKEN;

// After — read BOTH naming conventions (Upstash Vercel integration sets both)
function env(name){
  return (typeof process !== 'undefined' ? process.env?.[name] : undefined)
      ?? (typeof globalThis !== 'undefined' ? globalThis[name] : undefined);
}
const KV_URL   = env('UPSTASH_REDIS_REST_URL')   ?? env('KV_REST_API_URL');
const KV_TOKEN = env('UPSTASH_REDIS_REST_TOKEN') ?? env('KV_REST_API_TOKEN');
```

Plus a new diagnostic response header:

```
X-Issues-Storage: upstash-redis   ← good, persistence is live
X-Issues-Storage: memory-fallback ← Upstash not configured yet
```

That's it. No client-side changes, no new dependencies, no `package.json`
changes. The `index.html` and `vercel.json` from the previous step are
unchanged.

---

## Useful links

- Install Upstash on Vercel: <https://vercel.com/integrations/upstash>
- Upstash console (view your DB / data / CLI): <https://console.upstash.com/>
- Upstash × Vercel official docs: <https://upstash.com/docs/redis/howto/vercelintegration>
- Upstash pricing (free tier details): <https://upstash.com/pricing>
- Manage your Upstash × Vercel integration: <https://vercel.com/integrations/upstash> → **Manage**
