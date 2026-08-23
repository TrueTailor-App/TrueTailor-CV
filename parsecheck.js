const fs=require('fs'), vm=require('vm'), re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const s=fs.readFileSync(process.argv[2],'utf8');
let n=0, bad=0;
for(const m of s.matchAll(re)){
  if(/\bsrc\s*=/i.test(m[1])) continue;
  n++;
  try{ new vm.Script(m[2]); }catch(e){ bad++; console.log('PARSE FAIL block '+n+': '+e.message); }
}
console.log(bad? bad+' block(s) failed' : n+' inline block(s) parse OK');
process.exitCode = bad?1:0;
