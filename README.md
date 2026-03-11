# BrandBrain

AI-powered brand intelligence — start with a name, build a living brand profile.

## Deploy to Vercel

### Option 1: GitHub → Vercel (recommended)

1. **Push to GitHub:**
   ```bash
   cd brandbrain-vercel
   git init
   git add .
   git commit -m "BrandBrain prototype"
   gh repo create brandbrain --public --push
   ```

2. **Deploy on Vercel:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your `brandbrain` repo
   - Add environment variable: `ANTHROPIC_API_KEY` = your key
   - Click Deploy

### Option 2: Vercel CLI

```bash
cd brandbrain-vercel
npm install
npx vercel --prod
# When prompted, add ANTHROPIC_API_KEY as an environment variable
```

## Local Development

```bash
cd brandbrain-vercel
npm install
cp .env.example .env.local
# Edit .env.local with your Anthropic API key
npm run dev
# Open http://localhost:3000
```

## How It Works

- Type any company name → AI builds a brand intelligence profile
- Colors, typography, voice, messaging, competitive analysis, confidence scores
- Add more inputs (paste guidelines, describe assets) to enrich the profile
- Each addition triggers cross-source insights and raises confidence

## Architecture

```
app/
  layout.js       → Root layout with fonts
  globals.css     → Base styles + CSS variables
  page.js         → Main React client component (all UI)
  api/claude/
    route.js      → API proxy (keeps key server-side)
```

The API key never touches the browser. All Claude calls route through the Next.js API route.
