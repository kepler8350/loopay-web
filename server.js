import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
        next();
        });

        // 정적 파일 서빙
        app.use(express.static('public'));
        app.use(express.static(__dirname));

        // API 라우트
        app.get('/api/health', (req, res) => {
          res.json({ 
              status: 'ok',
                  message: 'LOOPAY Server is running!',
                      timestamp: new Date().toISOString()
                        });
                        });

                        // SPA 폴백
                        app.get('*', (req, res) => {
                          res.sendFile(path.join(__dirname, 'index.html'));
                          });

                          app.listen(PORT, () => {
                            console.log(`✅ LOOPAY Web Server started on port ${PORT}`);
                              console.log(`🚀 Open http://localhost:${PORT} in your browser`);
                              });
