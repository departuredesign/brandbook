export async function GET(req) {
  const domain = new URL(req.url).searchParams.get("domain");
  if (!domain) return Response.json({ logo: null, images: [] });

  try {
    const resp = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    const html = await resp.text();

    let logo = null;
    const images = [];
    const seen = new Set();

    // --- Find logo ---
    // 1. <img> tags with "logo" in src, alt, or class
    const imgRe = /<img[^>]+>/gi;
    let m;
    while ((m = imgRe.exec(html)) !== null) {
      const tag = m[0];
      const srcMatch = tag.match(/src=["']([^"']+)["']/);
      if (!srcMatch) continue;
      const src = srcMatch[1];
      const alt = (tag.match(/alt=["']([^"']*?)["']/) || [])[1] || "";
      const cls = (tag.match(/class=["']([^"']*?)["']/) || [])[1] || "";
      const id = (tag.match(/id=["']([^"']*?)["']/) || [])[1] || "";
      const combined = `${src} ${alt} ${cls} ${id}`.toLowerCase();

      if (combined.includes("logo") && !src.startsWith("data:")) {
        const resolved = resolveUrl(src, domain);
        if (!logo && !isTiny(tag)) {
          logo = resolved;
        }
      }
    }

    // 2. Fallback: SVG with "logo" in class/id
    if (!logo) {
      const svgLogoRe = /<(?:a|div|span)[^>]+class=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<(?:img|svg)[^>]+(?:src=["']([^"']+)["'])?/gi;
      while ((m = svgLogoRe.exec(html)) !== null) {
        if (m[1] && !m[1].startsWith("data:")) {
          logo = resolveUrl(m[1], domain);
          break;
        }
      }
    }

    // --- Find brand images ---
    // 1. og:image, twitter:image (usually hero images)
    const metaRe = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi;
    while ((m = metaRe.exec(html)) !== null) {
      const url = m[1] || m[2];
      if (url && !seen.has(url)) {
        seen.add(url);
        images.push(resolveUrl(url, domain));
      }
    }

    // 2. Large <img> tags from the page (likely hero/product images)
    const imgRe2 = /<img[^>]+>/gi;
    while ((m = imgRe2.exec(html)) !== null) {
      const tag = m[0];
      const srcMatch = tag.match(/src=["']([^"']+)["']/);
      if (!srcMatch) continue;
      const src = srcMatch[1];

      // Skip tiny images, data URIs, tracking pixels, icons
      if (src.startsWith("data:")) continue;
      if (isTiny(tag)) continue;
      if (isSkippable(src)) continue;

      const resolved = resolveUrl(src, domain);
      if (resolved === logo) continue;
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      images.push(resolved);
    }

    // 3. CSS background images from style attributes (hero sections)
    const bgRe = /style=["'][^"']*background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi;
    while ((m = bgRe.exec(html)) !== null) {
      const url = m[1];
      if (url && !url.startsWith("data:") && !seen.has(url)) {
        const resolved = resolveUrl(url, domain);
        if (resolved !== logo) {
          seen.add(resolved);
          images.push(resolved);
        }
      }
    }

    // 4. srcset — pick highest resolution
    const srcsetRe = /srcset=["']([^"']+)["']/gi;
    while ((m = srcsetRe.exec(html)) !== null) {
      const entries = m[1].split(",").map(s => s.trim()).filter(Boolean);
      // Pick the last (usually largest) entry
      const last = entries[entries.length - 1];
      if (last) {
        const url = last.split(/\s+/)[0];
        if (url && !url.startsWith("data:") && !isSkippable(url)) {
          const resolved = resolveUrl(url, domain);
          if (resolved !== logo && !seen.has(resolved)) {
            seen.add(resolved);
            images.push(resolved);
          }
        }
      }
    }

    return Response.json({ logo, images: images.slice(0, 8) });
  } catch {
    return Response.json({ logo: null, images: [] });
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
  // If dimensions are specified and both are small, skip
  if ((w > 0 && w < 80) || (h > 0 && h < 80)) return true;
  return false;
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
    lower.includes("icon") ||
    lower.includes("favicon") ||
    lower.includes("badge") ||
    lower.includes("sprite") ||
    lower.includes("arrow") ||
    lower.includes("chevron") ||
    lower.includes("spinner") ||
    lower.includes("loader")
  );
}
