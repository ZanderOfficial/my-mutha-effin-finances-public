// Plaid category names as the screens show them.
/** FOOD_AND_DRINK becomes "Food and drink". */
export function categoryLabel(category: string): string {
  const words = category.replace(/_/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Uncategorised";
}
