// Extract Lucide icon nodes (name, node tree) to a plain TS module, so the landing bundle needs no React.
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const [dir, out] = process.argv.slice(2);
const names = ['ghost', 'cat', 'bot', 'heart', 'star', 'message-circle', 'sun', 'house'];
const data = {};
for (const n of names) {
  const m = await import(pathToFileURL(dir + '/' + n + '.mjs').href);
  data[n] = (m.__iconData.node || []).map(([tag, attrs]) => {
    const { key, ...rest } = attrs; return [tag, rest];
  });
}
writeFileSync(out, '// Lucide icon nodes (ISC), extracted from lucide-react 1.73.0.\nexport const iconNodes: Record<string, [string, Record<string, string>][]> = ' + JSON.stringify(data, null, 1) + ';\n');
console.log(Object.entries(data).map(([k, v]) => k + ':' + v.length).join(' '));
