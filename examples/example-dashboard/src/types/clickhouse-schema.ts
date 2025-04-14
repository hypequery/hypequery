export interface IntrospectedSchema {
  trips: {
    pickup_datetime: "DateTime"
    dropoff_datetime: "DateTime"
    trip_distance: "Float64"
    passenger_count: "Int32"
    fare_amount: "Float64"
    tip_amount: "Float64"
    total_amount: "Float64"
    payment_type: "String"
  }
} 