const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
const TYPE_KEY = '__hq_type';
function hasBuffer() {
    return typeof globalThis !== 'undefined' && typeof globalThis.Buffer !== 'undefined';
}
function bufferFrom(bytes) {
    return globalThis.Buffer.from(bytes);
}
function bufferToUint8(buffer) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
function toBase64(bytes) {
    if (hasBuffer()) {
        return bufferFrom(bytes).toString('base64');
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa !== 'undefined') {
        return btoa(binary);
    }
    throw new Error('Base64 encoding not supported in this environment.');
}
function fromBase64(value) {
    if (hasBuffer()) {
        const buf = globalThis.Buffer.from(value, 'base64');
        return bufferToUint8(buf);
    }
    if (typeof atob === 'undefined') {
        throw new Error('Base64 decoding not supported in this environment.');
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
function normalizeForStable(value) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
        return Number.isNaN(value)
            ? { [TYPE_KEY]: 'nan', value: 'NaN' }
            : value;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'bigint') {
        return { [TYPE_KEY]: 'bigint', value: value.toString() };
    }
    if (typeof value === 'undefined') {
        return { [TYPE_KEY]: 'undefined' };
    }
    if (value instanceof Date) {
        return { [TYPE_KEY]: 'date', value: value.toISOString() };
    }
    if (Array.isArray(value)) {
        return value.map(item => normalizeForStable(item));
    }
    if (value instanceof Set) {
        return Array.from(value.values())
            .map(item => normalizeForStable(item))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (value instanceof Map) {
        const entries = Array.from(value.entries()).sort(([a], [b]) => String(a).localeCompare(String(b)));
        const normalized = {};
        for (const [key, val] of entries) {
            normalized[String(key)] = normalizeForStable(val);
        }
        return normalized;
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
        const uint8 = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return { [TYPE_KEY]: 'u8', value: toBase64(uint8) };
    }
    if (value && typeof value === 'object') {
        const raw = value;
        const keys = Object.keys(raw).sort();
        const normalized = {};
        for (const key of keys) {
            normalized[key] = normalizeForStable(raw[key]);
        }
        return normalized;
    }
    return { [TYPE_KEY]: 'unknown', value: String(value) };
}
export function stableStringify(value) {
    return JSON.stringify(normalizeForStable(value));
}
function encodeSpecial(value) {
    if (typeof value === 'bigint') {
        return { [TYPE_KEY]: 'bigint', value: value.toString() };
    }
    if (value instanceof Date) {
        return { [TYPE_KEY]: 'date', value: value.toISOString() };
    }
    if (typeof value === 'undefined') {
        return { [TYPE_KEY]: 'undefined' };
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
        const uint8 = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return { [TYPE_KEY]: 'u8', value: toBase64(uint8) };
    }
    return undefined;
}
function decodeSpecial(value) {
    switch (value[TYPE_KEY]) {
        case 'bigint':
            return value.value !== undefined ? BigInt(value.value) : undefined;
        case 'date':
            return value.value ? new Date(value.value) : null;
        case 'undefined':
            return undefined;
        case 'u8':
            if (!value.value)
                return new Uint8Array();
            return fromBase64(value.value);
        case 'nan':
            return Number.NaN;
        default:
            return value.value;
    }
}
function reviveSpecialValues(value) {
    if (!value || typeof value !== 'object') {
        return value;
    }
    if (value[TYPE_KEY]) {
        return decodeSpecial(value);
    }
    if (Array.isArray(value)) {
        return value.map(item => reviveSpecialValues(item));
    }
    const record = value;
    for (const key of Object.keys(record)) {
        record[key] = reviveSpecialValues(record[key]);
    }
    return record;
}
export function defaultSerialize(value) {
    const json = JSON.stringify(value, (_key, val) => encodeSpecial(val) ?? val);
    if (!encoder) {
        return { payload: json, byteSize: json.length };
    }
    const bytes = encoder.encode(json);
    return { payload: bytes, byteSize: bytes.byteLength };
}
export function defaultDeserialize(raw) {
    const json = typeof raw === 'string'
        ? raw
        : encoder && decoder
            ? decoder.decode(raw)
            : new TextDecoder().decode(raw);
    const parsed = JSON.parse(json);
    return reviveSpecialValues(parsed);
}
export function estimateByteSize(value) {
    const json = JSON.stringify(value);
    if (!encoder) {
        return json.length;
    }
    return encoder.encode(json).byteLength;
}
