const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('Bad Request'); return; }
  const rel = pathname.replace(/^\/+/, '');
  let target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep) && target !== root) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(target).toLowerCase();
    const headers = {'Content-Type': types[ext] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
    if (ext === '.html') headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    fs.createReadStream(target).pipe(res);
  } catch { res.writeHead(500); res.end('Internal Server Error'); }
}).listen(port, '0.0.0.0', () => console.log(`LOOPAY site running on ${port}`));
