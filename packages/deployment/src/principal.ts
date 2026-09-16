/**
 * Who a deployed call is made as, after authentication and before any
 * authorization decision. Carried by every data-plane surface.
 */
export interface DeploymentDataPlanePrincipal {
  readonly subject?: string;
  readonly roles?: readonly string[];
  readonly scopes?: readonly string[];
  readonly claims?: Readonly<Record<string, unknown>>;
}
