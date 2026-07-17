const greeting = async ({ input }: { input: { name: string } }) => `Hello ${input.name}`;

const wrapped = {
  prefix: 'Welcome',
  async run({ input }: { input: { name: string } }) {
    return `${this.prefix} ${input.name}`;
  },
};

export const api = {
  queries: {
    greeting: { query: greeting },
    wrapped: { query: wrapped },
    semantic: { query: undefined },
  },
};
