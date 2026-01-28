export interface TripsRow {
  trip_id: string;
  pickup_datetime: string;
  total_amount: number;
  passenger_count: number;
}

export interface AnalyticsSchema {
  trips: {
    trip_id: 'String';
    pickup_datetime: 'DateTime';
    total_amount: 'Float64';
    passenger_count: 'UInt8';
  };
}
