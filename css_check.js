/* Proves the change was visual only.

   The claim "CSS only" is easy to make and easy to get wrong, so it is checked
   rather than asserted: the script, the markup and every element id must be
   byte identical to the version before the theme, and the only difference in
   the whole file must lie inside <style>. */
const fs = require('fs');
const a = fs.readFileSync(process.argv[2], 'utf8');
const b = fs.readFileSync(process.argv[3], 'utf8');
let bad = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x ? '  -> ' + x : '')); if (!c) bad++; };

/* The version string is normalised out of both sides. Bumping it is expected
   and has nothing to do with the theme, and leaving it in would make this check
   fail for the one reason it is not meant to detect. Everything else in the
   script and the markup still has to match byte for byte. */
const unversion = s => s.replace(/v38\.\d+/g, 'vX');
const scripts = s => unversion([...s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/\bsrc=/i.test(m[1])).map(m => m[2]).join('\n'));
const styles = s => [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
const markup = s => unversion(s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '<style/>')
                     .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script/>'));

ok('the script is byte identical', scripts(a) === scripts(b),
   scripts(a).length + ' vs ' + scripts(b).length + ' chars');
ok('the markup is byte identical', markup(a) === markup(b));
const ids = s => [...s.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).sort().join(',');
ok('every element id is unchanged', ids(a) === ids(b));
ok('the stylesheet did change', styles(a) !== styles(b),
   (styles(b).length - styles(a).length) + ' chars added');
console.log(bad ? '\nRESULT: ' + bad + ' FAILED' : '\nRESULT: visual only, confirmed');
process.exitCode = bad ? 1 : 0;
