'use client'

import { DatePicker } from "@/components/ui/date-picker"
import { useFilters } from "@/lib/filters-context"

export function Header() {
  const { pickupDateRange, setPickupDateRange, dropoffDateRange, setDropoffDateRange } = useFilters()

  return (
    <header className="border-b">
      <div className="flex items-center h-16 px-4 gap-4">
        <h1 className="text-lg font-semibold">NYC Taxi Dashboard</h1>
        <div className="flex-1" />
        <DatePicker
          dateRange={pickupDateRange}
          setDateRange={setPickupDateRange}
          placeholder="Filter by pickup date"
        />
        <DatePicker
          dateRange={dropoffDateRange}
          setDateRange={setDropoffDateRange}
          placeholder="Filter by dropoff date"
        />
      </div>
    </header>
  )
} 