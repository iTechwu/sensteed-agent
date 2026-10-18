/** L0-owned strict wire mirrors; no application/Hub runtime dependency. Keep in sync with contracts. */
import { z } from 'zod'
import { HubReleaseSignatureSchema } from './hub-sync-verifier.ts'
const HubDigestSchema=z.string().regex(/^[a-f0-9]{64}$/u)
const AccessDeclarationSchema=z.strictObject({containsScripts:z.boolean(),networkHosts:z.array(z.string().max(253)).max(50),fileAccess:z.enum(['none','user-selected','workspace','system']), localPreview: z.strictObject({ scope: z.enum(['loopback', 'private-lan']), protocols: z.array(z.enum(['http', 'https'])).min(1).max(2).refine(values => new Set(values).size === values.length) }).optional()})
const CompatibilitySchema=z.strictObject({sensteed:z.string().min(1).max(120),testedTargets:z.array(z.string().max(120)).max(50)})
export const PLUGIN_LIMITS = Object.freeze({
  compressed: 52428800,
  expanded: 209715200,
  files: 5000,
  lock: 2097152,
  nodes: 500,
  edges: 5000,
  closureCompressed: 209715200,
  closureExpanded: 838860800,
  closureFiles: 20000,
  deadlineMs: 600000,
  closureFetchBytes: 220200960,
});
export const PluginPackageNameSchema = z
  .string()
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/)
  .max(214);
export const PluginExactVersionSchema = z
  .string()
  .max(120)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/,
  );
