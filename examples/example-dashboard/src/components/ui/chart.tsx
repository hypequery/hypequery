"use client"

import * as React from "react"
import { Tooltip, TooltipProps } from "recharts"
import { cn } from "@/lib/utils"

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode
    color?: string
  }
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | undefined>(undefined)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error("useChart must be used within a ChartProvider")
  }
  return context
}

interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  config: ChartConfig
}

export const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ config, className, children, ...props }, ref) => {
    const id = React.useId()

    return (
      <ChartContext.Provider value={{ config }}>
        <div ref={ref} className={cn("h-[400px]", className)} {...props}>
          <style>
            {Object.entries(config).map(([key, value]) => {
              return `
                [data-chart-id="${id}"] {
                  --color-${key}: ${value.color};
                }
              `
            })}
          </style>
          <div data-chart-id={id} className="h-full">
            {children}
          </div>
        </div>
      </ChartContext.Provider>
    )
  }
)
ChartContainer.displayName = "ChartContainer"

interface ChartTooltipProps extends Omit<TooltipProps<number, string>, 'content'> {
  content?: React.ReactNode
  indicator?: "line" | "dot"
}

export const ChartTooltip = React.forwardRef<any, ChartTooltipProps>(
  ({ content, ...props }, ref) => {
    if (!content) return null


    return (
      // @ts-ignore - Recharts tooltip type issues
      <Tooltip
        {...props}
        // @ts-ignore - Recharts tooltip type issues
        content={content}
        cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
        wrapperStyle={{ outline: "none" }}
      />
    )
  }
)
ChartTooltip.displayName = "ChartTooltip"

interface ChartTooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload: Record<string, any> }>
  label?: string
  indicator?: "line" | "dot"
}

export const ChartTooltipContent = React.forwardRef<HTMLDivElement, ChartTooltipContentProps>(
  ({ active, payload, label, className, indicator = "dot", ...props }, ref) => {
    const { config } = useChart()

    if (!active || !payload?.length) {
      return null
    }

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg border bg-background p-2 shadow-sm",
          className
        )}
        {...props}
      >
        <div className="grid gap-2">
          <div className="grid gap-1">
            <div className="text-sm font-medium">{label}</div>
            <div className="grid gap-2">
              {payload.map((item, index) => {
                const color = config[item.name]?.color
                return (
                  <div key={index} className="flex items-center gap-2">
                    {indicator === "line" ? (
                      <div className="h-0.5 w-3" style={{ background: color }} />
                    ) : (
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ background: color }}
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {config[item.name]?.label ?? item.name}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {item.value}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }
)
ChartTooltipContent.displayName = "ChartTooltipContent" 