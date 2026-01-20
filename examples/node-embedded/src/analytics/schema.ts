export interface TripsRow {
  trip_id: string;
  pickup_datetime: string;
  total_amount: number;
  passenger_count: number;
}

export interface AnalyticsSchema {
  trips: TripsRow;
}
