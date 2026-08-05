import type { Role } from '../config/roles.js';
import { isToolAllowedForRole } from '../config/roles.js';

export class ForbiddenToolError extends Error {
  constructor(role: Role, toolName: string) {
    super(`Role '${role}' is not permitted to invoke tool '${toolName}'.`);
    this.name = 'ForbiddenToolError';
  }
}

/** Throws ForbiddenToolError if `role` may not invoke `toolName`. */
export function assertToolPermission(role: Role, toolName: string): void {
  if (!isToolAllowedForRole(role, toolName)) {
    throw new ForbiddenToolError(role, toolName);
  }
}
