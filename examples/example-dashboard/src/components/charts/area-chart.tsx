"use client"

import { TrendingUp } from "lucide-react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from "recharts"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

interface AreaChartProps {
  data: Array<{
    month: string
    desktop: number
  }>
  title?: string
  description?: string
  footer?: React.ReactNode
}

const chartConfig = {
  desktop: {
    label: "Trips",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig

export function AreaChartComponent({
  data,
  title = "Area Chart",
  description = "Showing total visitors for the last 6 months",
  footer
}: AreaChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{
                top: 20,
                right: 30,
                bottom: 60,
                left: 40,
              }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                angle={-45}
                textAnchor="end"
                height={60}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => value.toLocaleString()}
                tick={{ fontSize: 12 }}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent indicator="line" />}
              />
              <Area
                dataKey="desktop"
                type="monotone"
                fill="var(--color-desktop)"
                fillOpacity={0.2}
                stroke="var(--color-desktop)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
      {footer ? (
        <div className="p-6 pt-0">{footer}</div>
      ) : (
        <div className="p-6 pt-0">
          <div className="flex w-full items-start gap-2 text-sm">
            <div className="grid gap-2">
              <div className="flex items-center gap-2 font-medium leading-none">
                {data.length > 0 && (
                  <>
                    {data[data.length - 1].desktop > data[0].desktop ? (
                      <>
                        Trending up by{" "}
                        {(((data[data.length - 1].desktop - data[0].desktop) / data[0].desktop) * 100).toFixed(1)}%{" "}
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                      </>
                    ) : (
                      <>
                        Trending down by{" "}
                        {(((data[0].desktop - data[data.length - 1].desktop) / data[0].desktop) * 100).toFixed(1)}%{" "}
                        <TrendingUp className="h-4 w-4 rotate-180 text-red-500" />
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 leading-none text-muted-foreground">
                {data.length > 0 && `${data[0].month} - ${data[data.length - 1].month}`}
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
} 