import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProtocolDeploymentError } from '../deployments/errors.js';
import { validateProtocolDeploymentContractAnyVersion } from '../deployments/validate.js';
import {
  DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS,
  checkProtocolDeploymentTargetAcceptance,
  deploymentContract3Features,
  validateProtocolDeploymentTargetAccepts,
} from './index.js';

const DRAFTS = new URL('../../../../specs/security-protocol/drafts/target-acceptance-v1/', import.meta.url);
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DRAFTS), 'utf8')) as T;

const accepts = read<{
  accepted: { id: string; value?: unknown; expected: unknown }[];
  rejected: { id: string; value: unknown; code: string; path: string }[];
}>('accepts.json');
const features = read<{ id: string; contract: unknown; expected: unknown }[]>('contract-3-features.json');

describe('target accepts advertisement (RFC 0030 draft vectors)', () => {
  it.each(accepts.accepted)('parses $id', ({ value, expected }) => {
    const parsed = validateProtocolDeploymentTargetAccepts(value);
    expect(parsed).toEqual(expected);
    expect(Object.isFrozen(parsed) && Object.isFrozen(parsed.deploymentContract)).toBe(true);
  });

  it.each(accepts.rejected)('rejects $id', ({ value, code, path }) => {
    const error = (() => {
      try { validateProtocolDeploymentTargetAccepts(value); } catch (caught) { return caught; }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ProtocolDeploymentError);
    expect([(error as ProtocolDeploymentError).code, (error as ProtocolDeploymentError).path]).toEqual([code, path]);
  });

  it('refuses accessors and exotic prototypes without running them', () => {
    let ran = false;
    const getter = Object.defineProperty({}, 'deploymentContract', { get: () => { ran = true; return [2]; }, enumerable: true });
    expect(() => validateProtocolDeploymentTargetAccepts(getter)).toThrow('HQ_DEPLOYMENT_UNSAFE_OBJECT at $.deploymentContract');
    expect(ran).toBe(false);
    expect(() => validateProtocolDeploymentTargetAccepts(new (class { deploymentContract = [2]; })()))
      .toThrow('HQ_DEPLOYMENT_UNSAFE_OBJECT at $');
    const holey = [2];
    holey.length = 2;
    expect(() => validateProtocolDeploymentTargetAccepts({ deploymentContract: holey }))
      .toThrow('HQ_DEPLOYMENT_UNSAFE_OBJECT at $.deploymentContract[1]');
    expect(() => validateProtocolDeploymentTargetAccepts({ bundle: Array.from({ length: 65 }, (_, i) => i + 1) }))
      .toThrow('HQ_DEPLOYMENT_INVALID_VALUE at $.bundle');
  });
});

describe('contract 3 feature registry (RFC 0030 draft vectors)', () => {
  it.each(features)('$id', ({ contract, expected }) => {
    const validated = validateProtocolDeploymentContractAnyVersion(contract);
    expect(deploymentContract3Features(validated)).toEqual(expected);
    // The lowest-version rule: contract 3 exactly when a dataset forces it.
    expect(validated.version).toBe((expected as unknown[]).length > 0 ? 3 : 2);
  });
});

describe('checkProtocolDeploymentTargetAcceptance', () => {
  const contract3 = validateProtocolDeploymentContractAnyVersion(
    features.find(entry => entry.id === 'every-feature-in-registry-order')!.contract,
  );
  const contract2 = validateProtocolDeploymentContractAnyVersion(
    features.find(entry => entry.id === 'contract-2-derived-measures')!.contract,
  );

  it('accepts what the target advertises', () => {
    const accepts = validateProtocolDeploymentTargetAccepts({ deploymentContract: [2, 3] });
    expect(checkProtocolDeploymentTargetAcceptance({ contract: contract3, bundleVersion: 2, accepts })).toEqual([]);
    expect(checkProtocolDeploymentTargetAcceptance({ contract: contract2, accepts: DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS })).toEqual([]);
  });

  it('refuses contract 3 under the default, naming each forcing dataset and feature', () => {
    expect(checkProtocolDeploymentTargetAcceptance({
      contract: contract3, bundleVersion: 1, accepts: DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS,
    })).toEqual([{
      kind: 'deploymentContract', version: 3, accepted: [2],
      forcedBy: [{ dataset: 'orders', features: ['segments', 'windowMeasures', 'shiftMeasures', 'approxCountDistinct', 'subDayDefaultGrain', 'alternateTimeFields'] }],
    }]);
  });

  it('refuses a contract 2 deployment at a contract 3 only target, with nothing to blame', () => {
    const accepts = validateProtocolDeploymentTargetAccepts({ deploymentContract: [3] });
    expect(checkProtocolDeploymentTargetAcceptance({ contract: contract2, accepts }))
      .toEqual([{ kind: 'deploymentContract', version: 2, accepted: [3], forcedBy: [] }]);
  });

  it('refuses a bundle version the target does not take, after the contract', () => {
    const accepts = validateProtocolDeploymentTargetAccepts({ bundle: [1] });
    expect(checkProtocolDeploymentTargetAcceptance({ contract: contract3, bundleVersion: 2, accepts }).map(refusal => refusal.kind))
      .toEqual(['deploymentContract', 'bundle']);
    expect(checkProtocolDeploymentTargetAcceptance({ contract: contract2, bundleVersion: 2, accepts }))
      .toEqual([{ kind: 'bundle', version: 2, accepted: [1] }]);
  });
});
