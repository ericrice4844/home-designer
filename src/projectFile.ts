import { normalizeProject, ProjectError, type Project } from './model';

export interface ProjectFile {
  project: Project;
  /** asset id → data: URL */
  assets: Record<string, string>;
}

const MAX_FILE = 200 * 1024 * 1024;

/** Parse an exported .home.json file. Throws ProjectError with user-readable problems. */
export function parseProjectFile(text: string): ProjectFile {
  if (text.length > MAX_FILE) throw new ProjectError(['the file is larger than 200 MB']);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProjectError(['the file is not valid JSON (it may be damaged or not a project export)']);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new ProjectError(['the file does not contain a project object']);
  const raw = json.app === 'home-design-studio' || json.project ? json.project : json;
  const project = normalizeProject(raw);
  const assets: Record<string, string> = {};
  const problems: string[] = [];
  if (json.assets !== undefined) {
    if (typeof json.assets !== 'object' || json.assets === null || Array.isArray(json.assets)) problems.push('"assets" must be an object');
    else
      for (const [id, url] of Object.entries(json.assets)) {
        if (typeof url !== 'string' || !/^data:[\w.+-]+\/[\w.+-]+(;[\w=.+-]+)*;base64,/.test(url)) problems.push(`asset "${id.slice(0, 40)}" is not an embedded file`);
        else assets[id] = url;
      }
  }
  if (problems.length) throw new ProjectError(problems);
  return { project, assets };
}
