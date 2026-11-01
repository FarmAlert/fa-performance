import "server-only";

// Shared auth check for every /api/cron/* route. Two accepted forms, both
// compared against the same CRON_SECRET env var — never authorized if that
// var isn't set, so a route can't accidentally end up open in an
// environment where the secret was never configured:
//
// 1. `x-cron-secret: <secret>` — the header this app's own cron routes have
//    always expected, for any external scheduler (n8n, a manual curl) that
//    was wired up to call these routes directly.
// 2. `Authorization: Bearer <secret>` — the header Vercel Cron Jobs send
//    automatically on every scheduled invocation when a CRON_SECRET env var
//    is present (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
//    Accepting this is what lets vercel.json's `crons` entries actually
//    authenticate, so these endpoints can run on a real schedule without
//    Isaac having to stand up n8n first.
export function isAuthorizedCronRequest(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const customHeader = request.headers.get("x-cron-secret");
  if (customHeader === secret) return true;

  const authHeader = request.headers.get("authorization") || "";
  return authHeader === "Bearer " + secret;
}
