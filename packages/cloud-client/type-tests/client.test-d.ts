import {
  createCloudClient,
  type CloudApiError,
  type CloudErrorCode,
  type DraftsDeleteInput,
  type ProjectsListOutput,
} from '../src/index.js';

const cloud = createCloudClient({ token: 'hqmt_v1_x' });

// Operations with no required input can be called bare; outputs are typed.
const listed: Promise<ProjectsListOutput> = cloud.projects.list();
void listed;
void cloud.call('projects.list');

// Required input is required.
// @ts-expect-error project is required
void cloud.projects.get();
// @ts-expect-error project is required
void cloud.call('projects.get', {});
void cloud.projects.get({ project: 'shop' }).then((project) => {
  const live: boolean = project.live;
  const revision: string | null = project.currentRevision;
  void live;
  void revision;
});

// Destructive operations need confirm: true.
// @ts-expect-error confirm is required
void cloud.drafts.delete({ project: 'shop', draft: 'id' });
// @ts-expect-error confirm must be literally true
void cloud.drafts.delete({ project: 'shop', draft: 'id', confirm: false });
void cloud.drafts.delete({ project: 'shop', draft: 'id', confirm: true });
const input: DraftsDeleteInput = { project: 'shop', draft: 'id', confirm: true };
void cloud.call('drafts.delete', input);

// Non-destructive operations don't take confirm.
// @ts-expect-error confirm is not an input of projects.get
void cloud.projects.get({ project: 'shop', confirm: true });

// Enums stay literal.
// @ts-expect-error range is "1h" | "24h" | "7d"
void cloud.logs.query({ project: 'shop', range: '2h' });

// Unknown operations are rejected.
// @ts-expect-error not an operation
void cloud.call('projects.explode');

// Error codes autocomplete but stay open.
const code: CloudErrorCode = 'CONFIRMATION_REQUIRED';
declare const error: CloudApiError;
const known: boolean = error.code === code || error.code === 'NETWORK_ERROR' || error.code === 'SOMETHING_NEWER';
void known;
