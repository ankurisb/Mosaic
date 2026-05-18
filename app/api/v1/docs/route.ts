import { getSession } from '@/lib/auth'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return new Response('Unauthorized', { status: 401 })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mosaic API Docs</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css" />
  <style>
    body { margin: 0; background: #fff; }
    .swagger-ui .topbar { background: #0f0f0f; padding: 8px 20px; }
    .swagger-ui .topbar .topbar-wrapper .link { display: none; }
    .swagger-ui .topbar .topbar-wrapper::before {
      content: 'Mosaic Developer API';
      color: #fff;
      font-family: Georgia, serif;
      font-size: 18px;
      letter-spacing: 0.02em;
    }
    .swagger-ui .info .title { font-family: Georgia, serif; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.yaml',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      displayRequestDuration: true,
      defaultModelsExpandDepth: 1,
      tryItOutEnabled: true,
      requestInterceptor: (req) => {
        // Pre-fill auth from sessionStorage if set
        const key = sessionStorage.getItem('mosaic_dev_key')
        if (key && !req.headers['Authorization']) {
          req.headers['Authorization'] = 'Bearer ' + key
        }
        return req
      }
    })
  </script>
</body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
