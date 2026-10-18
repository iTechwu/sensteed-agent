import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtemp,writeFile,readFile,rm,open} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
const next=createRequire(new URL('../dsh-desktop-next/package.json',import.meta.url))
const extract=next('extract-zip'),zip=next('fflate').zipSync
const slicer=createRequire(createRequire(next.resolve('extract-zip')).resolve('yauzl'))('fd-slicer')
function bytes(){const b=Buffer.alloc(1024*1024);let s=26;for(let i=0;i<b.length;i++){s^=s<<13;s^=s>>>17;s^=s<<5;b[i]=s&255}return b}
for(const level of [0,6])test(`installed ZIP stream emits every byte and finishes (compression ${level})`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'fd-slicer-zip-'));try{const expected=bytes(),archive=join(root,'archive.zip');await writeFile(archive,zip({'large.bin':expected},{level}));await extract(archive,{dir:root});assert.equal(createHash('sha256').update(await readFile(join(root,'large.bin'))).digest('hex'),createHash('sha256').update(expected).digest('hex'))}finally{await rm(root,{recursive:true,force:true})}
})
test('truncated ZIP rejects instead of claiming complete extraction',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fd-slicer-bad-'));try{const archive=join(root,'archive.zip'),data=zip({'large.bin':bytes()},{level:6});await writeFile(archive,data.subarray(0,data.length-30));await assert.rejects(extract(archive,{dir:root}))}finally{await rm(root,{recursive:true,force:true})}
})
test('early stream destruction emits one error, releases its descriptor and remains idempotent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fd-slicer-close-'));try{const path=join(root,'input');await writeFile(path,bytes());const handle=await open(path,'r'),context=slicer.createFromFd(handle.fd,{autoClose:false}),stream=context.createReadStream({start:0,end:1024*1024});let errors=0;stream.on('error',()=>errors++);stream.destroy(new Error('intentional cancellation'));stream.destroy(new Error('repeat'));assert.equal(errors,1);assert.equal(stream.destroyed,true);assert.equal(context.refCount,0);await handle.close()}finally{await rm(root,{recursive:true,force:true})}
})
test('read failure emits the actual error once and releases its descriptor reference',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fd-slicer-error-'));try{const path=join(root,'input');await writeFile(path,'source');const handle=await open(path,'r'),context=slicer.createFromFd(handle.fd,{autoClose:false}),stream=context.createReadStream({start:0,end:6});await handle.close();const error=await new Promise(resolve=>{stream.once('error',resolve);stream.resume()});assert.equal(error.code,'EBADF');assert.equal(context.refCount,0);assert.equal(stream.destroyed,true);stream.destroy()}finally{await rm(root,{recursive:true,force:true})}
})
