'use client';

import { SiDjango, SiExpress, SiFastapi, SiFastify, SiFlask, SiHono, SiNestjs, SiNextdotjs, SiNodedotjs, SiPython, SiTypescript } from 'react-icons/si';
import { AgentFeatureCard } from './AgentFeatureCard';
import { CloudFeatureCards } from './CloudFeatureCards';
import { DefinitionReachCard } from './DefinitionReachCard';
import { FeatureCard, FeatureCardCopy } from './FeatureCard';
import { ProductAnalyticsCard } from './ProductAnalyticsCard';
import { TenantFeatureCard } from './TenantFeatureCard';

const FRAMEWORKS = [
  ['Node.js', SiNodedotjs, 'text-[#339933]'],
  ['Hono', SiHono, 'text-[#ff5b3d]'],
  ['Express', SiExpress, 'text-text'],
  ['Fastify', SiFastify, 'text-[#111111]'],
  ['NestJS', SiNestjs, 'text-[#e0234e]'],
  ['FastAPI', SiFastapi, 'text-[#009688]'],
  ['Django', SiDjango, 'text-[#092e20]'],
  ['Flask', SiFlask, 'text-text'],
  ['Next.js', SiNextdotjs, 'text-text'],
] as const;

export function FeatureGrid() {
  return (
    <section aria-label="More capabilities" className="mx-auto max-w-[1280px] px-5 pb-8 pt-8 sm:px-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[252px_252px] lg:auto-rows-[minmax(150px,auto)]">
        <FeatureCard
          number="01"
          animationDelay={0}
          className="relative sm:col-span-2"
          topRight={<div className="framework-logo-cluster flex items-center pl-2" aria-label="Supported languages"><span title="TypeScript" data-tooltip="TypeScript" aria-label="TypeScript" className="logo-tooltip framework-logo inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-bg-alt bg-bg-card"><SiTypescript className="h-4 w-4 text-[#3178c6]" aria-hidden="true" /></span><span title="Python" data-tooltip="Python" aria-label="Python" className="logo-tooltip framework-logo inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-bg-alt bg-bg-card"><SiPython className="h-4 w-4 text-[#3776ab]" aria-hidden="true" /></span></div>}
        >
          <div className="mt-7 max-w-[500px]"><FeatureCardCopy title="Analytics which runs where your app runs" description="Or deploy to hypequery Cloud." /></div>
          <div className="framework-logo-cluster mt-7 flex items-center pl-3" aria-label="Supported frameworks">
            {FRAMEWORKS.map(([name, Icon, color]) => <span key={name} title={name} data-tooltip={name} aria-label={name} className="logo-tooltip framework-logo inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-bg-card bg-bg-card shadow-card"><Icon className={`h-5 w-5 ${color}`} aria-hidden="true" /></span>)}
          </div>
        </FeatureCard>
        <DefinitionReachCard />
        <AgentFeatureCard />
        <TenantFeatureCard />
        <CloudFeatureCards />
        <ProductAnalyticsCard />
      </div>
    </section>
  );
}
