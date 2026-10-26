import { isAbsolute, normalize, relative, resolve } from "node:path";

export function assertPathContainedUnderCwd(filePath: string, cwd: string): string {
  const base = resolve(cwd);
  const target = resolve(base, filePath);
  const rel = relative(base, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes working directory: ${filePath}`);
  }
  return normalize(target);
}
