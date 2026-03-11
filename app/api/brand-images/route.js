export async function GET(req) {
  const domain = new URL(req.url).searchParams.get("domain");
  if (!domain) return Response.json({ images: [] });

  try {
    const resp = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BrandBook/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    const html = await resp.text();

    const images = [];
    const seen = new Set();

    // Extract meta images: og:image, twitter:image, msapplication-TileImage
    const metaRe = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|msapplication-TileImage)["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|msapplication-TileImage)["']/gi;
    let m;
    while ((m = metaRe.exec(html)) !== null) {
      const url = m[1] || m[2];
      if (url && !seen.has(url)) {
        seen.add(url);
        images.push(resolveUrl(url, domain));
      }
    }

    // Extract apple-touch-icon
    const touchRe = /<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/gi;
    while ((m = touchRe.exec(html)) !== null) {
      const url = m[1];
      if (url && !seen.has(url)) {
        seen.add(url);
        images.push(resolveUrl(url, domain));
      }
    }

    return Response.json({ images: images.slice(0, 8) });
  } catch {
    return Response.json({ images: [] });
  }
}

function resolveUrl(url, domain) {
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return `https://${domain}${url}`;
  return `https://${domain}/${url}`;
}
