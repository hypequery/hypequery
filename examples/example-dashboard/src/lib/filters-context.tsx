'use client'

import { DateRange } from "react-day-picker"
import { createContext, useContext, ReactNode, useState } from "react"

interface FiltersContextType {
  pickupDateRange: DateRange | undefined
  setPickupDateRange: (range: DateRange | undefined) => void
  dropoffDateRange: DateRange | undefined
  setDropoffDateRange: (range: DateRange | undefined) => void
}

const FiltersContext = createContext<FiltersContextType | undefined>(undefined)

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [pickupDateRange, setPickupDateRange] = useState<DateRange | undefined>(undefined)
  const [dropoffDateRange, setDropoffDateRange] = useState<DateRange | undefined>(undefined)

  return (
    <FiltersContext.Provider value={{
      pickupDateRange,
      setPickupDateRange,
      dropoffDateRange,
      setDropoffDateRange,
    }}>
      {children}
    </FiltersContext.Provider>
  )
}

export function useFilters() {
  const context = useContext(FiltersContext)
  if (context === undefined) {
    throw new Error('useFilters must be used within a FiltersProvider')
  }
  return context
} 