export const PluginSriSchema = z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/);
export const PluginFileSchema = z.strictObject({
  path: z.string().min(1).max(500),
  bytes: z.number().int().nonnegative(),
  sha256: HubDigestSchema,
});
export const PluginDeclarationSchema = z.strictObject({
  accessDeclaration: AccessDeclarationSchema,
  compatibility: CompatibilitySchema.extend({ testedTargets: z.array(z.never()).max(0) }),
});
export const PluginTargetSchema = z.strictObject({
  os: z.enum(['darwin', 'win32', 'linux']),
  cpu: z.enum(['arm64', 'x64']),
  libc: z.enum(['glibc', 'musl']).nullable(),
  nodeVersion: PluginExactVersionSchema,
  sensteedVersion: PluginExactVersionSchema,
  cordisVersion: PluginExactVersionSchema,
  harnessVersion: PluginExactVersionSchema,
});
export const PluginClosureInputSchema = z.strictObject({
  format: z.literal('npm-package-lock-v3'),
  contentBase64: z.string().min(4).max(2796204),
  sha256: HubDigestSchema,
  registryId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  target: PluginTargetSchema,
  declaration: PluginDeclarationSchema,
});
export const PluginCapabilitySchema = z.union([
  z.string().min(1).max(120),
  z
    .record(z.string(), z.unknown())
    .refine(
      (v) => typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 120,
      'capability requires id',
    ),
]);
export const PluginPackageInspectionSchema = z.strictObject({
  name: PluginPackageNameSchema,
  version: PluginExactVersionSchema,
  sha256: HubDigestSchema,
  sri: PluginSriSchema,
  bytes: z.number().int().positive().max(PLUGIN_LIMITS.compressed),
  expandedBytes: z.number().int().nonnegative().max(PLUGIN_LIMITS.expanded),
  files: z.array(PluginFileSchema).max(PLUGIN_LIMITS.files),
  fileManifestDigest: HubDigestSchema,
  packageJson: z.record(z.string(), z.unknown()),
  hostEntry: z.string().nullable(),
  clientEntry: z.string().nullable(),
  bundlePatch: z.string().nullable(),
  capabilities: z.array(PluginCapabilitySchema).max(100),
  capabilityIds: z.array(z.string()).max(100),
});
export const PluginLockNodeSchema = z.strictObject({
  nodeId: z.string().max(1000),
  name: PluginPackageNameSchema,
  version: PluginExactVersionSchema,
  sha256: HubDigestSchema,
  sri: PluginSriSchema,
  bytes: z.number().int().positive().max(PLUGIN_LIMITS.compressed),
  fileManifestDigest: HubDigestSchema,
  origin: z.enum(['upload', 'approved-registry']),
  registryId: z.string(),
  engines: z.record(z.string(), z.string()),
  os: z.array(z.string()),
  cpu: z.array(z.string()),
  libc: z.array(z.string()),
  peerContext: z.record(z.string(), z.string()),
  hostProvided: z.literal(false),
  lockedResolved: z.url().nullable(),
});
export const PluginLockGraphSchema = z.strictObject({
  schemaVersion: z.literal('plugin-lock-v1'),
  rootNodeId: z.literal(''),
  sourceLockDigest: HubDigestSchema,
  target: PluginTargetSchema,
  nodes: z.array(PluginLockNodeSchema).min(1).max(PLUGIN_LIMITS.nodes),
  edges: z
    .array(
      z.strictObject({
        from: z.string(),
        name: PluginPackageNameSchema,
        requested: z.string().min(1),
        kind: z.enum(['prod', 'peer']),
        peerOptional: z.boolean(),
        to: z.string(),
        selection: z.literal('included'),
        reason: z.null(),
      }),
    )
    .max(PLUGIN_LIMITS.edges),
  hostRequirements: z.array(z.never()).max(0),
});
export const PluginArtifactIndexEntrySchema = z.strictObject({
  nodeId: z.string(),
  artifactRef: z.uuid(),
  contentPath: z
    .string()
    .regex(/^\/plugins\/api\/skillhub\/v1\/plugins\/artifacts\/[0-9a-f-]{36}\/content$/),
  sha256: HubDigestSchema,
  sri: PluginSriSchema,
  bytes: z.number().int().positive(),
  fileManifestDigest: HubDigestSchema,
});
export const PluginManifestV2Schema = z.strictObject({
  sourceLockGraphDigest: HubDigestSchema,
  packSetDigest: HubDigestSchema,
  schemaVersion: z.literal('2.0'),
  kind: z.literal('plugin'),
  tenantId: z.uuid(),
  pluginId: z.uuid(),
  releaseId: z.uuid(),
  npmPackageName: PluginPackageNameSchema,
  exactVersion: PluginExactVersionSchema,
  frozenInputDigest: HubDigestSchema,
  reviewDigest: HubDigestSchema,
  tarballDigest: HubDigestSchema,
  sri: PluginSriSchema,
  lockGraphDigest: HubDigestSchema,
  graph: PluginLockGraphSchema,
  artifacts: z.array(PluginArtifactIndexEntrySchema).min(1).max(PLUGIN_LIMITS.nodes),
  root: PluginPackageInspectionSchema.omit({ packageJson: true }),
  accessDeclaration: AccessDeclarationSchema,
  compatibility: CompatibilitySchema,
  issuedAt: z.iso.datetime(),
});
export const SkillManifestSchema = z.strictObject({
  schemaVersion: z.literal('1.1'),
  fileManifestDigest: HubDigestSchema,
  tenantId: z.uuid(),
  skillId: z.uuid(),
  releaseId: z.uuid(),
  kind: z.literal('skill'),
  installName: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  version: PluginExactVersionSchema,
  artifact: z.strictObject({
    sha256: HubDigestSchema,
    bytes: z.number().int().nonnegative(),
    format: z.literal('zip'),
  }),
  compatibility: CompatibilitySchema.extend({ testedTargets: z.array(z.never()).max(0) }).strict(),
  accessDeclaration: AccessDeclarationSchema.strict(),
  source: z
    .object({
      kind: z.enum(['upload', 'git']),
      repositoryId: z.string().optional(),
      commit: z.string().optional(),
      path: z.string().optional(),
    })
    .optional(),
  issuedAt: z.iso.datetime(),
});
export const HubGenerationDownloadsSchema = z.strictObject({
  manifests: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('skill'),
          itemId: z.uuid(),
          envelope: z.strictObject({manifest:SkillManifestSchema,signature:HubReleaseSignatureSchema}),
        }),
        z.strictObject({
          kind: z.literal('plugin'),
          itemId: z.uuid(),
          envelope: z.strictObject({
            manifest: PluginManifestV2Schema,
            signature: HubReleaseSignatureSchema,
          }),
        }),
      ]),
    )
    .max(256),
  descriptors: z
    .array(
      z.strictObject({
        downloadId: z.uuid(),
        kind: z.enum(['skill', 'plugin']),
        itemId: z.uuid(),
        nodeId: z.string().max(1000).nullable(),
        artifactDigest: HubDigestSchema,
        bytes: z.number().int().nonnegative(),
        contentType: z.enum(['application/zip', 'application/gzip', 'application/octet-stream']),
        role: z.enum(['primary', 'dependency']),
      }),
    )
    .max(10000),
});
