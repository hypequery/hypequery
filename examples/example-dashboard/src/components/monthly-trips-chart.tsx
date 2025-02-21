import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/line-chart";
import * as RechartsPrimitive from "recharts";

const config = {
  value: {
    label: "Trip Count",
    theme: {
      light: "hsl(var(--chart-1))",
      dark: "hsl(var(--chart-1))",
    },
  },
};

interface MonthlyTripsChartProps {
  data: Array<{ name: string; value: number }>;
}

export function MonthlyTripsChart({ data }: MonthlyTripsChartProps) {
  return (
    <div className="w-full h-full">
      <ChartContainer config={config}>
        {/* @ts-ignore */}
        <RechartsPrimitive.LineChart data={data}>
          {/* @ts-ignore */}
          <RechartsPrimitive.XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          {/* @ts-ignore */}
          <RechartsPrimitive.YAxis
            tickLine={false}
            axisLine={false}
            width={80}
            tickFormatter={(value: number) => value.toLocaleString()}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          {/* @ts-ignore */}
          <RechartsPrimitive.Line
            type="monotone"
            dataKey="value"
            strokeWidth={2}
            dot={false}
          />
        </RechartsPrimitive.LineChart>
      </ChartContainer>
    </div>
  );
} 