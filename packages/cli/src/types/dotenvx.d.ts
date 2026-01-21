declare module '@dotenvx/dotenvx' {
  export const config: {
    load?: () => Promise<void> | void;
  };
}
