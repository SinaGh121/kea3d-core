export const KEA3D_PROJECT_SCHEMA = 'https://kea3d.com/schemas/project/v1.json';
export const KEA3D_PROJECT_MAX_BYTES = 2 * 1024 * 1024;
export const KEA3D_PROJECT_MAX_RESOURCES = 1_024;
export const KEA3D_PROJECT_MAX_INSTANCES = 10_000;

const idPattern = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

export interface Kea3dProjectResource {
  id: string;
  uri: string;
  [key: string]: unknown;
}

export interface Kea3dProjectAttachment {
  sourceAnchor: string;
  targetInstance: string;
  targetAnchor: string;
  [key: string]: unknown;
}

export interface Kea3dProjectInstance {
  id: string;
  resource: string;
  attachment?: Kea3dProjectAttachment;
  [key: string]: unknown;
}

export interface Kea3dProjectDocument {
  $schema: typeof KEA3D_PROJECT_SCHEMA;
  format: 'kea3d-project';
  version: 1;
  name: string;
  rootInstance: string;
  resources: Kea3dProjectResource[];
  instances: Kea3dProjectInstance[];
  [key: string]: unknown;
}

function fail(message: string): never {
  throw new Error(`Invalid Kea3D project: ${message}`);
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string.`);
  if (value.length > maximumLength) fail(`${label} exceeds ${maximumLength} characters.`);
  if (Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  })) fail(`${label} contains a control character.`);
  return value;
}

function projectId(value: unknown, label: string): string {
  const id = boundedString(value, label, 128);
  if (!idPattern.test(id)) fail(`${label} must start with a letter and contain only letters, numbers, period, underscore, or hyphen.`);
  return id;
}

export function normalizeProjectResourceUri(value: unknown, label = 'Resource URI'): string {
  const uri = boundedString(value, label, 1_024);
  if (uri.includes('\\')) fail(`${label} must use forward slashes.`);
  if (uri.startsWith('/') || uri.startsWith('//') || /^[A-Za-z]:/.test(uri)) fail(`${label} must be project-relative.`);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri) || uri.includes('?') || uri.includes('#') || uri.includes('%')) fail(`${label} cannot contain a URI scheme, escape, query, or fragment.`);
  const segments = uri.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) fail(`${label} contains an unsafe path segment.`);
  if (segments.some((segment) => !/^[A-Za-z0-9 _.,+@()'&-]+$/.test(segment))) fail(`${label} contains an unsupported path character.`);
  if (!uri.toLowerCase().endsWith('.glb')) fail(`${label} must reference a GLB file in version 1.`);
  return uri;
}

function parseResources(value: unknown): Kea3dProjectResource[] {
  if (!Array.isArray(value) || value.length === 0) fail('resources must contain at least one resource.');
  if (value.length > KEA3D_PROJECT_MAX_RESOURCES) fail(`resources exceeds the limit of ${KEA3D_PROJECT_MAX_RESOURCES}.`);
  const ids = new Set<string>();
  const paths = new Set<string>();
  return value.map((entry, index) => {
    const record = objectRecord(entry, `resources[${index}]`);
    const id = projectId(record.id, `resources[${index}].id`);
    if (ids.has(id)) fail(`resource ID "${id}" is duplicated.`);
    ids.add(id);
    const uri = normalizeProjectResourceUri(record.uri, `resources[${index}].uri`);
    const canonicalPath = uri.toLowerCase();
    if (paths.has(canonicalPath)) fail(`resource path "${uri}" collides with another resource path.`);
    paths.add(canonicalPath);
    return { ...record, id, uri } as Kea3dProjectResource;
  });
}

function parseAttachment(value: unknown, index: number): Kea3dProjectAttachment {
  const record = objectRecord(value, `instances[${index}].attachment`);
  return {
    ...record,
    sourceAnchor: projectId(record.sourceAnchor, `instances[${index}].attachment.sourceAnchor`),
    targetInstance: projectId(record.targetInstance, `instances[${index}].attachment.targetInstance`),
    targetAnchor: projectId(record.targetAnchor, `instances[${index}].attachment.targetAnchor`),
  } as Kea3dProjectAttachment;
}

function parseInstances(value: unknown): Kea3dProjectInstance[] {
  if (!Array.isArray(value) || value.length === 0) fail('instances must contain at least one instance.');
  if (value.length > KEA3D_PROJECT_MAX_INSTANCES) fail(`instances exceeds the limit of ${KEA3D_PROJECT_MAX_INSTANCES}.`);
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const record = objectRecord(entry, `instances[${index}]`);
    const id = projectId(record.id, `instances[${index}].id`);
    if (ids.has(id)) fail(`instance ID "${id}" is duplicated.`);
    ids.add(id);
    const resource = projectId(record.resource, `instances[${index}].resource`);
    const attachment = record.attachment === undefined ? undefined : parseAttachment(record.attachment, index);
    return { ...record, id, resource, ...(attachment ? { attachment } : {}) } as Kea3dProjectInstance;
  });
}

function validateGraph(document: Kea3dProjectDocument): void {
  const resourceIds = new Set(document.resources.map((resource) => resource.id));
  const instanceById = new Map(document.instances.map((instance) => [instance.id, instance]));
  const root = instanceById.get(document.rootInstance);
  if (!root) fail(`rootInstance "${document.rootInstance}" does not exist.`);
  if (root.attachment) fail('the root instance cannot have an attachment.');

  for (const instance of document.instances) {
    if (!resourceIds.has(instance.resource)) fail(`instance "${instance.id}" references missing resource "${instance.resource}".`);
    if (instance.id !== document.rootInstance && !instance.attachment) fail(`non-root instance "${instance.id}" must have an attachment.`);
    if (!instance.attachment) continue;
    if (!instanceById.has(instance.attachment.targetInstance)) fail(`instance "${instance.id}" targets missing instance "${instance.attachment.targetInstance}".`);
    if (instance.attachment.targetInstance === instance.id) fail(`instance "${instance.id}" cannot attach to itself.`);
  }

  for (const instance of document.instances) {
    const visited = new Set<string>();
    let current: Kea3dProjectInstance | undefined = instance;
    while (current.id !== document.rootInstance) {
      if (visited.has(current.id)) fail(`attachment cycle detected at instance "${current.id}".`);
      visited.add(current.id);
      const targetId: string | undefined = current.attachment?.targetInstance;
      current = targetId ? instanceById.get(targetId) : undefined;
      if (!current) fail(`instance "${instance.id}" is not reachable from rootInstance "${document.rootInstance}".`);
    }
  }
}

export function parseKea3dProjectJson(json: string): Kea3dProjectDocument {
  if (new TextEncoder().encode(json).byteLength > KEA3D_PROJECT_MAX_BYTES) fail(`document exceeds ${KEA3D_PROJECT_MAX_BYTES} bytes.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail('document is not valid JSON.');
  }
  const record = objectRecord(parsed, 'document');
  if (record.$schema !== KEA3D_PROJECT_SCHEMA) fail(`$schema must be "${KEA3D_PROJECT_SCHEMA}".`);
  if (record.format !== 'kea3d-project') fail('format must be "kea3d-project".');
  if (record.version !== 1) fail('only version 1 is supported.');
  const document: Kea3dProjectDocument = {
    ...record,
    $schema: KEA3D_PROJECT_SCHEMA,
    format: 'kea3d-project',
    version: 1,
    name: boundedString(record.name, 'name', 256),
    rootInstance: projectId(record.rootInstance, 'rootInstance'),
    resources: parseResources(record.resources),
    instances: parseInstances(record.instances),
  } as Kea3dProjectDocument;
  validateGraph(document);
  return document;
}

