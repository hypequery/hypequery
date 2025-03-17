'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';

// Dynamically load the streaming demo component
const StreamingDemo = dynamic(
  () => import('@/components/streaming-demo'),
  {
    ssr: false,
    loading: () => <p className="text-center p-4">Loading demo component...</p>
  }
);

export default function StreamingPage() {
  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">HypeQuery Streaming Demo</h1>
        <p className="text-gray-500">
          This page demonstrates HypeQuery's streaming capabilities for handling
          large result sets efficiently with real-time data loading.
        </p>
      </div>

      <Suspense fallback={<p className="text-center p-4">Loading...</p>}>
        <StreamingDemo />
      </Suspense>
    </div>
  );
} 