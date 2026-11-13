// The content security policy of a page's frame (atlas://page/page-frame.html). A page is code an
// agent wrote for its user, with no guards on what it reaches: it may load images and fonts and
// query any address (a dev server, a database's API, the internet). It runs no other code than its
// build, which the frame evaluates, and only an Atlas window may frame it (said in the header:
// `inMeta`, the copy in the document, leaves it out, as a <meta> policy can't say it).
export function pagePolicy(development = false, inMeta = false) {
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-eval'${development ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    'img-src * atlas: data: blob:',
    'font-src * data:',
    'connect-src * http: https: ws: wss: atlas:',
    'media-src * data: blob:',
    "object-src 'none'",
    "frame-src 'none'",
    'worker-src blob:',
    "base-uri 'none'",
    "form-action 'none'",
    ...development || inMeta ? [] : ['frame-ancestors atlas://app'],
  ].join('; ');
}
