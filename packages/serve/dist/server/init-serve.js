import { createProcedureBuilder } from "../builder.js";
import { defineServe } from "./define-serve.js";
export const initServe = (options) => {
    const { context, ...staticOptions } = options;
    const procedure = createProcedureBuilder();
    return {
        procedure,
        query: procedure,
        queries: (definitions) => definitions,
        define: (config) => {
            return defineServe({
                ...staticOptions,
                ...config,
                context: (context ?? {}),
            });
        },
    };
};
