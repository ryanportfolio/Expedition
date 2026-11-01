# Deployment

> Deploy target, build output, asset paths, publish flow.

- Build: `npm run build` (`vite build`) writes a static site to `dist/`: `index.html` plus hashed JS. No server code, no environment variables.
- Paths are relative (`base: './'` in `vite.config.js`), so `dist/` runs from any folder or sub-path. Check it locally with `npm run preview`.
- Not deployed yet. No host is chosen and no deploy happens without a separate user OK.
