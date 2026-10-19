import { CURRENT_EDIT_STACK_VERSION, type EditStack } from './types';
import { validateEditStack } from './validate';

export class EditStackError extends Error {
  constructor(
    message: string,
    readonly details: string[] = []
  ) {
    super(details.length ? `${message}: ${details.join('; ')}` : message);
    this.name = 'EditStackError';
  }
}

type Migration = (stack: Record<string, unknown>) => Record<string, unknown>;

/**
 * migrations[n] upgrades a version-n stack to version n + 1.
 * Add one entry per format change; never edit an existing entry once released.
 */
const migrations: Record<number, Migration> = {};

/**
 * Turns any saved stack (any released version, or a JSON string of one) into a valid stack of the
 * current version. Throws EditStackError for stacks from a newer library version or invalid data.
 */
export function migrateEditStack(input: unknown): EditStack {
  let data = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new EditStackError('edit stack is not valid JSON');
    }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new EditStackError('edit stack must be an object');
  }

  let stack = { ...(data as Record<string, unknown>) };
  let version = stack.version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new EditStackError(`invalid version ${String(version)}`);
  }
  if ((version as number) > CURRENT_EDIT_STACK_VERSION) {
    throw new EditStackError(
      `edit stack version ${version} is newer than this library supports (${CURRENT_EDIT_STACK_VERSION}); update expo-photo-engine`
    );
  }
  while ((version as number) < CURRENT_EDIT_STACK_VERSION) {
    const migrate = migrations[version as number];
    if (!migrate) throw new EditStackError(`no migration from version ${version}`);
    stack = migrate(stack);
    version = stack.version;
  }

  const result = validateEditStack(stack);
  if (!result.ok) throw new EditStackError('invalid edit stack', result.errors);
  return result.value;
}

/** Serializes a stack to compact JSON with a stable key order. */
export function serializeEditStack(stack: EditStack): string {
  return JSON.stringify(stack, sortedKeys);
}

function sortedKeys(_key: string, value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, (value as Record<string, unknown>)[k]])
  );
}
