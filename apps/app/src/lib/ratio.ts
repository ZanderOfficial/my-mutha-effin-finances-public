/**
 * `numerator / denominator` in basis points (10000 = 100 percent), rounded
 * down, using BigInt so large cent values cannot overflow. Null when either
 * side is unknown or the denominator is not positive.
 */
export function ratioBps(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (
    numerator === null ||
    numerator === undefined ||
    denominator === null ||
    denominator === undefined ||
    denominator <= 0
  ) {
    return null;
  }
  return Number((BigInt(numerator) * BigInt(10000)) / BigInt(denominator));
}
