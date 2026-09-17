// Що входить у фільтр «Волосся» на залишках (не лише isHair на картці).

function normalizeTitle(title: string): string {
  return String(title || "")
    .normalize("NFKC")
    .toLocaleLowerCase("uk-UA")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-яіїєґ0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Накладки, стрічки, треси — теж «волосся» у фільтрі типу. */
export function isHairAccessoryGroupTitle(title: string): boolean {
  const n = normalizeTitle(title);
  if (!n) return false;
  if (n.includes("накладк")) return true;
  if (n.includes("стрічк") || n.includes("лент")) return true;
  if (n.includes("трес")) return true;
  return false;
}

export function isHairTypeProduct(product: {
  isHair: boolean;
  groupTitle?: string | null;
  category?: string | null;
}): boolean {
  if (product.isHair) return true;
  return isHairAccessoryGroupTitle(product.groupTitle || "") || isHairAccessoryGroupTitle(product.category || "");
}
