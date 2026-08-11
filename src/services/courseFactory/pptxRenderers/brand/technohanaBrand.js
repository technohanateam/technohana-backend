import path from "path";
import { fileURLToPath } from "url";

// Centralized Technohana brand asset config for the Course Factory PPTX
// renderer — the single place logo paths/aspect ratios are defined, per the
// brand-integration requirement that no renderer scatter its own logo path
// or guess an aspect ratio. Paths are resolved relative to this file (not a
// developer-specific absolute path), so this works unchanged in local dev,
// tests, and a deployed backend — the assets are bundled inside the repo,
// not read from outside it.
const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");

// Real pixel dimensions of the source PNG/JPG files (measured once, not
// re-derived at render time) — used to compute height from a target width
// so the logo is never stretched independently in X/Y.
export const TECHNOHANA_BRAND = {
  primaryLogo: { path: path.join(ASSETS_DIR, "TH_BRAND_001_Primary_Logo.png"), width: 1227, height: 221 },
  icon: { path: path.join(ASSETS_DIR, "TH_BRAND_002_T_Icon.jpg"), width: 1024, height: 1024 },
  logoLight: { path: path.join(ASSETS_DIR, "TH_BRAND_003_Logo_Light.png"), width: 1227, height: 221 },
  logoDark: { path: path.join(ASSETS_DIR, "TH_BRAND_004_Logo_Dark.png"), width: 1355, height: 269 },
};

// variant -> asset key, per the light/dark background selection rule.
const VARIANT_TO_ASSET = {
  primary: "primaryLogo",
  light: "logoLight", // used ON dark backgrounds (a light-colored mark)
  dark: "logoDark", // used ON light/white backgrounds (a dark-colored mark)
  icon: "icon",
};

// Computes {w, h} for a target width, preserving the source image's aspect
// ratio exactly — the only way callers are allowed to size a logo.
export function logoSize(variant, targetWidth) {
  const asset = TECHNOHANA_BRAND[VARIANT_TO_ASSET[variant]];
  const h = targetWidth * (asset.height / asset.width);
  return { w: targetWidth, h };
}

export function logoPath(variant) {
  return TECHNOHANA_BRAND[VARIANT_TO_ASSET[variant]].path;
}
