"use client"

import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { ColumnDef } from "@tanstack/react-table"
import { useFilters } from "@/lib/filters-context"
import { DataTable } from "@/components/ui/data-table"
import { fetchTrips } from "@/lib/queries"

type Trip = {
  pickup_datetime: string
  dropoff_datetime: string
  trip_distance: number
  passenger_count: number
  fare_amount: number
  tip_amount: number
  total_amount: number
  payment_type: string
  vendor_id: string
}

const columns: ColumnDef<Trip>[] = [
  {
    accessorKey: "pickup_datetime",
    header: "Pickup Time",
    cell: ({ row }) => format(new Date(row.getValue("pickup_datetime")), "MMM d, yyyy HH:mm"),
  },
  {
    accessorKey: "dropoff_datetime",
    header: "Dropoff Time",
    cell: ({ row }) => format(new Date(row.getValue("dropoff_datetime")), "MMM d, yyyy HH:mm"),
  },
  {
    accessorKey: "trip_distance",
    header: "Distance (miles)",
    cell: ({ row }) => row.getValue<number>("trip_distance").toFixed(2),
  },
  {
    accessorKey: "passenger_count",
    header: "Passengers",
  },
  {
    accessorKey: "fare_amount",
    header: "Fare",
    cell: ({ row }) => `$${row.getValue<number>("fare_amount").toFixed(2)}`,
  },
  {
    accessorKey: "tip_amount",
    header: "Tip",
    cell: ({ row }) => `$${row.getValue<number>("tip_amount").toFixed(2)}`,
  },
  {
    accessorKey: "total_amount",
    header: "Total",
    cell: ({ row }) => `$${row.getValue<number>("total_amount").toFixed(2)}`,
  },
  {
    accessorKey: "payment_type",
    header: "Payment Type",
  },
  {
    accessorKey: "vendor_id",
    header: "Vendor",
  },
]

export function TripsDataTable() {
  const { pickupDateRange, dropoffDateRange } = useFilters()

  const { data: trips, isLoading } = useQuery({
    queryKey: ["trips", pickupDateRange, dropoffDateRange],
    queryFn: () => fetchTrips({ pickupDateRange, dropoffDateRange })
  })

  if (isLoading) {
    return <div>Loading...</div>
  }

  return <DataTable columns={columns} data={trips || []} />
} 