import type { ColumnType } from '@hypequery/clickhouse';

export interface IntrospectedSchema {
  otel_logs: {
    Timestamp: "DateTime64(9)";
    TimestampTime: "DateTime";
    TraceId: "String";
    SpanId: "String";
    TraceFlags: "UInt8";
    SeverityText: "LowCardinality(String)";
    SeverityNumber: "UInt8";
    ServiceName: "LowCardinality(String)";
    ResourceAttributes: "String"; // Simplified for type compatibility
    LogAttributes: "String"; // Simplified for type compatibility
    Body: "String";
    Host: "LowCardinality(String)";
    Source: "LowCardinality(String)";
  };
} 