import { DatePicker } from "@/components/ui/date-picker"
import { DateRange } from "react-day-picker"

interface HeaderProps {
  dateRange: DateRange | undefined
  setDateRange: (dateRange: DateRange | undefined) => void
}

export function Header({ dateRange, setDateRange }: HeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      <div className="flex items-center gap-4">
        <DatePicker dateRange={dateRange} setDateRange={setDateRange} />
      </div>
    </div>
  )
} 