# Deploy WQMS client to Vercel

## 1. Connect your repo

- Go to [vercel.com](https://vercel.com) and sign in (GitHub/GitLab/Bitbucket).
- **Add New** → **Project** and import your `wqms` repo.
- Set **Root Directory** to `client` (click Edit, then set to `client`).
- Leave **Framework Preset** as Create React App (auto-detected).

## 2. Environment variables

In the project settings → **Environment Variables**, add:

| Name | Value | Notes |
|------|--------|--------|
| `REACT_APP_SUPABASE_URL` | `https://xxxxx.supabase.co` | From Supabase → Settings → API |
| `REACT_APP_SUPABASE_ANON_KEY` | `eyJ...` | From Supabase → Settings → API (anon public) |

Optional (for live MQTT on the deployed app):

| Name | Value |
|------|--------|
| `REACT_APP_MQTT_URL` | `wss://your-broker...` (use `wss://` in browser) |
| `REACT_APP_MQTT_USER` | broker username |
| `REACT_APP_MQTT_PASS` | broker password |

If you don’t set MQTT vars, the app still works; readings come from Supabase.

## 3. Deploy

- Click **Deploy**. Vercel will run `npm run build` in the `client` folder and serve the `build` output.
- Your app will be at `https://your-project.vercel.app`. Nodes and data are read from Supabase, so they match what you see on localhost.

## Deploy from CLI (alternative)

From the repo root:

```bash
cd client
npx vercel
```

When prompted, set the root to `./` (you’re already in `client`). Add env vars with:

```bash
npx vercel env add REACT_APP_SUPABASE_URL
npx vercel env add REACT_APP_SUPABASE_ANON_KEY
```

Then `npx vercel --prod` for production.
