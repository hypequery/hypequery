export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ExtractNames<Api> = Extract<keyof Api, string>;

export type QueryInput<
  Api,
  Name extends ExtractNames<Api>
> = Api[Name] extends { input: infer Input } ? Input : never;

export type QueryOutput<
  Api,
  Name extends ExtractNames<Api>
> = Api[Name] extends { output: infer Output } ? Output : never;
