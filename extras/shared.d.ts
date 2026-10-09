export const DEFAULT_SELECTOR: string;
export const DEFAULT_OUT_DIR: string;
export const TRANSPARENT_SUFFIX: string;
export const DEFAULT_THEMES: string[];
export const DEFAULT_THEME_ATTR: string;
export const DEFAULT_VARIANTS: Array<{ suffix: string; transparent: boolean }>;

export function normalizeBase(base?: string): string;
export function diagramSlug(pathname: string, base?: string): string;
export function pngFileName(index: number, theme: string, transparent?: boolean): string;
export function pngRelPath(o: {
  outDir?: string;
  slug: string;
  index: number;
  theme: string;
  transparent?: boolean;
}): string;
export function pngUrl(o: {
  base?: string;
  outDir?: string;
  slug: string;
  index: number;
  theme: string;
  transparent?: boolean;
}): string;
export function downloadName(o: {
  prefix?: string;
  slug: string;
  index: number;
  transparent?: boolean;
}): string;
export function resolveTheme(
  attrValue: string | null | undefined,
  themes?: string[],
  prefersDark?: boolean
): string;
