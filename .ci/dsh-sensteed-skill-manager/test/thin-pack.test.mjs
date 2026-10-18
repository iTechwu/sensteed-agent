import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { apply } from '../thin/index.js'
test('thin published original has no installer, credentials, trust keys or runtime dependencies',()=>{
 const root=new URL('../',import.meta.url),pkg=JSON.parse(readFileSync(new URL('package.json',root),'utf8')),scratch=mkdtempSync(join(tmpdir(),'thin-skill-pack-'))
 try{
  assert.equal(pkg.main,'./thin/index.js');assert.equal(pkg.exports['.'],pkg.main);assert.deepEqual(pkg.dependencies??{},{});assert.equal(apply(),undefined)
  const result=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',scratch],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0]
  assert.deepEqual(result.files.map(f=>f.path).filter(p=>!/^package.json$|^README/iu.test(p)).sort(),['cordis.patch.yml','thin/client.js','thin/index.js'])
  const source=readFileSync(new URL('thin/client.js',root),'utf8');assert.doesNotMatch(source,/fetch\(|hub-client|installer|trusted-release|MODELS_API_KEY|https?:/u);assert.match(source,/settings\.section/u)
  assert(gunzipSync(readFileSync(join(scratch,result.filename))).length>0)
 }finally{rmSync(scratch,{recursive:true,force:true})}
})
