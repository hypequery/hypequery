import { prepareProtocolClientContract } from './validate.js';
import type {
  ClientEndpointAnnotations,
  ClientFieldAnnotation,
  PreparedProtocolClientContract,
  ProtocolClientEndpoint,
} from './types.js';

function fieldText(field: ClientFieldAnnotation): ClientFieldAnnotation | undefined {
  const { label, description } = field;
  if (label === undefined && description === undefined) return undefined;
  return { ...(label === undefined ? {} : { label }), ...(description === undefined ? {} : { description }) };
}

function textOnly(annotations: ClientEndpointAnnotations): ClientEndpointAnnotations | undefined {
  const fields = Object.fromEntries(Object.entries(annotations.fields ?? {}).flatMap(([key, field]) => {
    const text = fieldText(field);
    return text ? [[key, text]] : [];
  }));
  const { label, description } = annotations;
  const result: ClientEndpointAnnotations = {
    ...(label === undefined ? {} : { label }),
    ...(description === undefined ? {} : { description }),
    ...(Object.keys(fields).length ? { fields } : {}),
  };
  return Object.keys(result).length ? result : undefined;
}

/**
 * The same contract and view without field annotations' synonyms, examples,
 * format, unit and currency, for a consumer that did not ask for field
 * metadata. Field entries, `fields` and `annotations` left empty are omitted, so
 * the result has one canonical encoding; every schemaHash is unchanged and the
 * contentHash is recomputed.
 */
export function withoutClientFieldMetadata(prepared: PreparedProtocolClientContract): PreparedProtocolClientContract {
  const { contract } = prepared;
  const endpoints = contract.endpoints.map((endpoint: ProtocolClientEndpoint) => {
    const { schemaHash: _schemaHash, annotations, ...rest } = endpoint;
    const text = annotations ? textOnly(annotations) : undefined;
    return text ? { ...rest, annotations: text } : rest;
  });
  return prepareProtocolClientContract({ kind: contract.kind, version: contract.version, view: contract.view, endpoints });
}
