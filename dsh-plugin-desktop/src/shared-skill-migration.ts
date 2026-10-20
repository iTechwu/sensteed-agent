/** Knowledge owns this export evidence; Hub consumes it only over authenticated internal HTTP. */
import { z } from 'zod';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const SharedSkillMigrationPinSchema = z.strictObject({ name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), version: z.number().int().positive(), sha256: digest });
export const SharedSkillMigrationSourceSchema = SharedSkillMigrationPinSchema.extend({
  kind: z.literal('knowledge-shared-skill'), origin: z.literal('https://knowledge.hozonauto.com/api'), sourceId: z.uuid(), knowledgeTenantId: z.uuid(), publisherSsoSub: z.uuid(), byteSize: z.number().int().positive().max(10 * 1024 * 1024), readerScope: z.strictObject({ kind: z.literal('tenant'), ssoTenantId: z.uuid() }), exportedAt: z.iso.datetime(), authorization: z.literal('publisher-snapshot-v1'),
});
export const SharedSkillMigrationExportRequestSchema = SharedSkillMigrationPinSchema.extend({ ssoTenantId: z.uuid(), ssoActorId: z.uuid() });
export const SharedSkillMigrationExportSchema = z.strictObject({ source: SharedSkillMigrationSourceSchema, description: z.string().min(1).max(1000), archiveBase64: z.string().min(4).max(14 * 1024 * 1024) });
export type SharedSkillMigrationSource = z.infer<typeof SharedSkillMigrationSourceSchema>;
export type SharedSkillMigrationExportRequest = z.infer<typeof SharedSkillMigrationExportRequestSchema>;
