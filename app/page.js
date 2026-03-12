"use client";
import { useState, useRef, useCallback, useEffect } from "react";

// ─── API ─────────────────────────────────────────────────────────────────────

async function callClaude(messages, system, maxTokens = 8192) {
  const r = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages }),
  });
  if (!r.ok) throw new Error("API " + r.status);
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "API error");
  return (d.content || []).map(b => b.text || "").join("");
}

function tryParse(raw) {
  let c = raw.replace(/```json|```/g, "").trim();
  try { return JSON.parse(c); } catch {}
  let a = c;
  const ob = (a.match(/\[/g) || []).length - (a.match(/\]/g) || []).length;
  const cb = (a.match(/\{/g) || []).length - (a.match(/\}/g) || []).length;
  for (let i = 0; i < ob; i++) a += "]";
  for (let i = 0; i < cb; i++) a += "}";
  a = a.replace(/,\s*(\]|\})/g, "$1");
  try { return JSON.parse(a); } catch {}
  const m = c.match(/\{[\s\S]*\}/);
  if (m) {
    let o = m[0];
    const x = (o.match(/\{/g) || []).length - (o.match(/\}/g) || []).length;
    for (let i = 0; i < x; i++) o += "}";
    o = o.replace(/,\s*(\]|\})/g, "$1");
    try { return JSON.parse(o); } catch {}
  }
  return null;
}

const SYS = "You are BrandBook, an AI brand strategist. Return ONLY valid JSON. No markdown, no backticks, no preamble.";
const SCHEMA = `{"name":"","domain":"","tagline":"","summary":"","personality":[],"colors":[{"name":"","hex":"","role":""}],"typography":{"primary":"","secondary":"","rules":[]},"voice":{"words":[],"do":[],"dont":[]},"messaging":{"proposition":"","pillars":[{"title":"","desc":""}],"forbidden":[]},"audience":"","competitive":{"positioning":"","competitors":[{"name":"","hex":"","tone":"","overlap":""}],"whitespace":"","threats":[]},"logo":{"description":"","orientations":[],"clearSpace":"","minSize":"","backgrounds":{"approved":[],"forbidden":[]},"forbidden":[]},"photography":{"mood":"","subjects":[],"styling":"","do":[],"dont":[],"colorTreatment":""},"naming":{"conventions":[],"capitalization":"","productNames":[{"name":"","type":""}]},"channels":{"social":"","email":"","advertising":"","web":"","print":""},"promotion":{"do":[],"dont":[],"formatting":""},"brand_principles":{"mission":"","vision":"","values":[],"archetypes":[]},"confidence":{"colors":0,"type":0,"voice":0,"messaging":0,"logo":0,"photography":0,"naming":0,"principles":0}}`;

async function analyze(name) {
  const raw = await callClaude([{
    role: "user",
    content: `Analyze the brand "${name}". Build a comprehensive profile with:
- name, domain (the brand's primary website domain, e.g. "nike.com"), tagline, summary (2 sentences), personality (4-5 words)
- colors (5-6 with name/hex/role)
- typography (primary + secondary font names, 3 rules)
- voice (4 tone words, 4 do, 4 dont)
- messaging (proposition, 3 pillars with title+desc, 4 forbidden phrases)
- audience (1-2 sentences)
- competitive analysis:
  - positioning: 2 sentences on where this brand sits in its market
  - competitors: 3-4 entries, each with name, their primary brand hex color, their tone in one word, and overlap (what they share with this brand in 5-8 words)
  - whitespace: 1-2 sentences on the gap this brand owns that competitors don't
  - threats: 2 short sentences on biggest competitive risks
- logo: description of logo type (wordmark/symbol/combination mark), likely orientations, clear space guidance, min size, approved and forbidden backgrounds, forbidden treatments (3-4 rules)
- photography: mood description, 3-4 subject types, styling notes, 3-4 do rules, 3-4 dont rules, color treatment notes
- naming: naming conventions (2-3), capitalization rule, 2-3 product names with types
- channels: voice/format notes for social, email, advertising, web, print (1-2 sentences each)
- promotion: 3-4 do rules, 3-4 dont rules, formatting guidance
- brand_principles: mission (1 sentence), vision (1 sentence), 3-5 values, 1-2 brand archetypes
- confidence (0-100 for colors/type/voice/messaging/logo/photography/naming/principles)

Since this is a name-only analysis, set confidence for logo, photography, naming, and principles at 20-40% as these require actual brand guidelines to be authoritative. Set colors, type, voice, messaging confidence at 50-75%.

Return ONLY:\n${SCHEMA}`
  }], SYS);
  const r = tryParse(raw);
  if (!r) throw new Error("Could not parse — try again.");
  return r;
}

async function enrich(existing, text, label, contentBlocks = null) {
  const prompt = `Existing profile for "${existing.name}":\n${JSON.stringify(existing)}\n\nNew input (${label}):\n${text.slice(0, 6000)}\n\nMerge new data into ALL dimensions: colors, typography, voice, messaging, competitive, logo, photography, naming, channels, promotion, brand_principles. Replace inferred with authoritative. Raise confidence significantly for any dimension where the new input provides authoritative data (e.g. actual brand guidelines for logo rules should push logo confidence to 80-95%). Preserve and update competitive analysis if relevant. Add 1-2 "insights" noting what changed.\n\nReturn ONLY:\n${SCHEMA.slice(0, -1)},"insights":[]}`;

  let content;
  if (contentBlocks) {
    content = [...contentBlocks, { type: "text", text: prompt }];
  } else {
    content = prompt;
  }

  const raw = await callClaude([{ role: "user", content }], SYS);
  const r = tryParse(raw);
  if (!r) throw new Error("Could not parse — try again.");
  return r;
}

// ─── Brand Image Fetching ───────────────────────────────────────────────────

async function fetchBrandImages(domain) {
  if (!domain) return { logo: null, images: [] };
  try {
    const r = await fetch(`/api/brand-images?domain=${encodeURIComponent(domain)}`);
    return await r.json();
  } catch { return { logo: null, images: [] }; }
}

function placeholderSvg(label, w = 240, h = 160) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#F0F0F0" rx="4"/><rect x="${w * .12}" y="${h * .15}" width="${w * .76}" height="${h * .4}" rx="3" fill="#E0E0E0"/><rect x="${w * .12}" y="${h * .65}" width="${w * .45}" height="${h * .06}" rx="2" fill="#E0E0E0"/><rect x="${w * .12}" y="${h * .76}" width="${w * .3}" height="${h * .06}" rx="2" fill="#E0E0E0"/><text x="${w / 2}" y="${h * .4}" text-anchor="middle" font-family="system-ui" font-size="11" fill="#999">${label}</text></svg>`)}`;
}

// ─── Layout Components ───────────────────────────────────────────────────────

const M = { fontFamily: "'IBM Plex Mono', monospace" };
const PAD = "clamp(48px, 8vw, 120px)";

function Spinner({ sz = 14 }) {
  return <div style={{ width: sz, height: sz, border: "1.5px solid #E5E5E5", borderTopColor: "#0D0D0D", borderRadius: "50%", animation: "spin .5s linear infinite", flexShrink: 0 }} />;
}

