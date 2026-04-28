type TrimLeft<S extends string> = S extends ` ${infer R}` ? TrimLeft<R> : S;
type TrimRight<S extends string> = S extends `${infer R} ` ? TrimRight<R> : S;
type Trim<S extends string> = TrimLeft<TrimRight<S>>;
type Push<T extends string[], V extends string> = [...T, V];

// Split a comma-separated argument list while preserving nested (...) groups.
export type ParseTopLevelArgs<
  S extends string,
  Current extends string = '',
  Depth extends string[] = [],
  Result extends string[] = []
> = S extends `${infer First}${infer Rest}`
  ? First extends '('
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
