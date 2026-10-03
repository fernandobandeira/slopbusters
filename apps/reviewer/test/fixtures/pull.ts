import { createTwoFilesPatch } from 'diff'
import { parseFile, detectTransfers } from '../../shared/diff'
import { Priority, type ChangedFile, type PullRequest } from '../../shared/types'

const slug = `export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}`
const audit = `  const auditEntry = {
    action: 'project.updated',
    actorId: viewer.id,
    resourceId: project.id,
    occurredAt: new Date().toISOString(),
  }
  await auditLog.record(auditEntry)`

export function fixturePull(): PullRequest {
  const files = [
    fixtureFile(
      'src/access/permissions.ts',
      `import type { Member, Project } from '../types'

export function canEditProject(member: Member, project: Project) {
  return member.organizationId === project.organizationId
}
`,
      `import type { Member, Project } from '../types'

export function canEditProject(member: Member, project: Project) {
  const belongsToOrganization = member.organizationId === project.organizationId
  const hasEditorRole = member.role === 'admin' || member.role === 'editor'

  return belongsToOrganization && hasEditorRole
}
`,
    ),
    fixtureFile(
      'src/routes/projects.ts',
      `import { canEditProject } from '../access/permissions'
import { slugify } from '../lib/utils'

export async function updateProject(request: UpdateProjectRequest) {
  const { viewer, project } = await loadProjectContext(request)
  const updates = request.body

  return projectStore.update(project.id, updates)
}

export async function getProject(request: GetProjectRequest) {
  const context = await loadProjectContext(request)
  return context.project
}

export async function listProjects(request: ListProjectsRequest) {
  const context = await loadOrganizationContext(request)
  return projectStore.findMany(context.organization.id)
}

export function projectSlug(name: string) {
  return slugify(name)
}
`,
      `import { canEditProject } from '../access/permissions'
import { slugify } from '../lib/slug'

export async function updateProject(request: UpdateProjectRequest) {
  const { viewer, project } = await loadProjectContext(request)
  if (!canEditProject(viewer, project)) {
    throw new ForbiddenError('An editor role is required to update this project.')
  }
  const updates = request.body

${audit}
  return projectStore.update(project.id, updates)
}

export async function getProject(request: GetProjectRequest) {
  const context = await loadProjectContext(request)
  return context.project
}

export async function listProjects(request: ListProjectsRequest) {
  const context = await loadOrganizationContext(request)
  return projectStore.findMany(context.organization.id)
}

export function projectSlug(name: string) {
  return slugify(name)
}
`,
    ),
    fixtureFile(
      'test/projects.test.ts',
      `import { canEditProject } from '../src/access/permissions'

describe('project permissions', () => {
  it('allows members in the same organization', () => {
    expect(canEditProject(member, project)).toBe(true)
  })
})
`,
      `import { canEditProject } from '../src/access/permissions'

describe('project permissions', () => {
  it('allows editors in the same organization', () => {
    expect(canEditProject({ ...member, role: 'editor' }, project)).toBe(true)
  })

  it('rejects members with a viewer role', () => {
    expect(canEditProject({ ...member, role: 'viewer' }, project)).toBe(false)
  })

  it('rejects editors from another organization', () => {
    const outsider = { ...member, role: 'editor', organizationId: 'other' }
    expect(canEditProject(outsider, project)).toBe(false)
  })
})
`,
    ),
    fixtureFile(
      'src/lib/utils.ts',
      `${slug}

export function initials(name: string) {
  return name.split(' ').map(part => part[0]).join('')
}
`,
      `export function initials(name: string) {
  return name.split(' ').map(part => part[0]).join('')
}
`,
    ),
    fixtureFile('src/lib/slug.ts', '', `${slug}\n`),
    fixtureFile(
      'src/lib/audit.ts',
      `export async function auditProjectUpdate(viewer: Viewer, project: Project) {
${audit}
}
`,
      `export async function auditProjectUpdate(viewer: Viewer, project: Project) {
${audit}
  return auditEntry
}
`,
    ),
    fixtureFile(
      'docs/roles.md',
      '# Organization roles\n\nMembers can update projects in their organization.\n',
      '# Organization roles\n\nAdmins and editors can update projects in their organization.\nViewers have read access.\n',
    ),
  ]
  const group = (
    id: string,
    title: string,
    priority: Priority,
    reason: string,
    paths: string[],
  ) => {
    const selected = files.filter((file) => paths.includes(file.path))
    return {
      id,
      title,
      priority,
      reason,
      fileIds: selected.map((file) => file.id),
      hunkIds: selected.flatMap((file) => file.hunks.map((hunk) => hunk.id)),
    }
  }
  return {
    id: 'fixture-project-permissions',
    owner: 'review-room',
    repo: 'example',
    number: 128,
    url: 'https://github.com/review-room/example/pull/128',
    title: 'Require editor permissions for project updates',
    description:
      'Tighten project edit permissions, add an audit entry, and extract the shared slug helper. This fixture covers permission checks and exact text transfers.',
    author: 'alexchen',
    baseBranch: 'main',
    headBranch: 'feat/project-permissions',
    baseSha: '2e43c989d4731054ba46e4fc32a497819f4e918a',
    headSha: 'a7f239d1455c4b310117e6c3479820bce60829cd',
    state: 'open',
    files,
    transfers: detectTransfers(files),
    groupingSource: 'files',
    warnings: [],
    groups: [
      group(
        'permissions',
        'Enforce project edit permissions',
        Priority.high,
        'Authorization changes affect who can update a project. Check cross-organization access and the viewer role.',
        ['src/access/permissions.ts', 'src/routes/projects.ts', 'test/projects.test.ts'],
      ),
      group(
        'audit',
        'Record project updates in the audit log',
        Priority.normal,
        'Check which update attempts produce an audit event.',
        ['src/lib/audit.ts'],
      ),
      group(
        'slug',
        'Extract the shared slug helper',
        Priority.low,
        'The helper is moved without changes. Its imports still need to resolve.',
        ['src/lib/utils.ts', 'src/lib/slug.ts'],
      ),
      group(
        'docs',
        'Document organization roles',
        Priority.low,
        'Documentation should match the permission rule.',
        ['docs/roles.md'],
      ),
    ],
  }
}

function fixtureFile(path: string, before: string, after: string): ChangedFile {
  const raw = createTwoFilesPatch(path, path, before, after, undefined, undefined, { context: 3 })
  const patch = raw.slice(raw.indexOf('@@')).replace(/\n$/, '')
  const additions = patch.split('\n').filter((line) => line.startsWith('+')).length
  const deletions = patch.split('\n').filter((line) => line.startsWith('-')).length
  return parseFile({
    path,
    status: before ? 'modified' : 'added',
    additions,
    deletions,
    patch,
    oldContent: before,
  })
}
