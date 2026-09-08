export function missing(required: readonly string[], held: readonly string[] | undefined): boolean {
  const available = new Set(held ?? []);
  return required.some(value => !available.has(value));
}

