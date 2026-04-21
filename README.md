# StudyScheduler

StudyScheduler is a mobile-first adaptive planner for university exams, built with Next.js App Router + Prisma + PostgreSQL.

## Architecture Highlights

- PostgreSQL-ready Prisma schema (User, Exam, Topic, StudySession, Material).
- Magic Bookmark security middleware (cookie-based access without login UI).
- Confidence-driven retention (Anki/SuperMemo-style fields on Topic).
- Predictive scheduler with saturation alert and triage suggestions.
- Knowledge Matrix + Material Hub on exam page.
- Mobile-first UX with bottom navigation, focus mode, confidence voting (1-4), and Zen Mode context lock.
- Single Dark Matte theme (fixed, no light mode toggle).

## Environment Variables

Set these variables locally and on Vercel:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public"
PERSONAL_SECRET_KEY="your-long-random-private-key"
```

Notes:

- `DATABASE_URL` must be a PostgreSQL connection string.
- `PERSONAL_SECRET_KEY` is used by middleware for the magic bookmark unlock (`/?key=...`).

## Local Run

```bash
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run dev
```

## Production Deploy (Vercel)

1. Push repository to GitHub.
2. Import project in Vercel.
3. Add environment variables:
   - `DATABASE_URL`
   - `PERSONAL_SECRET_KEY`
4. Build command (recommended):

```bash
npm run prisma:generate && npm run build
```

5. After first deploy, run migrations once against production DB:

```bash
npm run prisma:migrate:deploy
```

## Course-Centric Rollout Checklist

When promoting the course-centric model to production, use this sequence:

1. Create a DB backup/snapshot.
2. Deploy application code.
3. Apply migrations:

```bash
npm run prisma:migrate:deploy
```

4. Run seed backfill to attach legacy exams/topics to placeholder courses:

```bash
npm run prisma:seed
```

5. Run validation checks:

```bash
npm run lint
npm run build
```

6. Verify in UI:

- Open /courses and confirm legacy exams appear under courses.
- Open a course and verify topic-exam assignments.
- Complete one weighted exam and confirm weighted projection updates.

Notes:

- Seed backfill is idempotent and safe to re-run.
- Topic-exam mapping is many-to-many; topic ownership is now course-level.

## Security Flow (Magic Bookmark)

- First unlock via URL: `/?key=<PERSONAL_SECRET_KEY>`.
- Middleware sets `app_auth=true` cookie for 365 days.
- Without cookie/key, pages return maintenance-style 404.
- API routes are protected with the same gate.

## Pro Productivity Features

- Knowledge Matrix: topic grid with recency (X-axis) and confidence (Y-axis), with at-risk topics highlighted.
- Material Hub: one-click links (Drive/PDF/Slides/Notes/etc.) attached to each topic.
- Confidence Feedback: after review completion, vote recall from 1 to 4 (Again, Hard, Good, Easy).
- Dynamic Retention Update: vote updates `ease_factor`, `interval_days`, `last_reviewed`, and `next_review`.
- Deep Work Zen Mode: full-screen timer with navigation context lock while running.
- Dark Matte UI: unified matte-black palette with semantic theme tokens.

## Quality Checks

```bash
npm run lint
npm run build
```
