import { createContext, useContext, ReactNode } from "react"
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
  pickupDateRange: DateRange | undefined
  dropoffDateRange: DateRange | undefined
  setPickupDateRange: (range: DateRange | undefined) => void
  setDropoffDateRange: (range: DateRange | undefined) => void
}

export function FiltersProvider({
  children,
  pickupDateRange,
  dropoffDateRange,
  setPickupDateRange,
  setDropoffDateRange,
}: FiltersProviderProps) {
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