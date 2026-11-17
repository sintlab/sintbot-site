import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../track.js',import.meta.url),'utf8');
function run({url='https://sintbot.com/',ref='',session=new Map(),disabled=false,blocked=false,now=10000000}={}){
 const calls=[],listeners={};
 const storage={getItem:k=>{if(blocked)throw Error('blocked');return session.get(k)||null},setItem:(k,v)=>{if(blocked)throw Error('blocked');session.set(k,v)},removeItem:k=>{if(blocked)throw Error('blocked');session.delete(k)}};
 class Element {closest(selector){return selector==='a[href]'?this:null}getAttribute(){return 'https://github.com/sintlab/sintbot-desktop/releases/latest/download/SintBot_0.1.2_aarch64.dmg'}matches(){return false}}
 const clock={now:()=>now};const context={URL,URLSearchParams,Element,Date:clock,location:new URL(url),sessionStorage:storage,localStorage:{getItem:()=>disabled?'1':null},window:{umami:{track:(name,data)=>calls.push({name,data})}},document:{documentElement:{lang:'en'},referrer:ref,visibilityState:'visible',getElementById:()=>null,addEventListener:(k,f)=>listeners[k]=f,querySelectorAll:()=>[]},setTimeout:()=>1,setInterval:()=>1,clearInterval:()=>{},addEventListener:()=>{}};
 vm.runInNewContext(script,context);
 return {calls,session,download:()=>listeners.click?.({target:new Element()}),advance:ms=>{now+=ms}};
}
test('ChatGPT UTM landing attributes a later page download without retaining query text',()=>{
 const a=run({url:'https://sintbot.com/?utm_source=chatgpt.com&private=do-not-store'});assert.equal(a.calls[0].name,'gpt-referral');assert.equal(a.calls[0].data.source_via,'utm');assert.ok(![...a.session.values()].join('').includes('private'));
 const b=run({url:'https://sintbot.com/guide/install/',ref:'https://sintbot.com/',session:a.session});assert.equal(b.calls.length,0);b.download();assert.equal(b.calls[0].name,'download-dmg');assert.equal(b.calls[0].data.source,'chatgpt');
});
test('ChatGPT referrer, UTM aliases and mixed case are recognized',()=>{for(const ref of ['https://chatgpt.com/c/private','https://chat.openai.com/','https://www.chatgpt.com/'])assert.equal(run({ref}).calls[0].data.source_via,'referrer');for(const utm of ['ChatGPT','CHATGPT.COM','chat.openai.com'])assert.equal(run({url:'https://sintbot.com/?utm_source='+utm}).calls[0].data.source,'chatgpt')});
test('lookalikes and arbitrary source values are not accepted',()=>{for(const ref of ['https://chatgpt.com.evil.test/','https://fakechatgpt.com/'])assert.equal(run({ref}).calls.length,0);assert.equal(run({url:'https://sintbot.com/?utm_source=chatgpt.com.evil.test'}).calls.length,0)});
test('an explicit different campaign or external referral clears prior attribution',()=>{for(const options of [{url:'https://sintbot.com/?utm_source=newsletter'},{ref:'https://google.com/'}]){const a=run({ref:'https://chatgpt.com/'});const b=run({...options,session:a.session});b.download();assert.equal(b.calls[0].data.source,undefined);assert.equal(b.session.size,0)}});
test('attribution expires during a page and across navigation',()=>{const a=run({ref:'https://chatgpt.com/'});a.advance(1800000);a.download();assert.equal(a.calls.at(-1).data.source,undefined);const b=run({session:a.session,now:11800000});b.download();assert.equal(b.calls[0].data.source,undefined);assert.equal(b.session.size,0)});
test('opt-out records nothing and clears attribution',()=>{for(const opts of [{disabled:true},{url:'https://sintbot.com/?notrack=1&utm_source=chatgpt.com'}]){const a=run({ref:'https://chatgpt.com/'});const b=run({...opts,session:a.session});b.download();assert.equal(b.calls.length,0);assert.equal(b.session.size,0)}});
test('storage rejection still permits attribution on the landing page',()=>{const a=run({url:'https://sintbot.com/?utm_source=chatgpt.com',blocked:true});a.download();assert.equal(a.calls[1].data.source,'chatgpt')});
test('ordinary direct visits have no GPT source and retain existing events',()=>{const a=run();a.download();assert.equal(a.calls.length,1);assert.equal(a.calls[0].name,'download-dmg');assert.equal(a.calls[0].data.source,undefined)});
