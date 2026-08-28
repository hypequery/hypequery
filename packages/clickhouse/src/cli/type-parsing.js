function splitTopLevelArgs(value) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (const char of value) {
    if (quote) {
      current += char;

      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

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

function decodeClickHouseEscape(char) {
  switch (char) {
    case 'b': return '\b';
    case 'f': return '\f';
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case '0': return '\0';
    default: return char;
  }
}

function parseBacktickTuplePart(part) {
  let name = '';
  let escaped = false;

  for (let index = 1; index < part.length; index += 1) {
    const char = part[index];

    if (escaped) {
      name += decodeClickHouseEscape(char);
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '`') {
      const type = part.slice(index + 1);
      return /^\s+\S/s.test(type) ? { name, type: type.trim() } : null;
    }

    name += char;
  }

  return null;
}

function parseNamedTuplePart(value) {
  const part = value.trim();
  if (part.startsWith('`')) {
    return parseBacktickTuplePart(part);
  }

  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/s.exec(part);
  return match ? { name: match[1], type: match[2].trim() } : null;
}

function formatTypeScriptProperty(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function unwrapType(type, wrapperName) {
  // Trim whitespace and handle case-insensitive matching
  const trimmedType = type.trim();
  const lowerType = trimmedType.toLowerCase();
  const lowerWrapper = wrapperName.toLowerCase();
  const prefix = `${lowerWrapper}(`;

  if (lowerType.startsWith(prefix) && trimmedType.endsWith(')')) {
    // Extract inner type, preserving original case
    const innerStart = trimmedType.indexOf('(') + 1;
    const innerEnd = trimmedType.lastIndexOf(')');
    return trimmedType.slice(innerStart, innerEnd).trim();
  }

  return null;
}

function getPrimitiveTsType(type) {
  const lowerType = type.toLowerCase();

  switch (lowerType) {
    case 'string':
    case 'uuid':
    case 'ipv4':
    case 'ipv6':
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
    case 'json':
      return 'unknown';
    default:
      if (type.startsWith('FixedString(')) return 'string';
      if (type.startsWith('Decimal(')) return 'number';
      if (type.startsWith('Decimal32(')) return 'number';
      if (type.startsWith('Decimal64(')) return 'number';
      if (type.startsWith('Decimal128(')) return 'number';
      if (type.startsWith('Decimal256(')) return 'number';
      if (type.startsWith('DateTime64(')) return 'string';
      if (type.startsWith('DateTime(')) return 'string';
      if (type.startsWith('Enum8(')) return 'string';
      if (type.startsWith('Enum16(')) return 'string';
      return null;
  }
}

export const clickhouseToTsType = (type) => {
  const normalizedType = type.trim();
  const wrappedArrayType = unwrapType(normalizedType, 'Array');
  if (wrappedArrayType) {
    return `Array<${clickhouseToTsType(wrappedArrayType)}>`;
  }

  const wrappedNullableType = unwrapType(normalizedType, 'Nullable');
  if (wrappedNullableType) {
    return `${clickhouseToTsType(wrappedNullableType)} | null`;
  }

  const wrappedLowCardinalityType = unwrapType(normalizedType, 'LowCardinality');
  if (wrappedLowCardinalityType) {
    return clickhouseToTsType(wrappedLowCardinalityType);
  }

  const wrappedTupleType = unwrapType(normalizedType, 'Tuple');
  if (wrappedTupleType) {
    const tupleParts = splitTopLevelArgs(wrappedTupleType);
    const namedParts = tupleParts.map(parseNamedTuplePart);
    if (namedParts.length > 0 && namedParts.every(part => part !== null)) {
      return `{ ${namedParts
        .map(part => `${formatTypeScriptProperty(part.name)}: ${clickhouseToTsType(part.type)}`)
        .join('; ')} }`;
    }
    return `[${tupleParts.map(clickhouseToTsType).join(', ')}]`;
  }

  const wrappedMapType = unwrapType(normalizedType, 'Map');
  if (wrappedMapType) {
    const mapParts = splitTopLevelArgs(wrappedMapType);
    if (mapParts.length === 2) {
      const [, valueType] = mapParts;
      // JSON object keys are strings even when ClickHouse map keys are numeric.
      return `Record<string, ${clickhouseToTsType(valueType)}>`;
    }
    return 'Record<string, unknown>';
  }

  const primitiveType = getPrimitiveTsType(normalizedType);
  if (primitiveType) return primitiveType;

  // Unsupported or more complex ClickHouse types currently preserve the historical fallback.
  return 'string';
};
