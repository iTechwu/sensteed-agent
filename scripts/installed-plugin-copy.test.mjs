import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { syncInstalledPlugin } from './installed-plugin-copy.mjs'

test('detects stale installed client code, then refreshes runtime files without replacing installed dependencies', () => {
  const root = mkdtempSync(resolve(tmpdir(),'sensteed-installed-plugin-'))
  try {
    const source=resolve(root,'source'), installed=resolve(root,'installed')
    mkdirSync(resolve(source,'lib'),{recursive:true});mkdirSync(resolve(installed,'lib'),{recursive:true});mkdirSync(resolve(installed,'node_modules'),{recursive:true})
    writeFileSync(resolve(source,'lib/client.js'),'new navigation');writeFileSync(resolve(installed,'lib/client.js'),'old navigation')
    writeFileSync(resolve(installed,'node_modules/keep'),'dependency')
    writeFileSync(resolve(source,'.env'),'private-not-a-runtime-file')
    mkdirSync(resolve(source,'test')); writeFileSync(resolve(source,'test/fixture.js'),'development-only')
    assert.throws(()=>syncInstalledPlugin(source,installed,{verifyOnly:true}),/lib\/client.js/)
    assert.equal(readFileSync(resolve(installed,'lib/client.js'),'utf8'),'old navigation')
    assert.equal(syncInstalledPlugin(source,installed),1)
    assert.throws(()=>readFileSync(resolve(installed,'.env')),/ENOENT/)
    assert.throws(()=>readFileSync(resolve(installed,'test/fixture.js')),/ENOENT/)
    assert.equal(readFileSync(resolve(installed,'lib/client.js'),'utf8'),'new navigation')
    assert.equal(readFileSync(resolve(installed,'node_modules/keep'),'utf8'),'dependency')
    assert.equal(syncInstalledPlugin(source,installed,{verifyOnly:true}),1)
  } finally {rmSync(root,{recursive:true,force:true})}
})
