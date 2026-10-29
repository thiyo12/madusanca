# Wisdom Driving Academy

Website and booking application for a driving school. Built with Next.js, React, TypeScript, and Tailwind CSS.

## Local development

Requirements: Node.js and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Keep `.env.local` private and replace placeholders only in your local environment. Do not put personal contact details, credentials, student information, or private business data in this README or other public documentation.

## Checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```

## Project notes

- `PLAN.md` records current technical decisions; `PROJECT_PLAN.md` tracks project work and launch tasks.
- `.env.example` contains placeholders only. Configure real secrets outside source control.
- Local booking data and Supabase CLI link state are excluded from Git.
- Public indexing remains disabled until the approved production HTTPS origin is configured.
- This repository is source code only. A GitHub push does not deploy the application.

## Privacy and security

Never commit environment files, API keys, credentials, customer or student records, database exports, backups, logs, private documents, or personal data. Use synthetic data for development and protected environment variables for deployment.
