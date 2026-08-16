// Minimal in-memory rate limiter — no external dependency needed.
// Good enough for a single-instance deployment (matches the rest of this
// project's "one small server, one JSON file" approach). If this ever
// runs behind a load balancer with multiple instances, swap this for a
// shared store (e.g. Redis) so limits are enforced across all of them.

const buckets = new Map(); // key -> { count, resetAt }

function clientKey(req) {
  // trust proxy isn't configured, so req.ip is the direct connection;
  // if this ever sits behind a reverse proxy, set app.set('trust proxy', 1)
  // and this will pick up the forwarded client IP automatically.
  return req.ip || req.connection?.remoteAddress || "unknown";
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs - length of the rate-limit window
 * @param {number} opts.max - max requests per window per client
 * @param {string} opts.message - error message when limit is hit
 */
function rateLimit({ windowMs, max, message }) {
  return function (req, res, next) {
    const key = `${req.baseUrl}${req.path}:${clientKey(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfterSec));
      return res.status(429).json({ error: message || "Too many requests. Please try again shortly." });
    }

    next();
  };
}

// Periodic cleanup so the map doesn't grow unbounded over a long uptime.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

module.exports = rateLimit;
