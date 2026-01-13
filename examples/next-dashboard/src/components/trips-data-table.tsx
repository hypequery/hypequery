"use client"

import { useState } from "react"
import { format } from "date-fns"
import { ColumnDef } from "@tanstack/react-table"

import { useFilters } from "@/lib/filters-context"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "./ui/button"
import { useHypequeryQuery } from "@/lib/hypequery-client"
import { buildFilterInput } from "@/lib/filter-utils"

type Trip = {
  pickup_datetime: string
  dropoff_datetime: string
  trip_distance: number
  passenger_count: number
  fare_amount: number
  tip_amount: number
  total_amount: number
  payment_type: string
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
]

export function TripsDataTable() {
  const { pickupDateRange, dropoffDateRange } = useFilters()
  const [cursor, setCursor] = useState<{ after?: string; before?: string }>({})
  const filters = buildFilterInput(pickupDateRange, dropoffDateRange)

  const { data, isLoading } = useHypequeryQuery('trips', {
    ...filters,
    pageSize: 10,
    after: cursor.after,
    before: cursor.before,
  })

  if (isLoading) {
    return <div>Loading...</div>
  }

  return (
    <div className="space-y-4">
      <DataTable columns={columns} data={data?.data || []} />
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {data?.pageInfo.totalCount ? (
            <>
              Showing {data.data.length} of {data.pageInfo.totalCount} trips
              {' • '}
              Page {Math.floor(data.data.length / data.pageInfo.pageSize) + 1} of {data.pageInfo.totalPages}
            </>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setCursor({ before: data?.pageInfo.startCursor ?? undefined })}
            disabled={!data?.pageInfo.hasPreviousPage}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            onClick={() => setCursor({ after: data?.pageInfo.endCursor ?? undefined })}
            disabled={!data?.pageInfo.hasNextPage}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
