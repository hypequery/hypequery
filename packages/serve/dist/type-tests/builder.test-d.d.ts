import { z } from 'zod';
export declare const api: import("../types.js").ServeBuilder<import("../types.js").ServeEndpointMap<{
    typedQuery: import("../types.js").ServeQueryConfig<z.ZodObject<{
        plan: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        plan?: string | undefined;
    }, {
        plan?: string | undefined;
    }>, z.ZodTypeAny, {}, import("../types.js").AuthContext, {
        plan: string;
    }[]>;
}, {}, import("../types.js").AuthContext>, {}, import("../types.js").AuthContext>;
//# sourceMappingURL=builder.test-d.d.ts.map