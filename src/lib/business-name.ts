/** The product's name, shown until a company saves its own business name in Settings. */
export const PRODUCT_NAME = "Sparepartslk";

/** The name to show for this company: the saved business name, or the product's name. */
export function displayName(saved: string | null | undefined): string {
  return saved?.trim() || PRODUCT_NAME;
}
