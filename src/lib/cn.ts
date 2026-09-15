type ClassValue = string | number | false | null | undefined;

/** Concatène des classes conditionnelles. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
