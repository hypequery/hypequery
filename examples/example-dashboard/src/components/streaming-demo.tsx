'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { fetchTripsByStreaming } from '@/lib/queries';

const StreamingDemo = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [progress, setProgress] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [estimatedTotal, setEstimatedTotal] = useState(10000); // Estimate for progress bar
  const [batchesProcessed, setBatchesProcessed] = useState(0);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const handleStreamQuery = useCallback(async () => {
    try {
      setIsLoading(true);
      setProgress(0);
      clearLogs();
      setResults([]);
      setBatchesProcessed(0);

      // Use a higher estimate for unlimited query
      setEstimatedTotal(10000);

      // Track total processed rows for progress updates
      let allResults: any[] = [];

      await fetchTripsByStreaming(
        {}, // No filters
        {
          limit: 1000000,
          onProgress: (count: number, newRows?: any[]) => {
            // Add the new rows to our results and update the UI
            if (newRows && newRows.length > 0) {
              // Add the new rows to our accumulated results
              allResults = [...allResults, ...newRows];

              // Update the UI with all results so far
              setResults(allResults);
              setTotalRows(allResults.length);

              // Update progress based on estimated total
              setProgress(Math.min((allResults.length / estimatedTotal) * 100, 99));

              // Increment batch counter
              setBatchesProcessed(prev => prev + 1);
            }
          },
          // Directly capture logs from the HypeQuery logging system
          onLog: (logMessage: string) => {
            setLogs(prev => [...prev, logMessage]);
          }
        }
      );

      // Final update after everything is done
      setProgress(100);

    } catch (error) {
      console.error('Streaming query failed:', error);
      setLogs(prev => [...prev, `[ERROR] Streaming query failed: ${error}`]);
    } finally {
      setIsLoading(false);
    }
  }, [clearLogs, estimatedTotal, batchesProcessed]);

  return (
    <div className="space-y-8">
      {/* Main Card */}
      <Card className="p-6">
        <div className="mb-4">
          <h2 className="text-xl font-bold mb-2">HypeQuery Streaming Demo</h2>
          <p className="text-sm text-gray-500">
            Demonstrates real-time data loading with HypeQuery's streaming capabilities
          </p>
        </div>

        <div className="mb-4">
          <Button
            onClick={handleStreamQuery}
            disabled={isLoading}
            variant="default"
            className="w-full py-2"
          >
            {isLoading ? "Streaming Data..." : "Stream All Data"}
          </Button>
        </div>

        {/* Always show the results container, with progress inside if loading */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-md font-medium">Results</h3>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-1 text-xs bg-gray-100 rounded-full">
                {totalRows} rows
              </span>
              {isLoading && (
                <span className="text-xs text-blue-500">
                  Loading... {batchesProcessed} batches received
                </span>
              )}
            </div>
          </div>

          {/* Progress indicator at top of results when loading */}
          {isLoading && (
            <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-blue-600 transition-all duration-300 ease-in-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          <div className="border rounded-md p-2 h-[400px] overflow-auto">
            <div className="grid grid-cols-3 gap-2 text-xs font-medium border-b pb-1 mb-1 sticky top-0 bg-white">
              <div>Trip ID</div>
              <div>Distance</div>
              <div>Amount</div>
            </div>

            {results.length > 0 ? (
              results.slice(0, 1000).map((row, index) => (
                <div key={index} className="grid grid-cols-3 gap-2 text-xs border-b border-gray-100 py-1">
                  <div className="truncate">{row.trip_id}</div>
                  <div>{typeof row.trip_distance === 'number' ? row.trip_distance.toFixed(2) : 'N/A'}</div>
                  <div>${typeof row.total_amount === 'number' ? row.total_amount.toFixed(2) : 'N/A'}</div>
                </div>
              ))
            ) : (
              <div className="text-center text-gray-500 py-4">
                {isLoading ? 'Waiting for data...' : 'Click "Stream All Data" to see results'}
              </div>
            )}

            {results.length > 1000 && (
              <div className="text-xs text-center mt-2 text-gray-500">
                Showing 1,000 of {results.length} results
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Data is fetched from ClickHouse using HypeQuery's streaming capabilities.
            {isLoading && ' Loading all available data in real-time...'}
          </p>
        </div>
      </Card>

      {/* Logs Card */}
      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Query Logs</h2>
          <Button variant="outline" size="sm" onClick={clearLogs}>
            Clear Logs
          </Button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Direct logs from HypeQuery's query execution and streaming process
        </p>

        <div className="bg-gray-100 dark:bg-gray-900 p-4 rounded-md h-[300px] overflow-auto font-mono text-xs">
          {logs.length > 0 ? (
            logs.map((log, index) => (
              <div
                key={index}
                className={`py-1 ${log.includes('❌')
                  ? 'text-red-500'
                  : log.includes('✅')
                    ? 'text-green-500'
                    : log.includes('🔍')
                      ? 'text-blue-500'
                      : log.includes('📦')
                        ? 'text-yellow-500'
                        : ''
                  }`}
              >
                {log}
              </div>
            ))
          ) : (
            <p className="text-gray-500">Run a streaming query to see HypeQuery logs</p>
          )}
        </div>
      </Card>
    </div>
  );
};

export default StreamingDemo; 