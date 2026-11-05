export type ClientFieldType = 'string' | 'number' | 'boolean' | 'timestamp';
export type ClientWireType = 'string' | 'number' | 'boolean' | 'number-or-string';
export interface ClientDimension {
  readonly type: ClientFieldType;
  readonly wireType: ClientWireType;
  readonly nullable: boolean | 'unknown';
  readonly groupable: boolean;
  readonly orderable: boolean;
}
export interface ClientMeasure {
  readonly wireType: 'string';
  readonly nullable: true;
  readonly having: boolean;
}
export interface ClientFilter {
  readonly type: ClientFieldType;
  readonly operators: readonly string[];
}
export interface ClientTime {
  readonly grains: readonly string[];
  readonly defaultTimezone: string;
  readonly timezone: boolean;
  readonly periodFormat: 'calendar-date-or-local-datetime-v1';
}
export interface ClientQueryLimits {
  readonly defaultLimit: number;
  readonly maxLimit: number;
  readonly maxOffset: number;
  readonly maxDimensions: number;
  readonly maxMeasures: number;
  readonly maxPredicates: number;
  readonly maxOrderBy: number;
  readonly maxFilterValues: number;
}
/** Label and description: the presentation text an endpoint group and each field may carry. */
export interface ClientAnnotationText {
  readonly label?: string;
  readonly description?: string;
}
/**
 * Field presentation metadata. Besides text, a field may carry the deployment
 * contract's agent-facing vocabulary: synonyms and example values, a display
 * format, a unit and an ISO 4217 currency code. Producers emit the vocabulary
 * only to consumers that ask for it (`CLIENT_CONTRACT_FIELD_METADATA_FEATURE`).
 */
export interface ClientFieldAnnotation extends ClientAnnotationText {
  readonly synonyms?: readonly string[];
  readonly examples?: readonly string[];
  readonly format?: string;
  readonly unit?: string;
  readonly currency?: string;
}
/** Presentation text only; excluded from schemaHash and never a capability. */
export interface ClientEndpointAnnotations extends ClientAnnotationText {
  readonly fields?: Readonly<Record<string, ClientFieldAnnotation>>;
}
interface ClientEndpointBase {
  readonly id: string;
  readonly dataset: string;
  readonly path: string;
  readonly dimensions: Readonly<Record<string, ClientDimension>>;
  readonly measures: Readonly<Record<string, ClientMeasure>>;
  readonly filters: Readonly<Record<string, ClientFilter>>;
  readonly time: ClientTime | null;
  readonly metadata: boolean;
  readonly limits: ClientQueryLimits;
  readonly annotations?: ClientEndpointAnnotations;
  readonly schemaHash: string;
}
export interface ClientDatasetEndpoint extends ClientEndpointBase {
  readonly kind: 'dataset';
  readonly defaultMeasures: readonly string[];
}
export interface ClientMetricEndpoint extends ClientEndpointBase {
  readonly kind: 'metric';
}
export type ProtocolClientEndpoint = ClientDatasetEndpoint | ClientMetricEndpoint;
export interface ProtocolClientContract {
  readonly kind: 'hypequery-client-contract';
  readonly version: 1;
  readonly view: 'build' | 'authorized';
  readonly endpoints: readonly ProtocolClientEndpoint[];
  readonly contentHash: string;
}
export interface PreparedProtocolClientContract {
  readonly contract: ProtocolClientContract;
  readonly canonical: string;
  readonly contentHash: string;
}
