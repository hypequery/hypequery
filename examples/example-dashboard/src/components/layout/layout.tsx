"use client"

import { ReactNode, useState } from "react"
import { Header } from "./header"
import { Sidebar } from "./sidebar"
import { DateRange } from "react-day-picker"

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)

  return (
    <div className="flex h-screen">
      <div className="w-64 shrink-0">
        <Sidebar />
      </div>
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-8">
          {children}
        </main>
      </div>
    </div>
  )
} 