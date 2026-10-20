/** Signed requirements describe dependencies, never credentials or MCP authorization. */
import { z } from 'zod';
const id = '[a-z][a-z0-9.-]{0,79}';
const part = '[a-z][a-z0-9_-]{0,79}';
const version =
  '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?';
export const HubHostCapabilitySchema = z
  .string()
  .max(260)
  .regex(new RegExp(`^(?:${id}|${id}@${version}|mcp\\.endpoint:${part}/${part}@${version})$`));
const range = z
  .string()
  .min(1)
  .max(120)
  .regex(new RegExp(`^(?:\\*|(?:[~^]|[<>]=?|=)?${version}(?: +(?:[<>]=?|=)?${version})*)$`));
export const HubEndpointRefSchema = z.strictObject({
  service: z.string().regex(new RegExp(`^${part}$`)),
  domain: z.string().regex(new RegExp(`^${part}$`)),
});
export const HubRequirementsSchema = z
  .strictObject({
    schemaVersion: z.literal('sensteed-requirements-v1'),
    host: z
      .array(
        z.strictObject({
          capabilityId: z.string().regex(new RegExp(`^${id}$`)),
          versionRange: range,
          required: z.boolean(),
        }),
      )
      .max(64),
    content: z
      .array(
        z.discriminatedUnion('kind', [
          z.strictObject({
            kind: z.literal('skill'),
            identity: z
              .string()
              .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
              .refine((v) => !v.startsWith('user-local-')),
            versionRange: range,
            required: z.boolean(),
          }),
          z.strictObject({
            kind: z.literal('plugin'),
            identity: z
              .string()
              .max(214)
              .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/),
            versionRange: range,
            required: z.boolean(),
          }),
        ]),
      )
      .max(64),
    mcp: z
      .array(z.strictObject({ endpointRef: HubEndpointRefSchema, required: z.boolean() }))
      .max(64),
  })
  .superRefine((value, ctx) => {
    const groups = {
      host: value.host.map((r) => r.capabilityId),
      content: value.content.map((r) => `${r.kind}:${r.identity}`),
      mcp: value.mcp.map((r) => `${r.endpointRef.service}/${r.endpointRef.domain}`),
    };
    for (const [key, values] of Object.entries(groups))
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', path: [key], message: 'Duplicate requirement identity' });
  });
export type HubRequirements = z.infer<typeof HubRequirementsSchema>;
