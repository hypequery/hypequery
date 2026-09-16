export {
  decodeCanonicalValue,
  encodeCanonicalValue,
  encodeCanonicalValueToString,
  hashCanonicalValue,
} from './codec.js';
export { ProtocolValueError } from './errors.js';
export type { ProtocolValueErrorCode } from './errors.js';
export { DEFAULT_CANONICAL_VALUE_LIMITS } from './limits.js';
export { validateCanonicalValue } from './validate.js';
export type {
  ArrayTaggedValue,
  BytesTaggedValue,
  CanonicalValue,
  CanonicalValueLimits,
  CanonicalValueOptions,
  DateTaggedValue,
  DatetimeTaggedValue,
  DecimalTaggedValue,
  EnumTaggedValue,
  IntegerTaggedValue,
  MapTaggedValue,
  TaggedValue,
  TupleTaggedValue,
  UuidTaggedValue,
} from './types.js';
