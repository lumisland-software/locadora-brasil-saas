import app from './index.js';
import { handleAbmIngest } from './abm-ingest.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/integrations/abm/ingest') {
      return handleAbmIngest(request, env);
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === 'function') {
      return app.scheduled(controller, env, ctx);
    }
  }
};
