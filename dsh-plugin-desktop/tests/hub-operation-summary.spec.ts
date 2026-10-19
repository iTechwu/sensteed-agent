import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { HubExecutionJournal } from '../src/hub-execution-journal.ts'
import { HubGenerationStore } from '../src/hub-generation-store.ts'
import { hubOperationSummary } from '../src/hub-generation-manager.ts'
const roots:string[]=[]
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
it('projects the durable failure reason and receipt outbox state for the renderer',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'hub-summary-')));roots.push(root)
 const store=new HubGenerationStore(root,{origin:'https://ai.hozonauto.com/plugins/api',tenantId:randomUUID(),actorRef:'user',deviceId:randomUUID(),profileId:randomUUID()})
 vi.spyOn(HubExecutionJournal.prototype,'read').mockReturnValue({operationId:randomUUID(),phase:'NEEDS_ATTENTION',receiptSeq:4,pendingReceipt:{phase:'ROLLED_BACK',seq:4,errorCode:'HUB_BOOT_FAILED'}} as never)
 expect(hubOperationSummary(store)).toMatchObject({phase:'NEEDS_ATTENTION',state:'NEEDS_ATTENTION',errorCode:'HUB_BOOT_FAILED',outboxState:'pending',receiptSeq:4,pendingReceipt:{phase:'ROLLED_BACK',seq:4,errorCode:'HUB_BOOT_FAILED'}})
})
