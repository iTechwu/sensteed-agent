/** Serial supervisor ownership: an old Host must be confirmed stopped before pointer or process replacement. */
export interface HubHostLifetime { readonly fiber: { dispose(): void | Promise<void> } }
export class HubHostSupervisor{
 private host:HubHostLifetime|undefined
 private tail=Promise.resolve()
 private stopped=false
 bind(host:HubHostLifetime):void{if(this.stopped||this.host)throw new Error('Hub supervisor already owns a Host');this.host=host}
 async replace(mutate:()=>Promise<void>,start:(bind:(host:HubHostLifetime)=>void)=>Promise<void>):Promise<void>{
  const task=this.tail.then(async()=>{
   if(this.stopped)throw new Error('Hub supervisor is stopped')
   const old=this.host
   if(old){await old.fiber.dispose();this.host=undefined}
   if(this.stopped)throw new Error('Hub supervisor is stopped')
   // Failure to stop leaves the original Host owned; mutation never ran.
   await mutate()
   if(this.stopped)throw new Error('Hub supervisor is stopped')
   try{await start(host=>this.bind(host))}catch(cause){await this.host?.fiber.dispose();this.host=undefined;throw cause}
  })
  this.tail=task.catch(()=>{});return await task
 }
 async dispose():Promise<void>{this.stopped=true;await this.tail;await this.host?.fiber.dispose();this.host=undefined}
}
