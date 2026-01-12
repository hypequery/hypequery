"use client"

import { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "./card"
import { Skeleton } from "./skeleton"

export interface SubValue {
  label: string
  value: string | number
}

export interface KPICardProps {
  title: string
  value: string | number
  subValues?: SubValue[]
  loading?: boolean
  className?: string
}

export function KPICard({ title, value, subValues, loading, className }: KPICardProps) {
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-4 w-[100px]" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-[120px]" />
          {subValues && (
            <div className="mt-4 space-y-2">
              {subValues.map((_, i) => (
                <Skeleton key={i} className="h-4 w-[80px]" />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subValues && (
          <div className="mt-4 space-y-2">
            {subValues.map((subValue, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{subValue.label}</span>
                <span className="font-medium">{subValue.value}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
} 