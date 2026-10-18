import { expect,it } from 'vitest'
import { gzipSync } from 'node:zlib'
import { readHubPluginArchive } from '../src/hub-plugin-archive.ts'
function archive(path:string,type='0',body=Buffer.from('payload')){
 const header=Buffer.alloc(512);header.write(path);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116)
 header.write(body.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156)
 header.write(type,156);header.write('ustar\0',257);header.write('00',263)
 const checksum=header.reduce((sum,b)=>sum+b,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148)
 return gzipSync(Buffer.concat([header,body,Buffer.alloc((512-body.length%512)%512),Buffer.alloc(1024)]))
}
it('reads regular ustar package bytes without extraction',()=>{
 expect(readHubPluginArchive(archive('package/index.js')).get('index.js')?.toString()).toBe('payload')
})
it.each(['package/../escape','/outside','package/a.node','package/CON.txt'])('rejects unsafe portable path %s',path=>{
 expect(()=>readHubPluginArchive(archive(path))).toThrow()
})
it('rejects links and unsupported tar extension types',()=>{
 for(const type of ['1','2','x','g'])expect(()=>readHubPluginArchive(archive('package/link',type))).toThrow('UNSUPPORTED')
})
