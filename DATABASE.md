# keralamX Database Setup

This project saves "Register a Food Spot" submissions through the Vercel Function at `/api/spots`.

## Vercel setup

1. Open the project in Vercel.
2. Go to Storage or Marketplace Storage.
3. Add a Postgres database provider such as Neon or Supabase.
4. Connect it to this project.
5. Redeploy the project so Vercel injects the database environment variables.

The API reads `DATABASE_URL` first and falls back to `POSTGRES_URL`. Vercel Marketplace Postgres integrations commonly provide one or both connection variables.

## Local setup

Install dependencies:

```bash
npm install
```

Pull Vercel environment variables after the project is linked:

```bash
vercel env pull .env.local
```

Run locally through Vercel so `/api/spots` is available:

```bash
npm run dev
```

The `food_spots` table is created automatically the first time `/api/spots` is called.
