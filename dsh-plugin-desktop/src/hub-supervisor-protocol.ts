/** Private Host-to-supervisor channel. No renderer may invoke this service directly. */
import{z}from'zod'
import type{Context}from'@deepseek-ai/cordis'
const identity=z.strictObject({origin:z.literal('https://ai.hozonauto.com/plugins/api'),tenantId:z.uuid(),actorRef:z.string().min(1).max(128),deviceId:z.uuid(),profileId:z.uuid()})
export const HubSupervisorRequestSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('base')}),
 z.strictObject({kind:z.literal('activate'),identity,operationId:z.uuid()}),
 z.strictObject({kind:z.literal('managed'),identity,generationDigest:z.string().regex(/^[a-f0-9]{64}$/u),lease:z.unknown()}),
])
export type HubSupervisorRequest=z.infer<typeof HubSupervisorRequestSchema>
export interface HubGenerationSupervisor{request(input:HubSupervisorRequest):Promise<void>;waitRendererHealthy(generationId:string):Promise<void>}
export function provideHubSupervisor(ctx:Context,request:HubGenerationSupervisor['request'],waitRendererHealthy:HubGenerationSupervisor['waitRendererHealthy']=async()=>{throw new Error('Launcher renderer health unavailable')}){ctx.provide('hubGenerationSupervisor',{request,waitRendererHealthy})}
declare module'@deepseek-ai/cordis'{interface Context{hubGenerationSupervisor:HubGenerationSupervisor}}