export function decodeKea3dProject(buffer: ArrayBuffer): Kea3dProjectDocument {
  if (buffer.byteLength > KEA3D_PROJECT_MAX_BYTES) fail(`document exceeds ${KEA3D_PROJECT_MAX_BYTES} bytes.`);
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    fail('document must be valid UTF-8.');
  }
  return parseKea3dProjectJson(json.replace(/^\uFEFF/, ''));
}

export function rootProjectResource(document: Kea3dProjectDocument): Kea3dProjectResource {
  const root = document.instances.find((instance) => instance.id === document.rootInstance);
  const resource = root && document.resources.find((entry) => entry.id === root.resource);
  if (!resource) fail('the root resource could not be resolved.');
  return resource;
}

function normalizedSelectedPath(file: File): string {
  return (file.webkitRelativePath || file.name).replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
}

export function resolveProjectResourceFile(
  project: Kea3dProjectDocument,
  projectFile: File,
  files: readonly File[],
): File {
  const resource = rootProjectResource(project);
  return resolveResourceFile(resource, projectFile, files);
}

function resolveResourceFile(
  resource: Kea3dProjectResource,
  projectFile: File,
  files: readonly File[],
): File {
  const projectPath = normalizedSelectedPath(projectFile);
  const slash = projectPath.lastIndexOf('/');
  const projectDirectory = slash >= 0 ? projectPath.slice(0, slash + 1) : '';
  const expectedPath = `${projectDirectory}${resource.uri.toLowerCase()}`;
  const exact = files.find((file) => file !== projectFile && normalizedSelectedPath(file) === expectedPath);
  if (exact) return exact;

  const shortName = resource.uri.split('/').pop()?.toLowerCase();
  const basenameMatches = files.filter((file) => file !== projectFile && file.name.toLowerCase() === shortName);
  if (basenameMatches.length === 1) return basenameMatches[0];
  if (basenameMatches.length > 1) throw new Error(`Project resource "${resource.uri}" is ambiguous. Select the project folder so Kea3D can match its relative path.`);
  throw new Error(`Project resource "${resource.uri}" is missing. Choose the .kea3d project and its referenced GLB together.`);
}

export function resolveProjectResourceFiles(
  project: Kea3dProjectDocument,
  projectFile: File,
  files: readonly File[],
): Map<string, File> {
  const referencedResourceIds = new Set(project.instances.map((instance) => instance.resource));
  return new Map(project.resources
    .filter((resource) => referencedResourceIds.has(resource.id))
    .map((resource) => [resource.id, resolveResourceFile(resource, projectFile, files)]));
}
