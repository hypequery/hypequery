import type { VALUE_FORMATS } from './value-formats.js';

export type Field = (
  | { readonly kind: 'boolean' }
  | { readonly kind: 'enum'; readonly values: readonly (string | number)[] }
  | { readonly kind: 'enum_list'; readonly values: readonly string[] }
  | { readonly kind: 'format'; readonly format: keyof typeof VALUE_FORMATS }
  | { readonly kind: 'record'; readonly fields: Readonly<Record<string, Field>> }
) & { readonly description: string; readonly optional?: boolean };
export type Fields = Readonly<Record<string, Field>>;

export function enumeration<const V extends readonly (string | number)[]>(description: string, values: V) {
  return { kind: 'enum', description, values } as const;
}
export function boolean(description: string) { return { kind: 'boolean', description } as const; }
export function enumList<const V extends readonly string[]>(description: string, values: V) {
  return { kind: 'enum_list', description, values } as const;
}
export function formatted<const F extends Extract<Field, { kind: 'format' }>['format']>(description: string, format: F) {
  return { kind: 'format', description, format } as const;
}
export function record<const F extends Fields>(description: string, fields: F) {
  return { kind: 'record', description, fields } as const;
}
export function optional<const F extends Field>(field: F) { return { ...field, optional: true } as const; }
export function fieldsFor<const K extends readonly string[], const F extends Field>(keys: K, field: F) {
  return Object.fromEntries(keys.map(key => [key, field])) as Record<K[number], F>;
}

export type FieldValue<F extends Field> = F extends { kind: 'boolean' } ? boolean
  : F extends { kind: 'enum'; values: readonly (infer V)[] } ? V
  : F extends { kind: 'enum_list'; values: readonly (infer V)[] } ? readonly V[]
  : F extends { kind: 'record'; fields: infer R extends Fields } ? Properties<R>
  : string;
export type Properties<F extends Fields> = {
  [K in keyof F as F[K] extends { optional: true } ? never : K]: FieldValue<F[K]>;
} & {
  [K in keyof F as F[K] extends { optional: true } ? K : never]?: FieldValue<F[K]>;
};