function Tag({ children, red }) {
  const bg = red ? "#FFF0F0" : "#F5F5F5";
  const color = red ? "#CF222E" : "#5C5C5C";
  const bdr = red ? "rgba(207,34,46,.12)" : "#E5E5E5";
  return <span style={{ display: "inline-block", padding: "4px 12px", borderRadius: 4, fontSize: 12, fontWeight: 500, letterSpacing: ".02em", background: bg, color, border: `1px solid ${bdr}` }}>{children}</span>;
}

function Spread({ children, bg, minH, noPadBottom }) {
  return <div style={{
    minHeight: minH || "85vh",
    padding: `80px ${PAD} ${noPadBottom ? "0" : "80px"}`,
    background: bg || "#FFF",
    display: "flex", flexDirection: "column", justifyContent: "center",
    position: "relative",
    borderBottom: "1px solid #E5E5E5",
  }}>{children}</div>;
}

function SectionDivider({ num, title, subtitle, brandName }) {
  return <div style={{
    minHeight: "70vh",
    background: "#0D0D0D", color: "#FFF",
    display: "flex", flexDirection: "column", justifyContent: "flex-end",
    padding: `80px ${PAD}`,
    position: "relative",
  }}>
    {num && <div style={{ ...M, fontSize: 14, color: "#555", letterSpacing: ".12em", marginBottom: 16 }}>{String(num).padStart(2, "0")}</div>}
    <h2 style={{ fontSize: "clamp(48px, 8vw, 80px)", fontWeight: 800, letterSpacing: "-.04em", lineHeight: .95 }}>{title}</h2>
    {subtitle && <p style={{ fontSize: 18, color: "#888", marginTop: 20, maxWidth: 480 }}>{subtitle}</p>}
    <div style={{ position: "absolute", bottom: 32, left: PAD, right: PAD, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ ...M, fontSize: 10, color: "#444" }}>{brandName || ""}</span>
      <span style={{ ...M, fontSize: 10, color: "#444" }}>brand guidelines</span>
    </div>
  </div>;
}

