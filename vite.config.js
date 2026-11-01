// Relative base so a build runs from any folder or sub-path. The Vite cache lives in .tmp because
// node_modules may be a shared link that nothing may write into.
export default {
  base: './',
  cacheDir: '.tmp/vite-cache',
};
