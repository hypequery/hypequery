function splitTopLevelArgs(value) {
  const parts = [];
  let current = '';
  let depth = 0;

  for (const char of value) {
    if (char === '(') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function unwrapType(type, wrapperName) {
  const prefix = `${wrapperName}(`;
  return type.startsWith(prefix) && type.endsWith(')')
    ? type.slice(prefix.length, -1)
    : null;
}

function getPrimitiveTsType(type) {
  const lowerType = type.toLowerCase();

  switch (lowerType) {
    case 'string':
    case 'uuid':
      return 'string';
    case 'int8':
    case 'int16':
    case 'int32':
    case 'uint8':
    case 'uint16':
    case 'uint32':
      return 'number';
    case 'int64':
    case 'uint64':
    case 'uint128':
    case 'uint256':
    case 'int128':
    case 'int256':
      return 'string';
    case 'float32':
    case 'float64':
    case 'decimal':
      return 'number';
    case 'datetime':
    case 'datetime64':
    case 'date':
    case 'date32':
      return 'string';
    case 'bool':
    case 'boolean':
      return 'boolean';
    default:
      if (type.startsWith('FixedString(')) return 'string';
      if (type.startsWith('Decimal(')) return 'number';
      if (type.startsWith('DateTime64(')) return 'string';
      if (type.startsWith('DateTime(')) return 'string';
      if (type.startsWith('Enum8(')) return 'string';
      if (type.startsWith('Enum16(')) return 'string';
      return null;
  }
}

export const clickhouseToTsType = (type) => {
  const wrappedArrayType = unwrapType(type, 'Array');
  if (wrappedArrayType) {
    return `Array<${clickhouseToTsType(wrappedArrayType)}>`;
  }

  const wrappedNullableType = unwrapType(type, 'Nullable');
  if (wrappedNullableType) {
    return `${clickhouseToTsType(wrappedNullableType)} | null`;
  }

  const wrappedLowCardinalityType = unwrapType(type, 'LowCardinality');
  if (wrappedLowCardinalityType) {
    return clickhouseToTsType(wrappedLowCardinalityType);
  }

  const wrappedTupleType = unwrapType(type, 'Tuple');
  if (wrappedTupleType) {
    const tupleParts = splitTopLevelArgs(wrappedTupleType);
    return `[${tupleParts.map(clickhouseToTsType).join(', ')}]`;
  }

  const wrappedMapType = unwrapType(type, 'Map');
  if (wrappedMapType) {
    const mapParts = splitTopLevelArgs(wrappedMapType);
    if (mapParts.length === 2) {
      const [, valueType] = mapParts;
      // JSON object keys are strings even when ClickHouse map keys are numeric.
      return `Record<string, ${clickhouseToTsType(valueType)}>`;
    }
    return 'Record<string, unknown>';
  }

  const primitiveType = getPrimitiveTsType(type);
  if (primitiveType) return primitiveType;

  // Unsupported or more complex ClickHouse types currently preserve the historical fallback.
  return 'string';
};
