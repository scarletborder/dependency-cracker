import path from "path";

export function initPathsMapping(projectBaseDir: string, pathsMapping: Record<string, string>):
  Map<string, string> {
  const ret = new Map<string, string>();
  for (const [alias, relPath] of Object.entries(pathsMapping)) {
    const absPath = path.resolve(projectBaseDir, relPath);
    ret.set(alias, absPath);
  }
  return ret;
}