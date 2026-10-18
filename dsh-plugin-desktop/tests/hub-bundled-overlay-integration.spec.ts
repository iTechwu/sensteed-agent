import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('boots one exact Host and resolves Client, icon and static assets from its generation', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { createHash } from 'node:crypto';
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const [{HubGenerationStore,HUB_GENERATION_ORIGIN},{hubGenerationBootReference},{prepareHubHostBoot},{installProfilePackageResolver},{DesktopPluginPackages},{boot}]=await Promise.all(process.argv.slice(1).map(path=>import(pathToFileURL(path).href)));
    const root=realpathSync(mkdtempSync(join(tmpdir(),'hub-real-overlay-'))), logical=join(root,'logical');
    let ctx,release;
    try {
      mkdirSync(logical,{mode:0o700});writeFileSync(join(logical,'package.json'),'{}',{mode:0o600});writeFileSync(join(logical,'root.yml'),'[]',{mode:0o600});
      const identity={origin:HUB_GENERATION_ORIGIN,tenantId:'11111111-1111-4111-8111-111111111111',actorRef:'actor',deviceId:'22222222-2222-4222-8222-222222222222',profileId:'33333333-3333-4333-8333-333333333333'};
      const store=new HubGenerationStore(root,identity),gen=store.generationDirectory('exact'),name='@dofe/dsh-sensteed-finance',prefix='profile/node_modules/'+name;
      mkdirSync(join(gen,prefix),{recursive:true,mode:0o700});mkdirSync(join(gen,'skills'),{mode:0o700});
      const payload={
        'package.json':JSON.stringify({name,version:'0.0.1',type:'module',exports:{'.':'./host.js','./client':'./client.js'},icon:'icon.svg'}),
        'host.js':'export default function(ctx){globalThis.exactHostCount=(globalThis.exactHostCount??0)+1;ctx.effect(()=>()=>{globalThis.exactHostCount--})}',
        'client.js':'export const version="exact";export const asset=new URL("./static.txt",import.meta.url)',
        'static.txt':'exact static', 'icon.svg':'exact icon'
      }, files={};
      for(const [path,body]of Object.entries(payload)){writeFileSync(join(gen,prefix,path),body,{mode:0o600});files[prefix+'/'+path]=createHash('sha256').update(body).digest('hex')}
      await store.prepare({schemaVersion:2,identity,generationId:'exact',packages:[{name,manifest:prefix+'/package.json',releaseId:'r',payloadDigest:'a'.repeat(64)}],skillsRoot:'skills',files,verifiedComposition:{entries:[{id:'exact-host',packageName:name,config:{}}],skills:[]}});await store.activate();
      const base=[{insert:[{id:'bundled-host',name},{id:'bundled-client',name:name+'/client'}]}];
      const selected=prepareHubHostBoot({reference:hubGenerationBootReference(store,logical),expectedIdentity:identity,skillProviderName:'hub-exact'},logical,base);
      const baseUrl=pathToFileURL(join(logical,'package.json')).href;
      release=installProfilePackageResolver(baseUrl,selected.selection,true);
      ctx=await boot('overlay-integration',join(logical,'root.yml'),selected.patches,async ctx=>{ctx.loader.internal=undefined;await ctx.plugin(DesktopPluginPackages)},baseUrl);
      assert.equal(globalThis.exactHostCount,1);
      assert.deepEqual([...ctx.loader.entries()].filter(e=>e.options.name.startsWith(name)).map(e=>e.options.id),['exact-host']);
      const selectedPackage=ctx.pluginPackages.packageOf(name,baseUrl);
      assert.equal(selectedPackage.dir,join(gen,prefix));
      const client=await import(pathToFileURL(createRequire(baseUrl).resolve(name+'/client')).href);
      assert.equal(client.version,'exact');assert.equal(readFileSync(client.asset,'utf8'),'exact static');
      assert.equal(readFileSync(join(selectedPackage.dir,selectedPackage.manifest.icon),'utf8'),'exact icon');
      assert.deepEqual(selected.compose(base),selected.patches);
      await ctx.fiber.dispose();ctx=undefined;assert.equal(globalThis.exactHostCount,0);
      console.log('exact Host/Client/resources passed');
    } finally {await ctx?.fiber.dispose();release?.();rmSync(root,{recursive:true,force:true})}
  `
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script,
    ...['hub-generation-store.ts', 'hub-generation-boot.ts', 'hub-host-boot.ts', 'module-resolution.ts', 'plugin-packages.ts'].map(name => fileURLToPath(new URL(`../src/${name}`, import.meta.url))),
    fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-app-boot')),
  ], { encoding: 'utf8', timeout: 30_000 })
  expect(output).toContain('exact Host/Client/resources passed')
})
