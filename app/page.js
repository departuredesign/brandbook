"use client";
import { useState, useRef, useCallback } from "react";

// ─── API ─────────────────────────────────────────────────────────────────────

async function callClaude(messages, system) {
  const r = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4096, system, messages }),
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
const SCHEMA = `{"name":"","domain":"","tagline":"","summary":"","personality":[],"colors":[{"name":"","hex":"","role":""}],"typography":{"primary":"","secondary":"","rules":[]},"voice":{"words":[],"do":[],"dont":[]},"messaging":{"proposition":"","pillars":[{"title":"","desc":""}],"forbidden":[]},"audience":"","competitive":{"positioning":"","competitors":[{"name":"","hex":"","tone":"","overlap":""}],"whitespace":"","threats":[]},"confidence":{"colors":0,"type":0,"voice":0,"messaging":0}}`;

async function analyze(name) {
  const raw = await callClaude([{
    role: "user",
    content: `Analyze the brand "${name}". Build a profile with:
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
- confidence (0-100 for colors/type/voice/messaging)

Return ONLY:\n${SCHEMA}`
  }], SYS);
  const r = tryParse(raw);
  if (!r) throw new Error("Could not parse — try again.");
  return r;
}

async function enrich(existing, text, label) {
  const raw = await callClaude([{
    role: "user",
    content: `Existing profile for "${existing.name}":\n${JSON.stringify(existing)}\n\nNew input (${label}):\n${text.slice(0, 3000)}\n\nMerge new data. Replace inferred with authoritative. Raise confidence. Preserve and update competitive analysis if relevant. Add 1-2 "insights" noting what changed.\n\nReturn ONLY:\n${SCHEMA.slice(0, -1)},"insights":[]}`
  }], SYS);
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

// ─── Components ──────────────────────────────────────────────────────────────

const M = { fontFamily: "'IBM Plex Mono', monospace" };

function Spinner({ sz = 14 }) {
  return <div style={{ width: sz, height: sz, border: "1.5px solid #E5E5E5", borderTopColor: "#0D0D0D", borderRadius: "50%", animation: "spin .5s linear infinite", flexShrink: 0 }} />;
}

function Tag({ children, red, blue }) {
  const bg = red ? "#FFF0F0" : blue ? "#EFF6FF" : "#F5F5F5";
  const color = red ? "#CF222E" : blue ? "#2563EB" : "#5C5C5C";
  const bdr = red ? "rgba(207,34,46,.12)" : blue ? "rgba(37,99,235,.12)" : "#E5E5E5";
  return <span style={{ display: "inline-block", padding: "4px 12px", borderRadius: 4, fontSize: 12, fontWeight: 500, letterSpacing: ".02em", background: bg, color, border: `1px solid ${bdr}` }}>{children}</span>;
}

function SectionHeader({ num, title, dark }) {
  if (dark) {
    return <div style={{ background: "#0D0D0D", color: "#FFF", padding: "48px 40px", borderRadius: 12, marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        {num && <span style={{ ...M, fontSize: 11, color: "#666", letterSpacing: ".08em" }}>{String(num).padStart(2, "0")}</span>}
        <h2 style={{ fontSize: "clamp(28px,4vw,40px)", fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1.1 }}>{title}</h2>
      </div>
    </div>;
  }
  return <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 24, paddingBottom: 12, borderBottom: "2px solid #0D0D0D" }}>
    {num && <span style={{ ...M, fontSize: 11, color: "#999", letterSpacing: ".08em" }}>{String(num).padStart(2, "0")}</span>}
    <h2 style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#0D0D0D" }}>{title}</h2>
  </div>;
}

function CBar({ label, value }) {
  const c = value > 85 ? "#1A7F37" : value > 60 ? "#0D0D0D" : "#999";
  return <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
    <span style={{ ...M, fontSize: 11, color: "#999", minWidth: 72 }}>{label}</span>
    <div style={{ flex: 1, height: 4, background: "#F0F0F0", borderRadius: 2, overflow: "hidden", maxWidth: 220 }}>
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

// ─── Profile ─────────────────────────────────────────────────────────────────

function Profile({ brand, sources, images, brandImages, brandLogo }) {
  const colors = Array.isArray(brand.colors) ? brand.colors : [...(brand.colors?.primary || []), ...(brand.colors?.secondary || [])];
  const cn = brand.confidence || {};

  return <div style={{ paddingTop: 40, paddingBottom: 32, animation: "fadeIn .5s ease-out" }}>
    {/* Header */}
    <div style={{ marginBottom: 48 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {(brandLogo || brand.domain) && <img src={brandLogo || `https://www.google.com/s2/favicons?domain=${brand.domain}&sz=128`} alt="" style={{ height: 52, maxWidth: 160, borderRadius: 10, border: "1px solid #E5E5E5", objectFit: "contain", background: "#FFF", padding: 6 }} onError={e => { e.target.style.display = "none"; }} />}
          <div>
            <h1 style={{ fontSize: "clamp(40px,7vw,64px)", fontWeight: 800, letterSpacing: "-.04em", lineHeight: .9 }}>{brand.name}</h1>
            {brand.tagline && <p style={{ fontSize: 16, fontWeight: 400, color: "#5C5C5C", marginTop: 8, fontStyle: "italic" }}>{brand.tagline}</p>}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>{sources.map((s, i) => <SourcePill key={i} label={s} />)}</div>
      {brand.summary && <p style={{ fontSize: 16, color: "#2A2A2A", lineHeight: 1.7, maxWidth: 600 }}>{brand.summary}</p>}
      {brand.personality?.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>{brand.personality.map((p, i) => <Tag key={i}>{p}</Tag>)}</div>}
      {images.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>{images.map((img, i) => <img key={i} src={img} style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #E5E5E5" }} />)}</div>}
    </div>

    {/* Table of Contents */}
    <div style={{ background: "#F5F5F5", borderRadius: 12, padding: "28px 32px", marginBottom: 48 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "#999", marginBottom: 16 }}>Brand Guide</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 32px" }}>
        {[
          colors.length > 0 && "01  Color Palette",
          brand.typography?.primary && "02  Typography",
          (brand.voice?.words?.length > 0 || brand.voice?.do?.length > 0) && "03  Voice & Tone",
          brand.messaging?.proposition && "04  Messaging",
          (brand.competitive || brand.audience) && "05  Competitive",
          brandImages.length > 0 && "06  Imagery"
        ].filter(Boolean).map((item, i) => (
          <div key={i} style={{ ...M, fontSize: 12, color: "#5C5C5C", padding: "4px 0" }}>{item}</div>
        ))}
      </div>
    </div>

    {/* Colors */}
    {colors.length > 0 && <div style={{ marginBottom: 56 }}>
      <SectionHeader num={1} title="Color Palette" dark />
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(colors.length, 6)}, 1fr)`, gap: 0, borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
        {colors.slice(0, 6).map((c, i) => <div key={i} style={{ height: 80, background: c.hex || "#ccc", border: (c.hex || "").toUpperCase().includes("FFF") ? "1px solid #E5E5E5" : "none" }} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(colors.length, 6)}, 1fr)`, gap: 16 }}>
        {colors.slice(0, 6).map((c, i) => <div key={i}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{c.name}</div>
          <div style={{ ...M, fontSize: 11, color: "#999" }}>{c.hex}</div>
          {c.role && <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{c.role}</div>}
        </div>)}
      </div>
    </div>}

    {/* Typography */}
    {brand.typography?.primary && <div style={{ marginBottom: 56 }}>
      <SectionHeader num={2} title="Typography" dark />
      <div style={{ display: "grid", gridTemplateColumns: brand.typography.secondary && brand.typography.secondary !== "null" ? "1fr 1fr" : "1fr", gap: 32, marginBottom: 28 }}>
        <div>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#999", marginBottom: 12 }}>Primary</div>
          <div style={{ fontSize: "clamp(32px,5vw,48px)", fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1.1 }}>{brand.typography.primary}</div>
        </div>
        {brand.typography.secondary && brand.typography.secondary !== "null" && <div>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#999", marginBottom: 12 }}>Secondary</div>
          <div style={{ fontSize: "clamp(24px,4vw,36px)", fontWeight: 300, letterSpacing: "-.02em", lineHeight: 1.1 }}>{brand.typography.secondary}</div>
        </div>}
      </div>
      {(brand.typography.rules || []).length > 0 && <div style={{ borderTop: "1px solid #E5E5E5" }}>
        {brand.typography.rules.map((r, i) => <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid #E5E5E5", fontSize: 14, color: "#2A2A2A", lineHeight: 1.65, display: "flex", gap: 12, alignItems: "baseline" }}>
          <span style={{ ...M, fontSize: 10, color: "#D4D4D4", flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
          {r}
        </div>)}
      </div>}
    </div>}

    {/* Voice & Tone */}
    {(brand.voice?.words?.length > 0 || brand.voice?.do?.length > 0) && <div style={{ marginBottom: 56 }}>
      <SectionHeader num={3} title="Voice & Tone" dark />
      {brand.voice.words?.length > 0 && <div style={{ display: "flex", gap: 0, marginBottom: 28, borderRadius: 12, overflow: "hidden" }}>
        {brand.voice.words.map((w, i) => <div key={i} style={{ flex: 1, padding: "20px 16px", background: i % 2 === 0 ? "#F5F5F5" : "#EBEBEB", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em" }}>{w}</div>
        </div>)}
      </div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {brand.voice.do?.length > 0 && <div style={{ background: "#ECFDF3", borderRadius: 12, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#1A7F37", marginBottom: 16 }}>The brand does</div>
          {brand.voice.do.map((v, i) => <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", fontSize: 14, color: "#2A2A2A", lineHeight: 1.55 }}>
            <span style={{ color: "#1A7F37", fontWeight: 700, flexShrink: 0 }}>+</span><span>{v}</span>
          </div>)}
        </div>}
        {brand.voice.dont?.length > 0 && <div style={{ background: "#FFF0F0", borderRadius: 12, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#CF222E", marginBottom: 16 }}>The brand avoids</div>
          {brand.voice.dont.map((v, i) => <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", fontSize: 14, color: "#2A2A2A", lineHeight: 1.55 }}>
            <span style={{ color: "#CF222E", fontWeight: 700, flexShrink: 0 }}>&minus;</span><span>{v}</span>
          </div>)}
        </div>}
      </div>
    </div>}

    {/* Messaging */}
    {brand.messaging?.proposition && <div style={{ marginBottom: 56 }}>
      <SectionHeader num={4} title="Messaging" dark />
      <div style={{ padding: "32px 36px", background: "#0D0D0D", color: "#FFF", borderRadius: 12, marginBottom: 24 }}>
        <div style={{ ...M, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#666", marginBottom: 12 }}>Core proposition</div>
        <p style={{ fontSize: "clamp(18px,3vw,24px)", fontWeight: 300, fontStyle: "italic", lineHeight: 1.45, letterSpacing: "-.01em" }}>{brand.messaging.proposition}</p>
      </div>
      {brand.messaging.pillars?.length > 0 && <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(brand.messaging.pillars.length, 3)}, 1fr)`, gap: 12, marginBottom: 20 }}>
        {brand.messaging.pillars.map((p, i) => <div key={i} style={{ padding: "24px", background: "#F5F5F5", borderRadius: 12, borderTop: "3px solid #0D0D0D" }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, letterSpacing: "-.01em" }}>{typeof p === "string" ? p : p.title || ""}</div>
          {typeof p === "object" && p.desc && <div style={{ fontSize: 13, color: "#5C5C5C", lineHeight: 1.6 }}>{p.desc}</div>}
        </div>)}
      </div>}
      {brand.messaging.forbidden?.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#CF222E", letterSpacing: ".06em", textTransform: "uppercase", marginRight: 4 }}>Never say</span>
        {brand.messaging.forbidden.map((f, i) => <Tag key={i} red>{f}</Tag>)}
      </div>}
    </div>}

    {/* Competitive Analysis */}
    {(brand.competitive || brand.competitors?.length > 0 || brand.audience) && <div style={{ marginBottom: 56 }}>
      <SectionHeader num={5} title="Competitive Landscape" dark />

      {brand.audience && <div style={{ marginBottom: 28 }}>
        <div style={{ ...M, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#999", marginBottom: 8 }}>Audience</div>
        <div style={{ fontSize: 15, color: "#2A2A2A", lineHeight: 1.7 }}>{typeof brand.audience === "string" ? brand.audience : brand.audience?.primary || ""}</div>
      </div>}

      {brand.competitive?.positioning && <div style={{ padding: "24px 28px", background: "#F5F5F5", borderRadius: 12, marginBottom: 28 }}>
        <div style={{ ...M, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#999", marginBottom: 8 }}>Positioning</div>
        <div style={{ fontSize: 15, color: "#2A2A2A", lineHeight: 1.7 }}>{brand.competitive.positioning}</div>
      </div>}

      {(brand.competitive?.competitors?.length > 0 || brand.competitors?.length > 0) && (() => {
        const comps = brand.competitive?.competitors || brand.competitors?.map(c => typeof c === "string" ? { name: c } : c) || [];
        return <div style={{ marginBottom: 28 }}>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#999", marginBottom: 16 }}>Competitor Comparison</div>

          <div style={{ display: "flex", gap: 0, marginBottom: 20, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ flex: 2, height: 48, background: (brand.colors?.[0]?.hex || brand.colors?.primary?.[0]?.hex || "#0D0D0D"), display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#FFF", textShadow: "0 1px 2px rgba(0,0,0,.3)" }}>{brand.name}</span>
            </div>
            {comps.slice(0, 4).map((comp, i) =>
              <div key={i} style={{ flex: 1, height: 48, background: comp.hex || ["#1877F2", "#E60023", "#FF9900", "#0A66C2"][i] || "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: "#FFF", textShadow: "0 1px 2px rgba(0,0,0,.3)", textAlign: "center", padding: "0 4px" }}>{comp.name?.split(" ")[0]}</span>
              </div>
            )}
          </div>

          <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #E5E5E5" }}>
            {comps.map((comp, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "12px 1fr 1fr 2fr", gap: 16, alignItems: "center", padding: "14px 20px", borderBottom: i < comps.length - 1 ? "1px solid #E5E5E5" : "none", background: i % 2 === 0 ? "#FAFAFA" : "#FFF" }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: comp.hex || ["#1877F2", "#E60023", "#FF9900", "#0A66C2"][i] || "#888" }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>{comp.name || comp}</div>
              <div style={{ fontSize: 12, color: "#5C5C5C", fontWeight: 500 }}>{comp.tone || ""}</div>
              <div style={{ fontSize: 13, color: "#999" }}>{comp.overlap || ""}</div>
            </div>)}
          </div>
        </div>;
      })()}

      {(brand.competitive?.whitespace || brand.competitive?.threats?.length > 0) && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {brand.competitive.whitespace && <div style={{ padding: "24px", background: "#ECFDF3", borderRadius: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#1A7F37", marginBottom: 8 }}>Whitespace owned</div>
          <div style={{ fontSize: 14, color: "#2A2A2A", lineHeight: 1.65 }}>{brand.competitive.whitespace}</div>
        </div>}
        {brand.competitive.threats?.length > 0 && <div style={{ padding: "24px", background: "#FFF8E1", borderRadius: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#9A6700", marginBottom: 8 }}>Competitive risks</div>
          {brand.competitive.threats.map((t, i) => <div key={i} style={{ fontSize: 14, color: "#2A2A2A", lineHeight: 1.65, marginBottom: 4 }}>{t}</div>)}
        </div>}
      </div>}
    </div>}

    {/* Brand Imagery */}
    {brandImages.length > 0 && <div style={{ marginBottom: 56 }}>
      <SectionHeader num={6} title="Brand Imagery" dark />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {brandImages.map((url, i) => <div key={i} style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #E5E5E5", background: "#F5F5F5" }}>
          <img src={url} alt="" style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }} onError={e => { e.target.parentElement.style.display = "none"; }} />
        </div>)}
      </div>
      {brand.domain && <div style={{ ...M, fontSize: 10, color: "#D4D4D4", marginTop: 8 }}>Sourced from {brand.domain}</div>}
    </div>}

    {/* Insights */}
    {brand.insights?.length > 0 && <div style={{ marginBottom: 48 }}>
      <SectionHeader title="Cross-source insights" />
      {brand.insights.map((ins, i) => <div key={i} style={{ padding: "16px 20px", background: "#EFF6FF", borderRadius: 10, marginBottom: 8, fontSize: 14, color: "#2A2A2A", lineHeight: 1.65, borderLeft: "3px solid #2563EB" }}>{ins}</div>)}
    </div>}

    {/* Confidence */}
    <div style={{ marginBottom: 32 }}>
      <SectionHeader title="Confidence" />
      <CBar label="Colors" value={cn.colors || 0} />
      <CBar label="Type" value={cn.type || cn.typography || 0} />
      <CBar label="Voice" value={cn.voice || 0} />
      <CBar label="Messaging" value={cn.messaging || 0} />
    </div>
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
  const bRef = useRef(null);
  const timerRef = useRef([]);

  const scroll = useCallback(() => setTimeout(() => bRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 150), []);
  function clearTimers() { timerRef.current.forEach(clearTimeout); timerRef.current = []; }
  function adv(idx) { setSteps(p => p.map((s, i) => i === idx ? { ...s, done: true, active: false } : i === idx + 1 ? { ...s, active: true } : s)); }

  function addImage() {
    const labels = ["Billboard", "App UI", "Packaging", "Campaign", "Website", "Social Post"];
    setImages(prev => [...prev, placeholderSvg(labels[prev.length % labels.length])]);
  }

  async function go() {
    const val = input.trim();
    if (!val && !images.length) return;
    if (loading) return;
    setError(null); setInput(""); setLoading(true); clearTimers();

    if (!brand) {
      const hasImg = images.length > 0;
      const stepLabels = [`Identifying "${val}"…`, "Extracting visual identity"];
      if (hasImg) stepLabels.push("Analyzing uploaded images");
      stepLabels.push("Characterizing voice & tone", "Mapping messaging");
      setSteps(stepLabels.map((l, i) => ({ label: l, active: i === 0, done: false })));
      scroll();
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
        scroll();
        if (result.domain) fetchBrandImages(result.domain).then(d => {
          if (d.logo) setBrandLogo(d.logo);
          if (d.images?.length) setBrandImages(d.images);
        });
      } catch (e) {
        clearTimers(); setError(e.message); setSteps([]);
      } finally { setLoading(false); }

    } else {
      const label = images.length > 0 && !val ? "Images" : val.length > 200 ? "Guidelines" : "Context";
      setSources(prev => [...prev, label]);
      setSteps([
        { label: "Processing new input…", active: true, done: false },
        { label: "Comparing with profile", active: false, done: false },
        { label: "Updating Brand Book", active: false, done: false },
      ]);
      scroll();
      timerRef.current.push(setTimeout(() => adv(0), 1500));
      timerRef.current.push(setTimeout(() => adv(1), 3000));

      try {
        const result = await enrich(brand, val || "(additional images provided)", label);
        clearTimers();
        result.name = result.name || brand.name;
        setBrand(result);
        setSteps([]);
        scroll();
      } catch (e) {
        clearTimers(); setError(e.message); setSteps([]);
      } finally { setLoading(false); }
    }
  }

  function reset() { clearTimers(); setBrand(null); setSources([]); setImages([]); setBrandImages([]); setBrandLogo(null); setSteps([]); setError(null); setInput(""); setLoading(false); }
  const canSend = (input.trim() || images.length > 0) && !loading;

  return <div style={{ minHeight: "100vh", background: "#FFF", fontFamily: "'Inter Tight', system-ui, sans-serif", fontSize: 15, color: "#0D0D0D", lineHeight: 1.6 }}>

    {/* Topbar */}
    <div style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid #E5E5E5" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 clamp(24px,5vw,56px)", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 700, letterSpacing: "-.02em" }}>
          <svg width="22" height="22" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#0D0D0D"/><rect x="3.5" y="3.5" width="5" height="5" rx="1" fill="#FFF"/><rect x="11.5" y="11.5" width="5" height="5" rx="1" fill="#FFF"/></svg>
          BrandBook
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {brand && <button onClick={reset} style={{ background: "none", border: "1px solid #E5E5E5", padding: "6px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "#5C5C5C", cursor: "pointer", fontFamily: "inherit" }}>New brand</button>}
          <span style={{ ...M, fontSize: 10, color: "#999", letterSpacing: ".08em", textTransform: "uppercase" }}>Prototype</span>
        </div>
      </div>
    </div>

    {/* Content */}
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 clamp(24px,5vw,56px)" }}>
      {/* Empty state */}
      {!brand && !loading && steps.length === 0 && <div style={{ paddingTop: "18vh", paddingBottom: 48 }}>
        <h1 style={{ fontSize: "clamp(36px,6vw,56px)", fontWeight: 800, lineHeight: 1.05, letterSpacing: "-.04em", marginBottom: 20 }}>Start with<br/>a name.</h1>
        <p style={{ fontSize: 17, color: "#5C5C5C", lineHeight: 1.7, maxWidth: 460, fontWeight: 400 }}>BrandBook builds an intelligence profile from whatever you give it. A company name is enough to start. Add guidelines, images, or context to sharpen the picture.</p>
      </div>}

      {/* Steps */}
      {steps.length > 0 && <div style={{ padding: "40px 0" }}>{steps.map((s, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0" }}>
        {s.done ? <span style={{ color: "#1A7F37", fontSize: 16, width: 20, textAlign: "center", fontWeight: 600 }}>&#10003;</span> : s.active ? <Spinner /> : <span style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid #E5E5E5", display: "block" }} />}
        <span style={{ fontSize: 14, fontWeight: s.active ? 500 : 400, color: s.done ? "#0D0D0D" : s.active ? "#2A2A2A" : "#999" }}>{s.label}</span>
      </div>)}</div>}

      {/* Profile */}
      {brand && !loading && steps.length === 0 && <Profile brand={brand} sources={sources} images={images} brandImages={brandImages} brandLogo={brandLogo} />}

      {/* Error */}
      {error && <div style={{ padding: "14px 18px", background: "#FFF0F0", borderRadius: 10, marginBottom: 16, fontSize: 14, color: "#CF222E", fontWeight: 500 }}>{error}</div>}

      <div ref={bRef} style={{ height: 160 }} />
    </div>

    {/* Input bar */}
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, background: "linear-gradient(transparent, #FFF 28px)", padding: "28px 0 24px" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 clamp(24px,5vw,56px)" }}>
        <div style={{ background: "#FFF", border: "1px solid #E5E5E5", borderRadius: 14, padding: 14, boxShadow: "0 4px 24px rgba(0,0,0,.06)" }}>
          {/* Attached images */}
          {images.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {images.map((img, i) => <div key={i} style={{ position: "relative", width: 56, height: 56, borderRadius: 8, overflow: "hidden", border: "1px solid #E5E5E5" }}>
              <img src={img} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button onClick={() => setImages(p => p.filter((_, j) => j !== i))} style={{ position: "absolute", top: -4, right: -4, width: 18, height: 18, borderRadius: "50%", background: "#0D0D0D", color: "#FFF", border: "none", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>&times;</button>
            </div>)}
          </div>}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            {brand && <button onClick={addImage} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #E5E5E5", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 500, color: "#5C5C5C", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
              Image
            </button>}
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }}
              placeholder={!brand ? "Enter a company name to start…" : "Add more — paste guidelines, describe assets, add context…"}
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
        {brand && <div style={{ textAlign: "center", marginTop: 10 }}><span style={{ fontSize: 11, color: "#D4D4D4", fontWeight: 400 }}>Paste guidelines, add images, or add context to deepen the profile</span></div>}
      </div>
    </div>
  </div>;
}
