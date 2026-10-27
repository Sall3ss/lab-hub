/** Official client UI copied to /assets/ui by tools/extractor/copy_ui.py. */
export function uiUrl(rel: string): string {
  const clean = rel.replace(/^\//, '').replace(/\.(png|webp)$/i, '');
  return `${import.meta.env.BASE_URL}assets/ui/${clean}.webp`;
}

/** Item / misc sprites under /assets (not the ui/ subtree). */
export function assetUrl(rel: string): string {
  const clean = rel.replace(/^\//, '').replace(/\.(png|webp)$/i, '');
  return `${import.meta.env.BASE_URL}assets/${clean}.webp`;
}

// Cyberidle: sem as imagens do cliente original no topo; usa os ícones próprios (SVG neon).
export const NAV_ICON: Record<string, string> = {};

/** Colorful in-game UI sprites (under /assets/ui/) that beat flat topbuttons. */
// Cyberidle: sem as imagens do cliente original no topo; usa os ícones próprios (SVG neon).
export const NAV_UI_ICON: Record<string, string> = {};

/** Colorful item sprites that read better at nav size than flat topbuttons. */
// Cyberidle: sem as imagens do cliente original no topo; usa os ícones próprios (SVG neon).
export const NAV_ASSET_ICON: Record<string, string> = {};
