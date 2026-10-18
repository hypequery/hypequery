/** Projection for the versioned data-only client contract emitted by generate:client. */
type WireValue<Definition> = Definition extends { wireType: infer Wire; nullable: infer Nullable }
  ? (Wire extends 'number-or-string' ? number | string : Wire extends 'number' ? number : Wire extends 'boolean' ? boolean : string)
    | (Nullable extends false ? never : null)
  : unknown;

type ArrayNames<Value> = NonNullable<Value> extends readonly (infer Name)[] ? Name : never;
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
/** Names one fixed tuple always selects: an element typed as a union may name any of them. */
type TupleNames<Tuple> = Tuple extends readonly [infer Head, ...infer Rest]
  ? (IsUnion<Head> extends true ? never : Head) | TupleNames<Rest>
  : never;
/** Names every alternative of a (possibly union-typed) tuple selection selects. */
type CertainNames<Selection> = (Selection extends unknown ? (names: TupleNames<Selection>) => void : never) extends
  (names: infer Names) => void ? Names : never;

type SelectedFields<Definitions, Input, Key extends string, Defaults = never> =
  Key extends keyof Input
    ? Input extends Record<Key, readonly unknown[]>
      ? number extends Input[Key]['length']
        ? { [Name in Extract<ArrayNames<Input[Key]>, keyof Definitions>]?: WireValue<Definitions[Name]> }
        : { [Name in Extract<CertainNames<Input[Key]>, keyof Definitions>]-?: WireValue<Definitions[Name]> }
          & { [Name in Exclude<Extract<ArrayNames<Input[Key]>, keyof Definitions>, CertainNames<Input[Key]>>]?: WireValue<Definitions[Name]> }
      : { [Name in Extract<ArrayNames<Input[Key]> | Defaults, keyof Definitions>]?: WireValue<Definitions[Name]> }
    : { [Name in Extract<Defaults, keyof Definitions>]-?: WireValue<Definitions[Name]> };

type Period<Input> = Input extends { by: string } ? { period: string | null }
  : 'by' extends keyof Input ? { period?: string | null } : {};

type ProjectedOutput<Output, Row> = Omit<Output, 'data'> & { data: Row[] };

export type ClientOutputForInput<Info, Input, Fallback> = [Info] extends [never] ? Fallback : Input extends unknown
  ? Info extends { version: 1; kind: 'dataset'; dimensions: infer Dimensions; measures: infer Measures; defaultMeasures: readonly (infer Default)[] }
    ? ProjectedOutput<Fallback, SelectedFields<Dimensions, Input, 'dimensions'> & SelectedFields<Measures, Input, 'measures', Default> & Period<Input>>
    : Info extends { version: 1; kind: 'metric'; dimensions: infer Dimensions; metricName: infer Name extends string }
      ? ProjectedOutput<Fallback, SelectedFields<Dimensions, Input, 'dimensions'> & { [Key in Name]: string | null } & Period<Input>>
      : Fallback
  : never;
