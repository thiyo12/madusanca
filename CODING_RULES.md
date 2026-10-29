# Madusanca — Coding Rules

## General Rules
1. **Inspect existing files before editing** — Never assume code structure; always read the relevant files first.
2. **Continue existing working code** — Never rewrite functioning code unnecessarily. Extend or modify in-place.
3. **Never create duplicates** — No duplicate components, APIs, authentication systems, or database implementations. Search before adding new code.
4. **Never leave dead code** — Remove unused functions, obsolete files, or broken routes safely after checking dependencies.
5. **Keep changes compatible** — All modifications must remain compatible with existing functionality.
6. **Keep application organized, readable, and maintainable** — Follow existing patterns and conventions.

## TypeScript Rules
7. **Strict mode enabled** — `strict: true` in tsconfig.json. No `any` types unless absolutely necessary; use proper types instead.
8. **Path aliases** — `@/...` paths defined in tsconfig.json and eslint.config.mjs. Import as `@/components/ui/button`, etc.
9. **Type checking** — Run `npm run typecheck` (or `npx tsc --noEmit`) before committing. Fix all type errors.
10. **Never hardcode sensitive information** — No API keys, database URLs, or secrets in source code.

## Tailwind CSS Rules
11. **Config-first approach** — Extend `tailwind.config.ts` (to be created) for custom colors, fonts, and breakpoints. Do not use arbitrary values unless justified.
12. **Component-driven classes** — UI components define their own Tailwind classes; pages use semantic class combinations.
13. **Responsive design** — All new components must be fully responsive from 320px to 1440px+. Use mobile-first breakpoints.
14. **Dark mode support** — Ensure all components work in both light and dark themes (prefers-color-scheme).

## ESLint Rules
15. **Run lint before commit** — `npm run lint` must pass with no errors on modified files.
16. **No ignoring errors** — Do not add `// eslint-disable-next-line` comments unless absolutely necessary and documented.
17. **Component linting** — Components in `src/components/` must pass ESLint.

## Component Development Rules
18. **Reusable components only** — Components should be generic enough to be reused across pages. Avoid page-specific logic in components.
19. **Accessible by default** — Use semantic HTML, meaningful alt text, keyboard-friendly interactions, and proper contrast.
20. **Reduced-motion support** — Honor `prefers-reduced-motion` media query. Do not create animations that cannot be disabled.
21. **One component per file** — Each component gets its own `.tsx` file (except tiny utility components).

## Security Rules
22. **Never commit secrets** — GitHub is for application source code and safe documentation only.
23. **Use `.env.example` placeholders** — All environment variables must have a corresponding entry in `.env.example` with clear placeholder values.
24. **Server-side authorization** — Protect API routes and staff pages with server-side checks. Never rely on client-side validation alone.
25. **Row Level Security** — Implement proper RLS policies in Supabase for all tables.

## Git Rules
26. **Never push broken code** — Run TypeScript, ESLint, and production build locally before committing.
27. **Descriptive commit messages** — Follow conventional commit format where possible.
28. **Feature branches** — All new work must be on a dedicated branch, not directly on main.

## Testing Rules
29. **Functional tests** — Verify critical flows (homepage loads, form submission, navigation) before marking complete.
30. **Do not claim a feature is complete without testing** — Always run the application locally and verify the feature works.

## Project Structure
```
src/
  app/              # Next.js App Router pages and layouts
  components/       # Reusable UI components
    ui/             # Base UI components (button, card, etc.)
    layout/         # Navigation, footer, header
    forms/          # Form components
  lib/              # Utilities and helpers
    supabase/       # Supabase client configuration
    utilities/      # Generic helper functions
  styles/           # Global styles, typography
.env.example        # Placeholder environment variables (never real keys)
.gitignore        # Must exclude secrets and private files
```

## Documentation Rules
31. **Update PROJECT_PLAN.md** — Mark tasks as completed with verified status. Treat as a living document.
32. **Keep README.md current** — Update if new scripts or setup steps are added.