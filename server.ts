/**
 * TeaRoom (Private Chatroom) - Development Server Runner
 * @author Exe01jb (https://github.com/Exe01jb)
 * @license MIT
 */
import { createServer } from './backend/server.js';
import { createServer as createViteServer } from 'vite';

async function start() {
  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.HOST || '0.0.0.0';

  const { app, listen } = createServer({
    NODE_ENV: 'development',
    HOST,
    PORT,
    CLIENT_ORIGIN: '',
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  await listen(PORT, HOST);
  console.log(`Private Chatroom server running on http://${HOST}:${PORT}`);
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
