/** Packaged desktop assets are local to homepage.html; no network asset host. */
export const assetUrl = (path: string) => {
  const key = path.replace(/^\//, "").replace(/^assets\//, "home-assets/");
  return new URL(`${import.meta.env.BASE_URL}${key}`, document.baseURI).href;
};
