/** Download exactly the artifact selected by Models; never resolve latest a second time. */
import {createHash,randomUUID} from 'node:crypto'
import {lstat,open,rename,unlink} from 'node:fs/promises'
import {dirname,extname,isAbsolute} from 'node:path'
import {BRAND_UPDATE_SERVICE} from './generated-product-identity.ts'
import {DesktopV2ArtifactSchema,type DesktopV2Artifact} from './desktop-update-v2.ts'
import {assertSecureDownloadUrl,type UpdateArtifactRequest} from './update-download.ts'
export async function downloadDesktopV2Artifact(input:{artifact:DesktopV2Artifact;destinationPath:string;request:UpdateArtifactRequest;signal:AbortSignal}):Promise<string>{
 const artifact=DesktopV2ArtifactSchema.parse(input.artifact),destination=input.destinationPath
 if(artifact.downloadPath!==`/api/desktop/v2/artifacts/${artifact.id}/download`)throw Error('Artifact identity mismatch')
 if(!isAbsolute(destination)||destination.includes('\0')||extname(destination).toLowerCase()!=='.'+artifact.format)throw Error('Invalid update destination')
 const parent=await lstat(dirname(destination));if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('Invalid update directory')
 try{const current=await lstat(destination);if(current.isSymbolicLink()||!current.isFile()||current.nlink!==1)throw Error('Invalid update destination')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 input.signal.throwIfAborted()
 const {response,finalUrl}=await input.request(new URL(artifact.downloadPath,BRAND_UPDATE_SERVICE.endpoint).href,{method:'GET',cache:'no-store',redirect:'follow',signal:input.signal,headers:{Accept:'application/octet-stream'}})
 assertSecureDownloadUrl(finalUrl)
 if(response.status!==200||!response.body){await response.body?.cancel();throw Error('Artifact download unavailable')}
 const stated=response.headers.get('content-length')
 if(stated!==null&&(!/^[0-9]+$/u.test(stated)||Number(stated)!==artifact.bytes)){await response.body.cancel();throw Error('Artifact length mismatch')}
 const temporary=`${destination}.${randomUUID()}.partial`,file=await open(temporary,'wx',0o600),reader=response.body.getReader(),hash=createHash('sha256')
 let bytes=0,first=Buffer.alloc(0),tail=Buffer.alloc(0)
 try{
  while(true){input.signal.throwIfAborted();const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>artifact.bytes)throw Error('Artifact length exceeded');hash.update(item.value);let offset=0;while(offset<item.value.length){const write=await file.write(item.value,offset,item.value.length-offset);if(write.bytesWritten===0)throw Error('Artifact write stalled');offset+=write.bytesWritten}if(first.length<64)first=Buffer.concat([first,Buffer.from(item.value)]).subarray(0,64);tail=Buffer.concat([tail,Buffer.from(item.value)]).subarray(-512)}
  if(bytes!==artifact.bytes||hash.digest('hex')!==artifact.sha256)throw Error('Artifact integrity mismatch')
  const valid=artifact.format==='dmg'?tail.length===512&&tail.subarray(0,4).toString()==='koly':artifact.format==='exe'?first.subarray(0,2).toString()==='MZ':artifact.format==='zip'?first.subarray(0,4).equals(Buffer.from([80,75,3,4])):artifact.format==='appimage'?first.subarray(0,4).equals(Buffer.from([127,69,76,70])):first.subarray(0,8).toString()==='!<arch>\n'
  if(!valid)throw Error('Artifact format mismatch')
  input.signal.throwIfAborted();await file.sync();await file.close();await rename(temporary,destination);return destination
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();await file.close().catch(()=>{});await unlink(temporary).catch(()=>{})}
}
