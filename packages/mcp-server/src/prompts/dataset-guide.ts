/**
 * Dataset Guide Prompt
 *
 * Provides natural language guidance for querying datasets.
 */

export function datasetGuidePrompt(datasets: Record<string, any>, datasetName?: string) {
  if (datasetName) {
    const dataset = datasets[datasetName];

    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetName}`);
    }

    // Generate dataset-specific guide
    const dimensions = dataset.dimensions ? Object.keys(dataset.dimensions) : [];
    const metrics = dataset.metrics ? Object.keys(dataset.metrics) : [];

    const guide = `# Querying the ${datasetName} dataset

## Available Dimensions
${dimensions.map((d) => `- ${d}`).join('\n')}

## Available Metrics
${metrics.map((m) => `- ${m}`).join('\n')}

## Example Queries

### Simple metric query
\`\`\`
Query the "${metrics[0] || 'revenue'}" metric
\`\`\`

### Grouped by dimension
\`\`\`
Show "${metrics[0] || 'revenue'}" by "${dimensions[0] || 'region'}"
\`\`\`

### With filters
\`\`\`
Show "${metrics[0] || 'revenue'}" by "${dimensions[0] || 'region'}" where ${dimensions[1] || 'status'} = 'active'
\`\`\`

### Time-series
\`\`\`
Show "${metrics[0] || 'revenue'}" by month for the last year
\`\`\`

## Tips
- Use natural language to describe what you want to see
- The system will translate your query into the appropriate dataset query
- You can filter, group, and aggregate data using the available dimensions and metrics
`;

    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: guide,
          },
        },
      ],
    };
  }

  // Generate general guide for all datasets
  const datasetList = Object.keys(datasets);

  const guide = `# Hypequery Semantic Layer Guide

## Available Datasets
${datasetList.map((name) => `- ${name}`).join('\n')}

## How to Query

1. **List datasets**: Use the \`list_datasets\` tool to see all available datasets
2. **Get schema**: Use the \`get_dataset_schema\` tool to see dimensions and metrics for a dataset
3. **Query metric**: Use the \`query_metric\` tool to execute a pre-defined metric
4. **Query dataset**: Use the \`query_dataset\` tool for ad-hoc queries with custom dimensions and metrics

## Example Workflow

1. First, explore available datasets:
   \`\`\`
   list_datasets()
   \`\`\`

2. Get the schema for a specific dataset:
   \`\`\`
   get_dataset_schema({ dataset: "orders" })
   \`\`\`

3. Query a metric:
   \`\`\`
   query_metric({
     dataset: "orders",
     metric: "revenue",
     dimensions: ["region"],
     filters: [{ field: "status", operator: "eq", value: "completed" }],
     grain: "month"
   })
   \`\`\`

## Filter Operators
- \`eq\`: Equal to
- \`neq\`: Not equal to
- \`gt\`: Greater than
- \`gte\`: Greater than or equal to
- \`lt\`: Less than
- \`lte\`: Less than or equal to
- \`in\`: In list
- \`notIn\`: Not in list
- \`between\`: Between two values
- \`like\`: Pattern match

## Time Grains
- \`day\`: Daily aggregation
- \`week\`: Weekly aggregation
- \`month\`: Monthly aggregation
- \`quarter\`: Quarterly aggregation
- \`year\`: Yearly aggregation
`;

  return {
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: guide,
        },
      },
    ],
  };
}
