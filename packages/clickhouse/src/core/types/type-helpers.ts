export type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

export type Simplify<T> = { [K in keyof T]: T[K] } & {};
