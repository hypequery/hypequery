import type { ColumnType } from '@hypequery/clickhouse';

export interface IntrospectedSchema {
  otel_logs: {
    Timestamp: 'DateTime64(9)';
    TimestampTime: 'DateTime';
    TraceId: 'String';
    SpanId: 'String';
    TraceFlags: 'UInt8';
    SeverityText: 'LowCardinality(String)';
    SeverityNumber: 'UInt8';
    ServiceName: 'LowCardinality(String)';
    Body: 'String';
    ResourceSchemaUrl: 'LowCardinality(String)';
    ResourceAttributes: 'Map(LowCardinality(String), String)';
    ScopeSchemaUrl: 'LowCardinality(String)';
    ScopeName: 'String';
    ScopeVersion: 'LowCardinality(String)';
    ScopeAttributes: 'Map(LowCardinality(String), String)';
    LogAttributes: 'Map(LowCardinality(String), String)';
  };
  test_logs: {
    LogName: 'String';
    LogDescription: 'String'
    LogTag: 'Array(String)'
  }
} 