function SectionLabel({ children }) {
  return <div style={{ ...M, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#999", marginBottom: 12 }}>{children}</div>;
}

function CBar({ label, value }) {
  const c = value > 85 ? "#1A7F37" : value > 60 ? "#0D0D0D" : "#999";
  return <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
    <span style={{ ...M, fontSize: 11, color: "#999", minWidth: 80 }}>{label}</span>
    <div style={{ flex: 1, height: 4, background: "#F0F0F0", borderRadius: 2, overflow: "hidden", maxWidth: 360 }}>
      <div style={{ height: "100%", width: `${value}%`, background: c, borderRadius: 2, transition: "width 1s cubic-bezier(.16,1,.3,1)" }} />
    </div>
    <span style={{ ...M, fontSize: 11, color: "#5C5C5C", minWidth: 32, textAlign: "right" }}>{value}%</span>
  </div>;
}

function SourcePill({ label }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, background: "#0D0D0D", color: "#FFF", fontSize: 11, fontWeight: 500, letterSpacing: ".02em" }}>
    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80" }} />{label}
  </span>;
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ sections, activeSection, open, onToggle, confidence }) {
  return <>
    {/* Mobile overlay backdrop */}
    {open && <div onClick={onToggle} className="sidebar-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 55, display: "none" }} />}
    <nav style={{
      position: "fixed", top: 56, left: 0, bottom: 0, width: 260,
      background: "#FFF", borderRight: "1px solid #E5E5E5",
      zIndex: 40, overflowY: "auto", padding: "28px 0",
      transform: open ? "translateX(0)" : "translateX(-260px)",
      transition: "transform 250ms ease",
    }} className="sidebar-nav">
      <div style={{ padding: "0 24px 20px", ...M, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#D4D4D4" }}>Sections</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {sections.map((s) => {
          const isActive = activeSection === s.id;
          const conf = confidence?.[s.confidenceKey] || 0;
          return <button key={s.id} onClick={() => {
            const el = document.getElementById(s.id);
            if (el) {
              const y = el.getBoundingClientRect().top + window.scrollY - 72;
              window.scrollTo({ top: y, behavior: "smooth" });
            }
            // Close on mobile
            if (window.innerWidth < 768) onToggle();
          }} style={{
            display: "flex", alignItems: "flex-start", gap: 12, width: "100%",
            padding: "14px 24px 14px 22px", background: "none", border: "none",
            borderLeft: isActive ? "2px solid #0D0D0D" : "2px solid transparent",
            cursor: "pointer", fontFamily: "inherit", textAlign: "left",
            transition: "background .15s",
            marginBottom: 0,
          }}>
            <span style={{ ...M, fontSize: 13, fontWeight: 300, color: isActive ? "#0D0D0D" : "#D4D4D4", minWidth: 22, paddingTop: 1 }}>{s.num}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 14, fontWeight: isActive ? 600 : 400, color: isActive ? "#0D0D0D" : "#999", letterSpacing: "-.01em", lineHeight: 1.3 }}>{s.title}</div>
              {conf > 0 && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                <div style={{ width: 60, height: 2, background: "#F0F0F0", borderRadius: 1, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${conf}%`, background: conf > 85 ? "#1A7F37" : conf > 60 ? "#0D0D0D" : "#999", borderRadius: 1 }} />
                </div>
                <span style={{ ...M, fontSize: 10, color: "#999" }}>{conf}%</span>
              </div>}
            </div>
          </button>;
        })}
      </div>
    </nav>
  </>;
}

// ─── Profile ─────────────────────────────────────────────────────────────────

function Profile({ brand, sources, images, brandImages, brandLogo, onSections }) {
  const colors = Array.isArray(brand.colors) ? brand.colors : [...(brand.colors?.primary || []), ...(brand.colors?.secondary || [])];
  const cn = brand.confidence || {};
  const primaryColor = colors[0]?.hex || "#0D0D0D";
  const arr = v => Array.isArray(v) ? v : v ? [v] : [];

  const sections = [
    colors.length > 0 && { num: "01", id: "section-01", title: "Color System", confidenceKey: "colors" },
    brand.typography?.primary && { num: "02", id: "section-02", title: "Typography", confidenceKey: "type" },
    (brand.voice?.words?.length > 0 || brand.voice?.do?.length > 0) && { num: "03", id: "section-03", title: "Voice & Tone", confidenceKey: "voice" },
    brand.messaging?.proposition && { num: "04", id: "section-04", title: "Messaging", confidenceKey: "messaging" },
    (brand.competitive || brand.audience) && { num: "05", id: "section-05", title: "Competitive Landscape" },
    brandImages.length > 0 && { num: "06", id: "section-06", title: "Brand Imagery" },
    brand.logo?.description && { num: "07", id: "section-07", title: "Logo Usage", confidenceKey: "logo" },
    brand.photography?.mood && { num: "08", id: "section-08", title: "Photography", confidenceKey: "photography" },
    (brand.naming?.conventions?.length > 0 || brand.naming?.productNames?.length > 0) && { num: "09", id: "section-09", title: "Naming", confidenceKey: "naming" },
    (brand.channels?.social || brand.channels?.email) && { num: "10", id: "section-10", title: "Channels" },
    (brand.promotion?.do?.length > 0 || brand.promotion?.dont?.length > 0) && { num: "11", id: "section-11", title: "Promotion" },
    (brand.brand_principles?.mission || brand.brand_principles?.values?.length > 0) && { num: "12", id: "section-12", title: "Brand Principles", confidenceKey: "principles" },
  ].filter(Boolean);

  useEffect(() => {
    if (onSections) onSections(sections);
  }, [brand, brandImages.length]);

  return <div style={{ animation: "fadeIn .5s ease-out" }}>

    {/* ═══ Cover Page ═══ */}
    <div style={{
      minHeight: "90vh", padding: `80px ${PAD}`,
      display: "grid", gridTemplateColumns: brandImages.length > 0 ? "1fr 1fr" : "1fr",
      gap: 64, alignItems: "center",
    }}>
      <div>
        <div style={{ ...M, fontSize: 10, letterSpacing: ".15em", textTransform: "uppercase", color: "#D4D4D4", marginBottom: 32 }}>Brand Guidelines</div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24 }}>
          {(brandLogo || brand.domain) && <img src={brandLogo || `https://www.google.com/s2/favicons?domain=${brand.domain}&sz=128`} alt="" style={{ height: 80, maxWidth: 200, objectFit: "contain", background: "#FFF", padding: 6 }} onError={e => { e.target.style.display = "none"; }} />}
        </div>
        <h1 style={{ fontSize: "clamp(56px, 9vw, 88px)", fontWeight: 800, letterSpacing: "-.05em", lineHeight: .9, marginBottom: 20 }}>{brand.name}</h1>
        {brand.tagline && <p style={{ fontSize: 20, fontStyle: "italic", color: "#5C5C5C", marginBottom: 24 }}>{brand.tagline}</p>}
        {brand.summary && <p style={{ fontSize: 16, color: "#2A2A2A", lineHeight: 1.7, maxWidth: 520 }}>{brand.summary}</p>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 32 }}>{sources.map((s, i) => <SourcePill key={i} label={s} />)}</div>
        {arr(brand.personality).length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>{arr(brand.personality).map((p, i) => <Tag key={i}>{p}</Tag>)}</div>}
        {images.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>{images.map((img, i) => <img key={i} src={img} style={{ width: 100, height: 68, objectFit: "cover", borderRadius: 6, border: "1px solid #E5E5E5" }} />)}</div>}
      </div>
      {brandImages.length > 0 ? (
        <div style={{ height: 480, borderRadius: 0, overflow: "hidden" }}>
          <img src={brandImages[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.target.parentElement.style.background = primaryColor; e.target.style.display = "none"; }} />
        </div>
      ) : (
        <div style={{ height: 480, background: primaryColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "clamp(48px, 7vw, 72px)", fontWeight: 800, color: "#FFF", letterSpacing: "-.04em", opacity: .15 }}>{brand.name}</span>
        </div>
      )}
    </div>

    {/* ═══ 01 Color Palette ═══ */}
    {colors.length > 0 && <div id="section-01">
      <SectionDivider num={1} title="Color System" subtitle="Primary and secondary palette" brandName={brand.name} />
      <Spread>
        {/* Primary color hero */}
        <div style={{ height: 200, background: primaryColor, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 48 }}>
          <span style={{ fontSize: "clamp(40px, 6vw, 64px)", fontWeight: 800, color: "#FFF", letterSpacing: "-.03em", textShadow: "0 2px 8px rgba(0,0,0,.2)" }}>{brand.name}</span>
        </div>
        {/* Full-width color bands */}
        <div style={{ display: "flex", gap: 0, marginBottom: 40 }}>
          {colors.slice(0, 6).map((c, i) => <div key={i} style={{ flex: 1, height: 120, background: c.hex || "#ccc", border: (c.hex || "").toUpperCase().includes("FFF") ? "1px solid #E5E5E5" : "none" }} />)}
        </div>
        {/* Color details grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
          {colors.slice(0, 6).map((c, i) => <div key={i}>
            <div style={{ width: "100%", height: 80, background: c.hex || "#ccc", border: (c.hex || "").toUpperCase().includes("FFF") ? "1px solid #E5E5E5" : "none", marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{c.name}</div>
            <div style={{ ...M, fontSize: 11, color: "#999" }}>{c.hex}</div>
            {c.role && <div style={{ fontSize: 12, color: "#5C5C5C", marginTop: 4 }}>{c.role}</div>}
          </div>)}
        </div>
      </Spread>
    </div>}

    {/* ═══ 02 Typography ═══ */}
    {brand.typography?.primary && <div id="section-02">
      <SectionDivider num={2} title="Typography System" brandName={brand.name} />
      <Spread>
        <div style={{ display: "grid", gridTemplateColumns: brand.typography.secondary && brand.typography.secondary !== "null" ? "2fr 1fr" : "1fr", gap: 64, marginBottom: 56 }}>
          <div>
            <SectionLabel>Primary Typeface</SectionLabel>
            <div style={{ fontSize: "clamp(64px, 10vw, 96px)", fontWeight: 800, letterSpacing: "-.04em", lineHeight: .9, marginBottom: 24 }}>{brand.typography.primary}</div>
            <div style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 300, color: "#999", letterSpacing: "-.02em", lineHeight: 1.2 }}>Aa Bb Cc Dd Ee Ff Gg</div>
          </div>
          {brand.typography.secondary && brand.typography.secondary !== "null" && <div>
            <SectionLabel>Secondary Typeface</SectionLabel>
            <div style={{ fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 300, letterSpacing: "-.02em", lineHeight: .95, marginBottom: 24 }}>{brand.typography.secondary}</div>
            <div style={{ fontSize: "clamp(20px, 3vw, 28px)", fontWeight: 300, color: "#999", letterSpacing: "-.01em", lineHeight: 1.2 }}>Aa Bb Cc Dd</div>
          </div>}
        </div>
        {/* Full alphabet specimen */}
        <div style={{ marginBottom: 48, padding: "32px 0", borderTop: "1px solid #E5E5E5" }}>
          <div style={{ fontSize: "clamp(20px, 3vw, 28px)", fontWeight: 300, color: "#999", letterSpacing: "-.01em", lineHeight: 1.6 }}>
            Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm Nn Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx Yy Zz
          </div>
          <div style={{ ...M, fontSize: 11, color: "#D4D4D4", marginTop: 8 }}>0 1 2 3 4 5 6 7 8 9 ! @ # $ % &amp; * ( )</div>
        </div>
        {/* Weight showcase */}
        <div style={{ display: "flex", gap: 0, marginBottom: 48, borderTop: "2px solid #0D0D0D", borderBottom: "1px solid #E5E5E5" }}>
          {[{ w: 300, l: "Light" }, { w: 400, l: "Regular" }, { w: 600, l: "Semibold" }, { w: 800, l: "Bold" }].map((wt, i) => (
            <div key={i} style={{ flex: 1, padding: "24px 0", borderRight: i < 3 ? "1px solid #E5E5E5" : "none", paddingRight: 16 }}>
              <div style={{ fontSize: 24, fontWeight: wt.w, letterSpacing: "-.02em", marginBottom: 4 }}>{brand.typography.primary}</div>
              <div style={{ ...M, fontSize: 10, color: "#999" }}>{wt.l} · {wt.w}</div>
            </div>
          ))}
        </div>
        {/* Typography rules */}
        {(brand.typography.rules || []).length > 0 && <div style={{ marginBottom: 48 }}>
          <SectionLabel>Usage Rules</SectionLabel>
          {arr(brand.typography.rules).map((r, i) => <div key={i} style={{ display: "flex", gap: 16, alignItems: "baseline", padding: "16px 0", borderBottom: "1px solid #E5E5E5", fontSize: 15, color: "#2A2A2A", lineHeight: 1.65 }}>
            <span style={{ ...M, fontSize: 11, color: "#D4D4D4", flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
            {r}
          </div>)}
        </div>}
        {/* Type hierarchy example */}
        <div>
          <SectionLabel>Type Hierarchy</SectionLabel>
          <div style={{ padding: "32px 0" }}>
            <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-.04em", lineHeight: 1.1, marginBottom: 12 }}>Heading 1</div>
            <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1.15, marginBottom: 12 }}>Heading 2</div>
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.2, marginBottom: 12 }}>Heading 3</div>
            <div style={{ fontSize: 16, fontWeight: 400, lineHeight: 1.65, marginBottom: 12, color: "#2A2A2A" }}>Body text — The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.</div>
            <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: ".02em", color: "#5C5C5C" }}>CAPTION — Supporting label text</div>
          </div>
        </div>
      </Spread>
    </div>}

    {/* ═══ 03 Voice & Tone ═══ */}
    {(brand.voice?.words?.length > 0 || brand.voice?.do?.length > 0) && <div id="section-03">
      <SectionDivider num={3} title="Voice & Tone" brandName={brand.name} />
      <Spread>
        {/* Tone words — large scale 2x2 grid */}
        {arr(brand.voice.words).length > 0 && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 56 }}>
          {arr(brand.voice.words).map((w, i) => <div key={i} style={{
            padding: "48px 40px",
            background: i % 2 === 0 ? "#F5F5F5" : "#EBEBEB",
            borderBottom: i < 2 ? "none" : "none",
          }}>
            <div style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-.02em" }}>{w}</div>
          </div>)}
        </div>}
        {/* Do / Don't */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {arr(brand.voice.do).length > 0 && <div style={{ background: "#ECFDF3", padding: "36px 40px", minHeight: 300 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#1A7F37", marginBottom: 24 }}>The brand does</div>
            {arr(brand.voice.do).map((v, i) => <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", fontSize: 15, color: "#2A2A2A", lineHeight: 1.6 }}>
              <span style={{ color: "#1A7F37", fontWeight: 700, flexShrink: 0, fontSize: 16 }}>+</span><span>{v}</span>
            </div>)}
          </div>}
          {arr(brand.voice.dont).length > 0 && <div style={{ background: "#FFF0F0", padding: "36px 40px", minHeight: 300 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#CF222E", marginBottom: 24 }}>The brand avoids</div>
            {arr(brand.voice.dont).map((v, i) => <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", fontSize: 15, color: "#2A2A2A", lineHeight: 1.6 }}>
              <span style={{ color: "#CF222E", fontWeight: 700, flexShrink: 0, fontSize: 16 }}>&minus;</span><span>{v}</span>
            </div>)}
          </div>}
        </div>
      </Spread>
    </div>}

    {/* ═══ 04 Messaging ═══ */}
    {brand.messaging?.proposition && <div id="section-04">
      <SectionDivider num={4} title="Messaging Framework" brandName={brand.name} />
      {/* Core proposition — full-bleed dark hero */}
      <div style={{
        minHeight: "50vh", background: "#0D0D0D", color: "#FFF",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: `80px ${PAD}`, textAlign: "center",
      }}>
        <div style={{ ...M, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#555", marginBottom: 24 }}>Core Proposition</div>
        <p style={{ fontSize: "clamp(24px, 4vw, 36px)", fontWeight: 300, fontStyle: "italic", lineHeight: 1.5, maxWidth: 700, letterSpacing: "-.01em" }}>{brand.messaging.proposition}</p>
      </div>
      {/* Pillars + Forbidden */}
      <Spread minH="auto" bg="#FFF">
        {arr(brand.messaging.pillars).length > 0 && <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(arr(brand.messaging.pillars).length, 3)}, 1fr)`, gap: 32, marginBottom: 40 }}>
          {arr(brand.messaging.pillars).map((p, i) => <div key={i} style={{ borderLeft: "3px solid #0D0D0D", paddingLeft: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, letterSpacing: "-.01em" }}>{typeof p === "string" ? p : p.title || ""}</div>
            {typeof p === "object" && p.desc && <div style={{ fontSize: 14, color: "#5C5C5C", lineHeight: 1.65 }}>{p.desc}</div>}
          </div>)}
        </div>}
        {arr(brand.messaging.forbidden).length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 24, borderTop: "1px solid #E5E5E5" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#CF222E", letterSpacing: ".06em", textTransform: "uppercase", marginRight: 8 }}>Never say</span>
          {arr(brand.messaging.forbidden).map((f, i) => <Tag key={i} red>{f}</Tag>)}
        </div>}
      </Spread>
    </div>}

    {/* ═══ 05 Competitive Landscape ═══ */}
    {(brand.competitive || brand.competitors?.length > 0 || brand.audience) && <div id="section-05">
      <SectionDivider num={5} title="Competitive Landscape" brandName={brand.name} />
      <Spread>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64 }}>
          {/* Left column: audience + positioning + whitespace/threats */}
          <div>
            {brand.audience && <div style={{ marginBottom: 36 }}>
              <SectionLabel>Audience</SectionLabel>
              <div style={{ fontSize: 16, color: "#2A2A2A", lineHeight: 1.7 }}>{typeof brand.audience === "string" ? brand.audience : brand.audience?.primary || ""}</div>
            </div>}
            {brand.competitive?.positioning && <div style={{ marginBottom: 36 }}>
              <SectionLabel>Positioning</SectionLabel>
              <div style={{ fontSize: 16, color: "#2A2A2A", lineHeight: 1.7 }}>{brand.competitive.positioning}</div>
            </div>}
            {brand.competitive?.whitespace && <div style={{ padding: "24px 28px", background: "#ECFDF3", marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#1A7F37", marginBottom: 8 }}>Whitespace owned</div>
              <div style={{ fontSize: 14, color: "#2A2A2A", lineHeight: 1.65 }}>{brand.competitive.whitespace}</div>
            </div>}
            {brand.competitive?.threats && <div style={{ padding: "24px 28px", background: "#FFF8E1" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#9A6700", marginBottom: 8 }}>Competitive risks</div>
              {(Array.isArray(brand.competitive.threats) ? brand.competitive.threats : [brand.competitive.threats]).map((t, i) => <div key={i} style={{ fontSize: 14, color: "#2A2A2A", lineHeight: 1.65, marginBottom: 4 }}>{t}</div>)}
            </div>}
          </div>

          {/* Right column: competitor bar + table */}
          <div>
            {(brand.competitive?.competitors?.length > 0 || brand.competitors?.length > 0) && (() => {
              const comps = brand.competitive?.competitors || brand.competitors?.map(c => typeof c === "string" ? { name: c } : c) || [];
              return <>
                <SectionLabel>Competitor Comparison</SectionLabel>
                <div style={{ display: "flex", gap: 0, marginBottom: 24, overflow: "hidden" }}>
                  <div style={{ flex: 2, height: 64, background: primaryColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#FFF", textShadow: "0 1px 2px rgba(0,0,0,.3)" }}>{brand.name}</span>
                  </div>
                  {comps.slice(0, 4).map((comp, i) =>
                    <div key={i} style={{ flex: 1, height: 64, background: comp.hex || ["#1877F2", "#E60023", "#FF9900", "#0A66C2"][i] || "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: "#FFF", textShadow: "0 1px 2px rgba(0,0,0,.3)", textAlign: "center", padding: "0 4px" }}>{comp.name?.split(" ")[0]}</span>
                    </div>
                  )}
                </div>
                <div style={{ border: "1px solid #E5E5E5" }}>
                  {comps.map((comp, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "12px 1fr 80px", gap: 16, alignItems: "center", padding: "18px 24px", borderBottom: i < comps.length - 1 ? "1px solid #E5E5E5" : "none", background: i % 2 === 0 ? "#FAFAFA" : "#FFF" }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: comp.hex || ["#1877F2", "#E60023", "#FF9900", "#0A66C2"][i] || "#888" }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{comp.name || comp}</div>
                      <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{comp.overlap || ""}</div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "#5C5C5C", textAlign: "right" }}>{comp.tone || ""}</div>
                  </div>)}
                </div>
              </>;
            })()}
          </div>
        </div>
      </Spread>
    </div>}

    {/* ═══ 06 Brand Imagery ═══ */}
    {brandImages.length > 0 && <div id="section-06">
      <SectionDivider num={6} title="Brand Imagery" brandName={brand.name} />
      <Spread noPadBottom>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 4, marginBottom: 4 }}>
          {/* First image full width */}
          <div style={{ height: 360, overflow: "hidden" }}>
            <img src={brandImages[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={e => { e.target.parentElement.style.display = "none"; }} />
          </div>
        </div>
        {brandImages.length > 1 && <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
          {brandImages.slice(1).map((url, i) => <div key={i} style={{ height: 220, overflow: "hidden" }}>
            <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={e => { e.target.parentElement.style.display = "none"; }} />
          </div>)}
        </div>}
        {brand.domain && <div style={{ ...M, fontSize: 10, color: "#D4D4D4", padding: "16px 0 80px" }}>Sourced from {brand.domain}</div>}
      </Spread>
    </div>}

    {/* ═══ 07 Logo Usage ═══ */}
    {brand.logo?.description && <div id="section-07">
      <SectionDivider num={7} title="Logo Usage" brandName={brand.name} />
      <Spread>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, marginBottom: 48 }}>
          <div>
            <SectionLabel>Logo Description</SectionLabel>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.01em", marginBottom: 16 }}>{brand.logo.description}</div>
            {brand.logo.clearSpace && <div style={{ marginBottom: 16 }}>
              <SectionLabel>Clear Space</SectionLabel>
              <div style={{ fontSize: 15, color: "#2A2A2A", lineHeight: 1.65 }}>{brand.logo.clearSpace}</div>
            </div>}
            {brand.logo.minSize && <div>
              <SectionLabel>Minimum Size</SectionLabel>
              <div style={{ fontSize: 15, color: "#2A2A2A", lineHeight: 1.65 }}>{brand.logo.minSize}</div>
            </div>}
          </div>
          <div>
            {arr(brand.logo.orientations).length > 0 && <div style={{ marginBottom: 24 }}>
              <SectionLabel>Orientations</SectionLabel>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{arr(brand.logo.orientations).map((o, i) => <Tag key={i}>{o}</Tag>)}</div>
            </div>}
            {brand.logo.backgrounds && <div style={{ marginBottom: 24 }}>
              <SectionLabel>Approved Backgrounds</SectionLabel>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {arr(brand.logo.backgrounds.approved).map((b, i) => <span key={i} style={{ padding: "8px 16px", fontSize: 13, background: b.toLowerCase().includes("white") ? "#FFF" : b.toLowerCase().includes("black") ? "#0D0D0D" : "#F5F5F5", color: b.toLowerCase().includes("black") ? "#FFF" : "#0D0D0D", border: "1px solid #E5E5E5" }}>{b}</span>)}
              </div>
              {arr(brand.logo.backgrounds.forbidden).length > 0 && <>
                <SectionLabel>Forbidden Backgrounds</SectionLabel>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {arr(brand.logo.backgrounds.forbidden).map((b, i) => <Tag key={i} red>{b}</Tag>)}
                </div>
              </>}
            </div>}
          </div>
        </div>
        {arr(brand.logo.forbidden).length > 0 && <div style={{ borderTop: "1px solid #E5E5E5", paddingTop: 32 }}>
          <SectionLabel>Forbidden Treatments</SectionLabel>
          {arr(brand.logo.forbidden).map((r, i) => <div key={i} style={{ display: "flex", gap: 16, alignItems: "baseline", padding: "12px 0", borderBottom: "1px solid #E5E5E5", fontSize: 15, color: "#2A2A2A", lineHeight: 1.65 }}>
            <span style={{ ...M, fontSize: 11, color: "#CF222E", flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
            {r}
          </div>)}
        </div>}
      </Spread>
    </div>}

    {/* ═══ 08 Photography ═══ */}
    {brand.photography?.mood && <div id="section-08">
      <SectionDivider num={8} title="Photography" brandName={brand.name} />
      <Spread>
        {/* Mood hero quote */}
        <div style={{ padding: "48px 40px", background: "#F5F5F5", marginBottom: 48 }}>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#999", marginBottom: 16 }}>Mood & Direction</div>
          <div style={{ fontSize: "clamp(20px, 3vw, 28px)", fontWeight: 300, fontStyle: "italic", letterSpacing: "-.01em", lineHeight: 1.5, color: "#2A2A2A" }}>{brand.photography.mood}</div>
        </div>
        {/* Subjects & Styling */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginBottom: 48 }}>
          {arr(brand.photography.subjects).length > 0 && <div>
            <SectionLabel>Subjects</SectionLabel>
            {arr(brand.photography.subjects).map((s, i) => <div key={i} style={{ padding: "10px 0", fontSize: 15, color: "#2A2A2A", lineHeight: 1.65, borderBottom: "1px solid #E5E5E5" }}>{s}</div>)}
          </div>}
          <div>
            {brand.photography.styling && <div style={{ marginBottom: 24 }}>
              <SectionLabel>Styling</SectionLabel>
              <div style={{ fontSize: 15, color: "#2A2A2A", lineHeight: 1.65 }}>{brand.photography.styling}</div>
            </div>}
            {brand.photography.colorTreatment && <div>
              <SectionLabel>Color Treatment</SectionLabel>
              <div style={{ fontSize: 15, color: "#2A2A2A", lineHeight: 1.65 }}>{brand.photography.colorTreatment}</div>
            </div>}
          </div>
        </div>
        {/* Do / Don't */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {arr(brand.photography.do).length > 0 && <div style={{ background: "#ECFDF3", padding: "36px 40px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#1A7F37", marginBottom: 24 }}>Do</div>
            {arr(brand.photography.do).map((v, i) => <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", fontSize: 15, color: "#2A2A2A", lineHeight: 1.6 }}>
              <span style={{ color: "#1A7F37", fontWeight: 700, flexShrink: 0, fontSize: 16 }}>+</span><span>{v}</span>
            </div>)}
          </div>}
          {arr(brand.photography.dont).length > 0 && <div style={{ background: "#FFF0F0", padding: "36px 40px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#CF222E", marginBottom: 24 }}>Don&apos;t</div>
            {arr(brand.photography.dont).map((v, i) => <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", fontSize: 15, color: "#2A2A2A", lineHeight: 1.6 }}>
              <span style={{ color: "#CF222E", fontWeight: 700, flexShrink: 0, fontSize: 16 }}>&minus;</span><span>{v}</span>
            </div>)}
          </div>}
        </div>
      </Spread>
    </div>}

    {/* ═══ 09 Naming ═══ */}
    {(brand.naming?.conventions?.length > 0 || brand.naming?.productNames?.length > 0) && <div id="section-09">
      <SectionDivider num={9} title="Naming" brandName={brand.name} />
      <Spread>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64 }}>
          <div>
            {arr(brand.naming.conventions).length > 0 && <div style={{ marginBottom: 32 }}>
              <SectionLabel>Naming Conventions</SectionLabel>
              {arr(brand.naming.conventions).map((c, i) => <div key={i} style={{ display: "flex", gap: 16, alignItems: "baseline", padding: "12px 0", borderBottom: "1px solid #E5E5E5", fontSize: 15, color: "#2A2A2A", lineHeight: 1.65 }}>
                <span style={{ ...M, fontSize: 11, color: "#D4D4D4", flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
                {c}
              </div>)}
            </div>}
            {brand.naming.capitalization && <div>
              <SectionLabel>Capitalization</SectionLabel>
              <div style={{ padding: "16px 20px", background: "#F5F5F5", fontSize: 15, color: "#2A2A2A", lineHeight: 1.65 }}>{brand.naming.capitalization}</div>
            </div>}
          </div>
          {arr(brand.naming.productNames).length > 0 && <div>
            <SectionLabel>Product Names</SectionLabel>
            <div style={{ border: "1px solid #E5E5E5" }}>
              {arr(brand.naming.productNames).map((p, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", padding: "14px 20px", borderBottom: i < arr(brand.naming.productNames).length - 1 ? "1px solid #E5E5E5" : "none", background: i % 2 === 0 ? "#FAFAFA" : "#FFF" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{typeof p === "string" ? p : p.name}</div>
                <div style={{ fontSize: 13, color: "#5C5C5C" }}>{typeof p === "object" ? p.type : ""}</div>
              </div>)}
            </div>
          </div>}
        </div>
      </Spread>
    </div>}

    {/* ═══ 10 Channels ═══ */}
    {(brand.channels?.social || brand.channels?.email) && <div id="section-10">
      <SectionDivider num={10} title="Channels" brandName={brand.name} />
      <Spread>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
          {["social", "email", "advertising", "web", "print"].map(ch => brand.channels?.[ch] && <div key={ch} style={{ padding: "28px 32px", background: "#F5F5F5" }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#0D0D0D", marginBottom: 12 }}>{ch}</div>
            <div style={{ fontSize: 14, color: "#2A2A2A", lineHeight: 1.65 }}>{brand.channels[ch]}</div>
          </div>)}
        </div>
      </Spread>
    </div>}

    {/* ═══ 11 Promotion ═══ */}
    {(brand.promotion?.do?.length > 0 || brand.promotion?.dont?.length > 0) && <div id="section-11">
      <SectionDivider num={11} title="Promotion" brandName={brand.name} />
      <Spread>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: brand.promotion.formatting ? 32 : 0 }}>
          {arr(brand.promotion.do).length > 0 && <div style={{ background: "#ECFDF3", padding: "36px 40px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#1A7F37", marginBottom: 24 }}>Do</div>
            {arr(brand.promotion.do).map((v, i) => <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", fontSize: 15, color: "#2A2A2A", lineHeight: 1.6 }}>
              <span style={{ color: "#1A7F37", fontWeight: 700, flexShrink: 0, fontSize: 16 }}>+</span><span>{v}</span>
            </div>)}
          </div>}
          {arr(brand.promotion.dont).length > 0 && <div style={{ background: "#FFF0F0", padding: "36px 40px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#CF222E", marginBottom: 24 }}>Don&apos;t</div>
            {arr(brand.promotion.dont).map((v, i) => <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", fontSize: 15, color: "#2A2A2A", lineHeight: 1.6 }}>
              <span style={{ color: "#CF222E", fontWeight: 700, flexShrink: 0, fontSize: 16 }}>&minus;</span><span>{v}</span>
            </div>)}
          </div>}
        </div>
        {brand.promotion.formatting && <div style={{ padding: "16px 20px", background: "#F5F5F5" }}>
          <SectionLabel>Formatting</SectionLabel>
          <div style={{ fontSize: 15, color: "#2A2A2A", lineHeight: 1.65, marginTop: 8 }}>{brand.promotion.formatting}</div>
        </div>}
      </Spread>
    </div>}

    {/* ═══ 12 Brand Principles ═══ */}
    {(brand.brand_principles?.mission || brand.brand_principles?.values?.length > 0) && <div id="section-12">
      <SectionDivider num={12} title="Brand Principles" brandName={brand.name} />
      {/* Mission & Vision hero */}
      {(brand.brand_principles.mission || brand.brand_principles.vision) && <div style={{
        minHeight: "50vh", background: "#0D0D0D", color: "#FFF",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: `80px ${PAD}`, textAlign: "center",
      }}>
        {brand.brand_principles.mission && <>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#555", marginBottom: 24 }}>Mission</div>
          <p style={{ fontSize: "clamp(24px, 4vw, 36px)", fontWeight: 300, fontStyle: "italic", lineHeight: 1.5, maxWidth: 700, letterSpacing: "-.01em", marginBottom: brand.brand_principles.vision ? 48 : 0 }}>{brand.brand_principles.mission}</p>
        </>}
        {brand.brand_principles.vision && <>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#555", marginBottom: 24 }}>Vision</div>
          <p style={{ fontSize: "clamp(20px, 3vw, 28px)", fontWeight: 300, lineHeight: 1.5, maxWidth: 700, letterSpacing: "-.01em", color: "#999" }}>{brand.brand_principles.vision}</p>
        </>}
      </div>}
      <Spread minH="auto">
        {arr(brand.brand_principles.values).length > 0 && <div style={{ marginBottom: 32 }}>
          <SectionLabel>Values</SectionLabel>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{arr(brand.brand_principles.values).map((v, i) => <Tag key={i}>{v}</Tag>)}</div>
        </div>}
        {arr(brand.brand_principles.archetypes).length > 0 && <div>
          <SectionLabel>Archetypes</SectionLabel>
          <div style={{ display: "flex", gap: 24 }}>{arr(brand.brand_principles.archetypes).map((a, i) => <div key={i} style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-.02em", color: "#2A2A2A" }}>{a}</div>)}</div>
        </div>}
      </Spread>
    </div>}

    {/* ═══ Insights ═══ */}
    {arr(brand.insights).length > 0 && <Spread minH="auto" bg="#FFF">
      <SectionLabel>Cross-source insights</SectionLabel>
      {arr(brand.insights).map((ins, i) => <div key={i} style={{ padding: "16px 24px", background: "#EFF6FF", marginBottom: 8, fontSize: 14, color: "#2A2A2A", lineHeight: 1.65, borderLeft: "3px solid #2563EB" }}>{ins}</div>)}
    </Spread>}

    {/* ═══ Confidence ═══ */}
    <Spread minH="40vh" bg="#FAFAFA">
      <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center" }}>
        <h3 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 36 }}>Data Confidence</h3>
        <div style={{ textAlign: "left" }}>
          <CBar label="Colors" value={cn.colors || 0} />
          <CBar label="Type" value={cn.type || cn.typography || 0} />
          <CBar label="Voice" value={cn.voice || 0} />
          <CBar label="Messaging" value={cn.messaging || 0} />
          <CBar label="Logo" value={cn.logo || 0} />
          <CBar label="Photography" value={cn.photography || 0} />
          <CBar label="Naming" value={cn.naming || 0} />
          <CBar label="Principles" value={cn.principles || 0} />
        </div>
        <div style={{ ...M, fontSize: 10, color: "#D4D4D4", marginTop: 48 }}>Generated by BrandBook</div>
      </div>
    </Spread>
  </div>;
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [brand, setBrand] = useState(null);
  const [sources, setSources] = useState([]);
  const [images, setImages] = useState([]);
  const [brandImages, setBrandImages] = useState([]);
  const [brandLogo, setBrandLogo] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profileSections, setProfileSections] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [pdfFile, setPdfFile] = useState(null);
  const timerRef = useRef([]);
  const pdfInputRef = useRef(null);
  const imgInputRef = useRef(null);

  // IntersectionObserver for active section tracking
  useEffect(() => {
    if (!brand || profileSections.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) setActiveSection(entry.target.id);
      });
    }, { rootMargin: "-72px 0px -60% 0px", threshold: 0 });
    profileSections.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [brand, profileSections]);

  const scrollToTop = useCallback(() => setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 150), []);
  function clearTimers() { timerRef.current.forEach(clearTimeout); timerRef.current = []; }
  function adv(idx) { setSteps(p => p.map((s, i) => i === idx ? { ...s, done: true, active: false } : i === idx + 1 ? { ...s, active: true } : s)); }

  function handleImageUpload(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => setImages(prev => [...prev, reader.result]);
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }

  function handlePdfUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      setPdfFile({ name: file.name, base64, size: file.size });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  const isUrl = (s) => /^https?:\/\//i.test(s.trim());

  async function scrapeUrl(url) {
    const r = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
    if (!r.ok) throw new Error("Could not fetch URL");
    const d = await r.json();
    return d.text || "";
  }

  async function go() {
    const val = input.trim();
    if (!val && !images.length && !pdfFile) return;
    if (loading) return;
    setError(null); setInput(""); setLoading(true); clearTimers();

    if (!brand) {
      const hasImg = images.length > 0;
      const stepLabels = [`Identifying "${val}"…`, "Extracting visual identity"];
      if (hasImg) stepLabels.push("Analyzing uploaded images");
      stepLabels.push("Characterizing voice & tone", "Mapping messaging", "Building full brand profile");
      setSteps(stepLabels.map((l, i) => ({ label: l, active: i === 0, done: false })));
      scrollToTop();
      for (let i = 0; i < stepLabels.length - 1; i++) timerRef.current.push(setTimeout(() => adv(i), 1400 * (i + 1)));

      try {
        const result = await analyze(val);
        clearTimers();
        result.name = result.name || val;
        setBrand(result);
        const s = ["Company name"];
        if (hasImg) s.push(`${images.length} image${images.length > 1 ? "s" : ""}`);
        setSources(s);
        setSteps([]);
        scrollToTop();
        if (result.domain) fetchBrandImages(result.domain).then(d => {
          if (d.logo) setBrandLogo(d.logo);
          if (d.images?.length) setBrandImages(d.images);
        });
      } catch (e) {
        clearTimers(); setError(e.message); setSteps([]);
      } finally { setLoading(false); }

    } else {
      // Determine enrichment type
      const hasPdf = !!pdfFile;
      const hasUrl = isUrl(val);
      const hasImages = images.length > 0;
      const label = hasPdf ? `PDF: ${pdfFile.name}` : hasUrl ? "URL" : hasImages && !val ? "Images" : val.length > 200 ? "Guidelines" : "Context";

      setSources(prev => [...prev, label]);
      const enrichSteps = [
        { label: hasPdf ? `Extracting from ${pdfFile.name}…` : hasUrl ? "Scraping URL…" : "Processing new input…", active: true, done: false },
        { label: "Comparing with profile", active: false, done: false },
        { label: "Updating Brand Book", active: false, done: false },
      ];
      setSteps(enrichSteps);
      scrollToTop();
      timerRef.current.push(setTimeout(() => adv(0), 1500));
      timerRef.current.push(setTimeout(() => adv(1), 3000));

      try {
        let enrichText = val || "";
        let contentBlocks = null;

        if (hasPdf) {
          // Send PDF as document content block
          const sizeInMB = (pdfFile.base64.length * 3 / 4) / (1024 * 1024);
          if (sizeInMB < 4.5) {
            contentBlocks = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfFile.base64 } }];
          } else {
            enrichText = "(Large PDF uploaded — extracting key brand information)";
            contentBlocks = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfFile.base64 } }];
          }
          setPdfFile(null);
        } else if (hasUrl) {
          enrichText = await scrapeUrl(val);
        }

        if (hasImages && images.some(img => img.startsWith("data:"))) {
          const imgBlocks = images.filter(img => img.startsWith("data:")).map(img => {
            const match = img.match(/^data:(image\/[^;]+);base64,(.+)/);
            if (!match) return null;
            return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
          }).filter(Boolean);
          contentBlocks = [...(contentBlocks || []), ...imgBlocks];
          if (!enrichText) enrichText = "(images provided — extract brand-relevant information: colors, typography, layout patterns, photography style, logo usage)";
        }

        const result = await enrich(brand, enrichText, label, contentBlocks);
        clearTimers();
        result.name = result.name || brand.name;
        setBrand(result);
        setSteps([]);
        setImages([]);
        scrollToTop();
      } catch (e) {
        clearTimers(); setError(e.message); setSteps([]);
      } finally { setLoading(false); }
    }
  }

  function reset() { clearTimers(); setBrand(null); setSources([]); setImages([]); setBrandImages([]); setBrandLogo(null); setSteps([]); setError(null); setInput(""); setLoading(false); setSidebarOpen(true); setProfileSections([]); setActiveSection(null); setPdfFile(null); }
  const canSend = (input.trim() || images.length > 0 || pdfFile) && !loading;

  return <div style={{ minHeight: "100vh", background: "#FFF", fontFamily: "'Inter Tight', system-ui, sans-serif", fontSize: 15, color: "#0D0D0D", lineHeight: 1.6 }}>

    {/* Sidebar */}
    {brand && profileSections.length > 0 && <Sidebar sections={profileSections} activeSection={activeSection} open={sidebarOpen} onToggle={() => setSidebarOpen(o => !o)} confidence={brand.confidence} />}

    {/* Topbar */}
    <div style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid #E5E5E5" }}>
      <div style={{ padding: "0 clamp(24px,5vw,56px)", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 700, letterSpacing: "-.02em" }}>
          {brand && profileSections.length > 0 && <button onClick={() => setSidebarOpen(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 2 }} aria-label="Toggle sidebar">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ transition: "transform 250ms ease", transform: sidebarOpen ? "rotate(0deg)" : "rotate(180deg)" }}><path d="M11 4L6 9l5 5" stroke="#0D0D0D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>}
          <svg width="22" height="22" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#0D0D0D"/><rect x="3.5" y="3.5" width="5" height="5" rx="1" fill="#FFF"/><rect x="11.5" y="11.5" width="5" height="5" rx="1" fill="#FFF"/></svg>
          BrandBook
          {brand && <span style={{ fontSize: 13, fontWeight: 400, color: "#999", marginLeft: 4 }}>{brand.name}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {brand && (() => {
            const cn = brand.confidence || {};
            const vals = [cn.colors, cn.type, cn.voice, cn.messaging, cn.logo, cn.photography, cn.naming, cn.principles].filter(v => v != null && v > 0);
            const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
            return avg > 0 && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 40, height: 4, background: "#F0F0F0", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${avg}%`, background: avg > 85 ? "#1A7F37" : avg > 60 ? "#0D0D0D" : "#999", borderRadius: 2 }} />
              </div>
              <span style={{ ...M, fontSize: 10, color: "#999" }}>{avg}%</span>
            </div>;
          })()}
          {brand && <button onClick={reset} style={{ background: "none", border: "1px solid #E5E5E5", padding: "6px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "#5C5C5C", cursor: "pointer", fontFamily: "inherit" }}>New brand</button>}
          <span style={{ ...M, fontSize: 10, color: "#999", letterSpacing: ".08em", textTransform: "uppercase" }}>Prototype</span>
        </div>
      </div>
    </div>

    {/* Content */}
    <div className="main-content" style={{ marginLeft: brand && profileSections.length > 0 && sidebarOpen ? 260 : 0, transition: "margin-left 250ms ease" }}>
      {/* Empty state — centered narrow */}
      {!brand && !loading && steps.length === 0 && <div style={{ maxWidth: 640, margin: "0 auto", padding: `18vh clamp(24px,5vw,56px) 48px` }}>
        <h1 style={{ fontSize: "clamp(40px,7vw,64px)", fontWeight: 800, lineHeight: 1.05, letterSpacing: "-.04em", marginBottom: 20 }}>Start with<br/>a name.</h1>
        <p style={{ fontSize: 17, color: "#5C5C5C", lineHeight: 1.7, maxWidth: 460, fontWeight: 400 }}>BrandBook builds an intelligence profile from whatever you give it. A company name is enough to start. Add guidelines, images, or context to sharpen the picture.</p>
      </div>}

      {/* Steps — centered narrow */}
      {steps.length > 0 && <div style={{ maxWidth: 640, margin: "0 auto", padding: `40px clamp(24px,5vw,56px)` }}>{steps.map((s, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0" }}>
        {s.done ? <span style={{ color: "#1A7F37", fontSize: 16, width: 20, textAlign: "center", fontWeight: 600 }}>&#10003;</span> : s.active ? <Spinner /> : <span style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #E5E5E5", display: "block" }} />}
        <span style={{ fontSize: 14, fontWeight: s.active ? 500 : 400, color: s.done ? "#0D0D0D" : s.active ? "#2A2A2A" : "#999" }}>{s.label}</span>
      </div>)}</div>}

      {/* Profile — full width */}
      {brand && !loading && steps.length === 0 && <Profile brand={brand} sources={sources} images={images} brandImages={brandImages} brandLogo={brandLogo} onSections={setProfileSections} />}

      {/* Error */}
      {error && <div style={{ maxWidth: 640, margin: "0 auto", padding: `0 clamp(24px,5vw,56px)` }}><div style={{ padding: "14px 18px", background: "#FFF0F0", borderRadius: 10, marginBottom: 16, fontSize: 14, color: "#CF222E", fontWeight: 500 }}>{error}</div></div>}

      <div style={{ height: 120 }} />
    </div>

    {/* Hidden file inputs */}
    <input ref={imgInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleImageUpload} />
    <input ref={pdfInputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handlePdfUpload} />

    {/* Input bar */}
    <div className="input-bar-wrapper" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, background: "#FFF", borderTop: "1px solid #E5E5E5", boxShadow: "0 -2px 12px rgba(0,0,0,.04)", padding: "16px 0", marginLeft: brand && profileSections.length > 0 && sidebarOpen ? 260 : 0, transition: "margin-left 250ms ease" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 clamp(24px,5vw,56px)" }}>
        <div style={{ background: "#FFF", border: "1px solid #E5E5E5", borderRadius: 14, padding: "16px 20px", boxShadow: "0 2px 8px rgba(0,0,0,.03)" }}>
          {/* Queued images + PDF chips */}
          {(images.length > 0 || pdfFile) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {images.map((img, i) => <div key={i} style={{ position: "relative", width: 56, height: 56, borderRadius: 8, overflow: "hidden", border: "1px solid #E5E5E5" }}>
              <img src={img} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
              <button onClick={() => setImages(p => p.filter((_, j) => j !== i))} style={{ position: "absolute", top: -4, right: -4, width: 18, height: 18, borderRadius: "50%", background: "#0D0D0D", color: "#FFF", border: "none", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>&times;</button>
            </div>)}
            {pdfFile && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "#F5F5F5", borderRadius: 8, border: "1px solid #E5E5E5" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8 1H3.5A1.5 1.5 0 002 2.5v9A1.5 1.5 0 003.5 13h7a1.5 1.5 0 001.5-1.5V5L8 1z" stroke="#CF222E" strokeWidth="1.2" /><path d="M8 1v4h4" stroke="#CF222E" strokeWidth="1.2" /></svg>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#2A2A2A", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pdfFile.name}</span>
              <button onClick={() => setPdfFile(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 14, color: "#999", lineHeight: 1 }}>&times;</button>
            </div>}
          </div>}
          {/* URL indicator */}
          {isUrl(input.trim()) && <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M5 7a2.5 2.5 0 003.5 0l1-1a2.5 2.5 0 00-3.5-3.5l-.5.5" stroke="#2563EB" strokeWidth="1.2" strokeLinecap="round" /><path d="M7 5a2.5 2.5 0 00-3.5 0l-1 1a2.5 2.5 0 003.5 3.5l.5-.5" stroke="#2563EB" strokeWidth="1.2" strokeLinecap="round" /></svg>
            <span style={{ fontSize: 11, color: "#2563EB", fontWeight: 500 }}>URL detected — will scrape for brand data</span>
          </div>}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            {brand && <>
              <button onClick={() => imgInputRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #E5E5E5", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 500, color: "#5C5C5C", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" /><circle cx="4" cy="4.5" r="1" fill="currentColor" /><path d="M1 9l2.5-3 2 2 1.5-1.5L11 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Image
              </button>
              <button onClick={() => pdfInputRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #E5E5E5", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 500, color: "#5C5C5C", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7 1H3a1.5 1.5 0 00-1.5 1.5v7A1.5 1.5 0 003 11h6a1.5 1.5 0 001.5-1.5V4.5L7 1z" stroke="currentColor" strokeWidth="1.2" /><path d="M7 1v3.5h3.5" stroke="currentColor" strokeWidth="1.2" /></svg>
                PDF
              </button>
            </>}
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }}
              placeholder={!brand ? "Enter a company name to start…" : "Paste guidelines, URLs, or context to enrich…"}
              rows={1} style={{ flex: 1, border: "none", outline: "none", resize: "none", fontSize: 15, fontFamily: "'Inter Tight',sans-serif", color: "#0D0D0D", background: "transparent", lineHeight: 1.5, minHeight: 24, maxHeight: 120, padding: "0 0 0 4px", fontWeight: 400 }} />
            <button onClick={go} disabled={!canSend} style={{
              width: 38, height: 38, borderRadius: 10, border: "none",
              background: canSend ? "#0D0D0D" : "#E5E5E5", color: canSend ? "#FFF" : "#999",
              cursor: loading ? "wait" : canSend ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              {loading ? <Spinner /> : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13L13 3M13 3H5M13 3V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
          </div>
        </div>
        {brand && <div style={{ textAlign: "center", marginTop: 8 }}><span style={{ fontSize: 11, color: "#D4D4D4", fontWeight: 400 }}>Upload PDFs, paste URLs or guidelines, add images to deepen the profile</span></div>}
      </div>
    </div>
  </div>;
}
