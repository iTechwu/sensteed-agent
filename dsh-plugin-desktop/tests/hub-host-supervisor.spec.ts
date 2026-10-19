import{expect,it}from'vitest'
import{HubHostSupervisor}from'../src/hub-host-supervisor.ts'
it('never mutates or starts a replacement until old Host disposal succeeds',async()=>{
 const s=new HubHostSupervisor(),order:string[]=[];let release!:()=>void
 s.bind({fiber:{dispose:async()=>{order.push('stop');await new Promise<void>(r=>{release=r})}}})
 const replacing=s.replace(async()=>{order.push('activate')},async bind=>{order.push('start');bind({fiber:{dispose:async()=>{order.push('stop-new')}}})})
 await Promise.resolve();expect(order).toEqual(['stop']);release();await replacing
 expect(order).toEqual(['stop','activate','start']);await s.dispose();expect(order.at(-1)).toBe('stop-new')
})
it('fails closed on an unconfirmed old Host stop',async()=>{
 const s=new HubHostSupervisor();s.bind({fiber:{dispose:async()=>{throw new Error('not stopped')}}})
 let mutated=false
 await expect(s.replace(async()=>{mutated=true},async()=>{})).rejects.toThrow('not stopped');expect(mutated).toBe(false)
})
