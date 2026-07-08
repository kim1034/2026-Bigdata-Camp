import path from 'path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createBackendApp } from './app';
import { env } from './config/env';

export async function startServer() {
  const app = createBackendApp();

  if (env.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite development middleware attached.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('Serving static files from dist/ folder.');
  }

  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`[Hotplace Backend] Running on http://localhost:${env.port}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[Hotplace Backend] ${env.port} 포트가 이미 사용 중입니다.`);
      console.error('이미 켜진 dev 서버를 닫거나 .env에서 PORT=3001처럼 다른 포트를 지정해 주세요.');
      process.exit(1);
    }
    throw error;
  });
}
