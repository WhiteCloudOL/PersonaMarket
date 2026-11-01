import { readFileSync } from 'node:fs';
import { SystemRuntimeResponseSchema, type SystemRuntimeResponse } from '@personamarket/contracts';

const unavailable: SystemRuntimeResponse['data']['build'] = {
  version: null,
  sourceRevision: null,
  sourceDirty: null,
  builtAt: null,
  status: 'unavailable',
};

export function parseApiBuildRecord(input: unknown): SystemRuntimeResponse {
  const candidate = SystemRuntimeResponseSchema.shape.data.shape.build.safeParse(input);
  const build =
    candidate.success &&
    (candidate.data.status === 'available'
      ? candidate.data.version !== null &&
        candidate.data.sourceRevision !== null &&
        candidate.data.sourceDirty !== null &&
        candidate.data.builtAt !== null
      : candidate.data.version === null &&
        candidate.data.sourceRevision === null &&
        candidate.data.sourceDirty === null &&
        candidate.data.builtAt === null)
      ? candidate.data
      : unavailable;
  return SystemRuntimeResponseSchema.parse({
    data: { component: 'api', build, nodeVersion: process.versions.node },
  });
}

function readProcessBuildSnapshot(): SystemRuntimeResponse {
  try {
    return parseApiBuildRecord(
      JSON.parse(readFileSync(new URL('./build-info.json', import.meta.url), 'utf8')),
    );
  } catch {
    return parseApiBuildRecord(null);
  }
}

// An in-place local rebuild must not relabel code already loaded by this process.
const processBuildSnapshot = readProcessBuildSnapshot();

export async function readApiBuildInfo(): Promise<SystemRuntimeResponse> {
  return SystemRuntimeResponseSchema.parse(processBuildSnapshot);
}
