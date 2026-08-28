type ClickHouseWhitespace = ' ' | '\n' | '\r' | '\t';
type QuoteCharacter = "'" | '"' | '`';
type TrimLeft<S extends string> = S extends `${ClickHouseWhitespace}${infer R}` ? TrimLeft<R> : S;
type TrimRight<S extends string> = S extends `${infer R}${ClickHouseWhitespace}` ? TrimRight<R> : S;
type Trim<S extends string> = TrimLeft<TrimRight<S>>;
type Push<T extends string[], V extends string> = [...T, V];

// Split a comma-separated argument list while preserving nested (...) groups.
export type ParseTopLevelArgs<
  S extends string,
  Current extends string = '',
  Depth extends string[] = [],
  Result extends string[] = [],
  Quote extends QuoteCharacter | '' = '',
  Escaped extends boolean = false
> = S extends `${infer First}${infer Rest}`
  ? Quote extends QuoteCharacter
    ? Escaped extends true
      ? ParseTopLevelArgs<Rest, `${Current}${First}`, Depth, Result, Quote, false>
      : First extends '\\'
        ? ParseTopLevelArgs<Rest, `${Current}${First}`, Depth, Result, Quote, true>
        : First extends Quote
          ? ParseTopLevelArgs<Rest, `${Current}${First}`, Depth, Result, '', false>
          : ParseTopLevelArgs<Rest, `${Current}${First}`, Depth, Result, Quote, false>
    : First extends QuoteCharacter
      ? ParseTopLevelArgs<Rest, `${Current}${First}`, Depth, Result, First, false>
      : First extends '('
    ? ParseTopLevelArgs<Rest, `${Current}${First}`, Push<Depth, First>, Result>
    : First extends ')'
      ? Depth extends [...infer Remaining extends string[], string]
        ? ParseTopLevelArgs<Rest, `${Current}${First}`, Remaining, Result>
        : ParseTopLevelArgs<Rest, `${Current}${First}`, Depth, Result>
      : First extends ','
        ? Depth['length'] extends 0
          ? ParseTopLevelArgs<Rest, '', Depth, Push<Result, Trim<Current>>>
          : ParseTopLevelArgs<Rest, `${Current}${First}`, Depth, Result>
        : ParseTopLevelArgs<Rest, `${Current}${First}`, Depth, Result>
  : Current extends ''
    ? Result
    : Push<Result, Trim<Current>>;

type LowercaseLetter =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';
type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type IdentifierStart = LowercaseLetter | Uppercase<LowercaseLetter> | '_';
type IdentifierCharacter = IdentifierStart | Digit;

type DecodeClickHouseEscape<C extends string> =
  C extends 'b' ? '\b'
  : C extends 'f' ? '\f'
  : C extends 'n' ? '\n'
  : C extends 'r' ? '\r'
  : C extends 't' ? '\t'
  : C extends '0' ? '\0'
  : C;

type TakeIdentifierRest<S extends string, Name extends string> =
  S extends `${infer First}${infer Rest}`
    ? First extends IdentifierCharacter
      ? TakeIdentifierRest<Rest, `${Name}${First}`>
      : First extends ClickHouseWhitespace
        ? TrimLeft<Rest> extends infer Type extends string
          ? Type extends '' ? never : [Name, Type]
          : never
        : never
    : never;

type TakeUnquotedIdentifier<S extends string> =
  S extends `${infer First}${infer Rest}`
    ? First extends IdentifierStart
      ? TakeIdentifierRest<Rest, First>
      : never
    : never;

type TakeBacktickIdentifier<
  S extends string,
  Name extends string = '',
  Escaped extends boolean = false
> = S extends `${infer First}${infer Rest}`
  ? Escaped extends true
    ? TakeBacktickIdentifier<Rest, `${Name}${DecodeClickHouseEscape<First>}`, false>
    : First extends '\\'
      ? TakeBacktickIdentifier<Rest, Name, true>
      : First extends '`'
        ? Rest extends `${ClickHouseWhitespace}${infer Type}`
          ? TrimLeft<Type> extends infer TrimmedType extends string
            ? TrimmedType extends '' ? never : [Name, TrimmedType]
            : never
          : never
        : TakeBacktickIdentifier<Rest, `${Name}${First}`, false>
  : never;

/** Split a canonical named Tuple element into its field name and ClickHouse type. */
export type ParseNamedTuplePart<S extends string> =
  Trim<S> extends infer Part extends string
    ? Part extends `\`${infer Rest}`
      ? TakeBacktickIdentifier<Rest>
      : TakeUnquotedIdentifier<Part>
    : never;

/** Whether every Tuple argument has an explicit field name. */
export type AreAllTuplePartsNamed<Parts extends readonly string[]> =
  Parts extends readonly [infer First extends string, ...infer Rest extends string[]]
    ? [ParseNamedTuplePart<First>] extends [never]
      ? false
      : AreAllTuplePartsNamed<Rest>
    : true;

/** Convert named Tuple arguments into a field-name-to-ClickHouse-type map. */
export type ParseNamedTupleFields<Parts extends readonly string[]> = {
  [Part in Parts[number] as ParseNamedTuplePart<Part> extends [infer Name extends string, string]
    ? Name
    : never]: ParseNamedTuplePart<Part> extends [string, infer Type extends string]
      ? Type
      : never;
};
