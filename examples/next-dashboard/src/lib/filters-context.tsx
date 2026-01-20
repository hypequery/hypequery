'use client'

import { createContext, useContext, ReactNode, useState } from "react"
import { DateRange } from "react-day-picker"

interface FiltersContextType {
  pickupDateRange: DateRange | undefined
  dropoffDateRange: DateRange | undefined
  setPickupDateRange: (range: DateRange | undefined) => void
  setDropoffDateRange: (range: DateRange | undefined) => void
}

const FiltersContext = createContext<FiltersContextType | undefined>(undefined)

export function useFilters() {
  const context = useContext(FiltersContext)
  if (!context) {
    throw new Error("useFilters must be used within a FiltersProvider")
  }
  return context
}

interface FiltersProviderProps {
  children: ReactNode
}

export function FiltersProvider({ children }: FiltersProviderProps) {
  const [pickupDateRange, setPickupDateRange] = useState<DateRange | undefined>(undefined)
  const [dropoffDateRange, setDropoffDateRange] = useState<DateRange | undefined>(undefined)

  return (
    <FiltersContext.Provider
      value={{
        pickupDateRange,
        dropoffDateRange,
        setPickupDateRange,
        setDropoffDateRange,
      }}
    >
      {children}
    </FiltersContext.Provider>
  )
} 