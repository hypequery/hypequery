import { DefinitionReachDiagram } from './DefinitionReachDiagram';
import { FeatureCard, FeatureCardCopy } from './FeatureCard';

export function DefinitionReachCard() {
  return (
    <FeatureCard number="02" animationDelay={70} className="sm:col-span-2 lg:row-span-2">
      <div className="mt-7"><FeatureCardCopy title="One definition powers every surface." description="Your data model in code reachable from any consumer." /></div>
      <div className="mt-7 min-h-[220px] w-full flex-1 overflow-hidden">
        <DefinitionReachDiagram />
      </div>
    </FeatureCard>
  );
}
