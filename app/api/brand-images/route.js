const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Common pages that tend to have rich brand imagery
const PATHS = [
  "/",
  "/about",
  "/about-us",
  "/collections",
  "/products",
  "/our-story",
  "/lookbook",
  "/campaigns",
];

export async function GET(req) {
  const domain = new URL(req.url).searchParams.get("domain");
  if (!domain) return Response.json({ logo: null, images: [] });

  try {
    // Fetch homepage first
    const homeHtml = await fetchPage(domain, "/");
    if (!homeHtml) return Response.json({ logo: null, images: [] });

    // Find logo from homepage
    const logo = findLogo(homeHtml, domain);

    // Collect images from homepage
    const seen = new Set();
    const images = [];
    if (logo) seen.add(logo);

    extractImages(homeHtml, domain, seen, images);

    // Fetch additional pages in parallel for more imagery
    // Only try paths that aren't the homepage
    const extraPaths = PATHS.filter(p => p !== "/");
    const extraFetches = extraPaths.map(path =>
      fetchPage(domain, path).catch(() => null)
    );
    const extraPages = await Promise.allSettled(extraFetches);

    for (const result of extraPages) {
      if (result.status === "fulfilled" && result.value) {
        extractImages(result.value, domain, seen, images);
        // Also check for og:image on each page (usually unique per page)
        extractMetaImages(result.value, domain, seen, images);
      }
      // Stop once we have enough
      if (images.length >= 8) break;
    }

    return Response.json({ logo, images: images.slice(0, 8) });
  } catch {
    return Response.json({ logo: null, images: [] });
  }
}

async function fetchPage(domain, path) {
  try {
    const resp = await fetch(`https://${domain}${path}`, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function findLogo(html, domain) {
  let m;

  // 1. <img> tags with "logo" in src, alt, class, or id
  const imgRe = /<img[^>]+>/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const srcMatch = tag.match(/src=["']([^"']+)["']/);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    if (src.startsWith("data:")) continue;

    const alt = (tag.match(/alt=["']([^"']*?)["']/) || [])[1] || "";
    const cls = (tag.match(/class=["']([^"']*?)["']/) || [])[1] || "";
    const id = (tag.match(/id=["']([^"']*?)["']/) || [])[1] || "";
    const combined = `${src} ${alt} ${cls} ${id}`.toLowerCase();

    if (combined.includes("logo")) {
      return resolveUrl(src, domain);
    }
  }

  // 2. Link with "logo" in class containing an img
  const logoContainerRe = /<(?:a|div|span|header)[^>]+class=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/gi;
  while ((m = logoContainerRe.exec(html)) !== null) {
    if (m[1] && !m[1].startsWith("data:")) {
      return resolveUrl(m[1], domain);
    }
  }

  return null;
}

function extractMetaImages(html, domain, seen, images) {
  const metaRe = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi;
  let m;
  while ((m = metaRe.exec(html)) !== null) {
    const url = m[1] || m[2];
    if (url) {
      const resolved = resolveUrl(url, domain);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        images.push(resolved);
      }
    }
  }
}

function extractImages(html, domain, seen, images) {
  let m;

  // og:image, twitter:image
  extractMetaImages(html, domain, seen, images);

  // Large <img> tags
  const imgRe = /<img[^>]+>/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const srcMatch = tag.match(/src=["']([^"']+)["']/);
    if (!srcMatch) continue;
    const src = srcMatch[1];

    if (src.startsWith("data:")) continue;
    if (isTiny(tag)) continue;
    if (isSkippable(src)) continue;
    if (isLogo(tag)) continue;

    const resolved = resolveUrl(src, domain);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      images.push(resolved);
    }
  }

  // srcset — pick highest resolution variant
  const srcsetRe = /<img[^>]+srcset=["']([^"']+)["'][^>]*/gi;
  while ((m = srcsetRe.exec(html)) !== null) {
    const tag = m[0];
    if (isTiny(tag) || isSkippable(m[1]) || isLogo(tag)) continue;

    const entries = m[1].split(",").map(s => s.trim()).filter(Boolean);
    // Pick largest: entries are usually ordered smallest to largest
    const last = entries[entries.length - 1];
    if (last) {
      const url = last.split(/\s+/)[0];
      if (url && !url.startsWith("data:") && !isSkippable(url)) {
        const resolved = resolveUrl(url, domain);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          images.push(resolved);
        }
      }
    }
  }

  // CSS background-image in style attributes
  const bgRe = /style=["'][^"']*background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi;
  while ((m = bgRe.exec(html)) !== null) {
    const url = m[1];
    if (url && !url.startsWith("data:") && !isSkippable(url)) {
      const resolved = resolveUrl(url, domain);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        images.push(resolved);
      }
    }
  }
}

function resolveUrl(url, domain) {
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return `https://${domain}${url}`;
  return `https://${domain}/${url}`;
}

function isTiny(tag) {
  const w = parseInt((tag.match(/width=["']?(\d+)/) || [])[1] || "0");
  const h = parseInt((tag.match(/height=["']?(\d+)/) || [])[1] || "0");
  if ((w > 0 && w < 100) || (h > 0 && h < 100)) return true;
  return false;
}

function isLogo(tag) {
  const lower = tag.toLowerCase();
  return lower.includes("logo");
}

function isSkippable(src) {
  const lower = src.toLowerCase();
  return (
    lower.includes("pixel") ||
    lower.includes("track") ||
    lower.includes("beacon") ||
    lower.includes("spacer") ||
    lower.includes(".gif") ||
    lower.includes("1x1") ||
    lower.includes("favicon") ||
    lower.includes("badge") ||
    lower.includes("sprite") ||
    lower.includes("arrow") ||
    lower.includes("chevron") ||
    lower.includes("spinner") ||
    lower.includes("loader") ||
    lower.includes("payment") ||
    lower.includes("rating") ||
    lower.includes("star") ||
    lower.includes("social") ||
    lower.includes("share")
  );
}
