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

// ─── Profile ─────────────────────────────────────────────────────────────────

function Profile({ brand, sources, images, brandImages, brandLogo }) {
  const colors = Array.isArray(brand.colors) ? brand.colors : [...(brand.colors?.primary || []), ...(brand.colors?.secondary || [])];
  const cn = brand.confidence || {};
  const primaryColor = colors[0]?.hex || "#0D0D0D";

  const sections = [
    colors.length > 0 && { num: "01", title: "Color Palette" },
    brand.typography?.primary && { num: "02", title: "Typography" },
    (brand.voice?.words?.length > 0 || brand.voice?.do?.length > 0) && { num: "03", title: "Voice & Tone" },
    brand.messaging?.proposition && { num: "04", title: "Messaging" },
    (brand.competitive || brand.audience) && { num: "05", title: "Competitive Landscape" },
    brandImages.length > 0 && { num: "06", title: "Brand Imagery" },
  ].filter(Boolean);

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
        {brand.personality?.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>{brand.personality.map((p, i) => <Tag key={i}>{p}</Tag>)}</div>}
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

    {/* ═══ Table of Contents ═══ */}
    <Spread minH="60vh" bg="#F5F5F5">
      <h2 style={{ fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 800, letterSpacing: "-.04em", marginBottom: 56 }}>Contents</h2>
      <div>
        {sections.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 24, padding: "20px 0", borderBottom: "1px solid #E0E0E0" }}>
            <span style={{ ...M, fontSize: "clamp(32px, 4vw, 48px)", fontWeight: 300, color: "#E0E0E0", minWidth: 80 }}>{s.num}</span>
            <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.01em" }}>{s.title}</span>
          </div>
        ))}
      </div>
    </Spread>

    {/* ═══ 01 Color Palette ═══ */}
    {colors.length > 0 && <>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "32px 48px" }}>
          {colors.slice(0, 6).map((c, i) => <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: c.hex || "#ccc", flexShrink: 0, border: (c.hex || "").toUpperCase().includes("FFF") ? "1px solid #E5E5E5" : "none" }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{c.name}</div>
              <div style={{ ...M, fontSize: 12, color: "#999" }}>{c.hex}</div>
              {c.role && <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>{c.role}</div>}
            </div>
          </div>)}
        </div>
      </Spread>
    </>}

    {/* ═══ 02 Typography ═══ */}
    {brand.typography?.primary && <>
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
        {(brand.typography.rules || []).length > 0 && <div>
          <SectionLabel>Usage Rules</SectionLabel>
          {brand.typography.rules.map((r, i) => <div key={i} style={{ display: "flex", gap: 16, alignItems: "baseline", padding: "16px 0", borderBottom: "1px solid #E5E5E5", fontSize: 15, color: "#2A2A2A", lineHeight: 1.65 }}>
            <span style={{ ...M, fontSize: 11, color: "#D4D4D4", flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
            {r}
          </div>)}
        </div>}
      </Spread>
    </>}

    {/* ═══ 03 Voice & Tone ═══ */}
    {(brand.voice?.words?.length > 0 || brand.voice?.do?.length > 0) && <>
      <SectionDivider num={3} title="Voice & Tone" brandName={brand.name} />
      <Spread>
        {/* Tone words — large scale 2x2 grid */}
        {brand.voice.words?.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 56 }}>
          {brand.voice.words.map((w, i) => <div key={i} style={{
            padding: "48px 40px",
            background: i % 2 === 0 ? "#F5F5F5" : "#EBEBEB",
            borderBottom: i < 2 ? "none" : "none",
          }}>
            <div style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-.02em" }}>{w}</div>
          </div>)}
        </div>}
        {/* Do / Don't */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {brand.voice.do?.length > 0 && <div style={{ background: "#ECFDF3", padding: "36px 40px", minHeight: 300 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#1A7F37", marginBottom: 24 }}>The brand does</div>
            {brand.voice.do.map((v, i) => <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", fontSize: 15, color: "#2A2A2A", lineHeight: 1.6 }}>
              <span style={{ color: "#1A7F37", fontWeight: 700, flexShrink: 0, fontSize: 16 }}>+</span><span>{v}</span>
            </div>)}
          </div>}
          {brand.voice.dont?.length > 0 && <div style={{ background: "#FFF0F0", padding: "36px 40px", minHeight: 300 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#CF222E", marginBottom: 24 }}>The brand avoids</div>
            {brand.voice.dont.map((v, i) => <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", fontSize: 15, color: "#2A2A2A", lineHeight: 1.6 }}>
              <span style={{ color: "#CF222E", fontWeight: 700, flexShrink: 0, fontSize: 16 }}>&minus;</span><span>{v}</span>
            </div>)}
          </div>}
        </div>
      </Spread>
    </>}

    {/* ═══ 04 Messaging ═══ */}
    {brand.messaging?.proposition && <>
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
        {brand.messaging.pillars?.length > 0 && <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(brand.messaging.pillars.length, 3)}, 1fr)`, gap: 32, marginBottom: 40 }}>
          {brand.messaging.pillars.map((p, i) => <div key={i} style={{ borderLeft: "3px solid #0D0D0D", paddingLeft: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, letterSpacing: "-.01em" }}>{typeof p === "string" ? p : p.title || ""}</div>
            {typeof p === "object" && p.desc && <div style={{ fontSize: 14, color: "#5C5C5C", lineHeight: 1.65 }}>{p.desc}</div>}
          </div>)}
        </div>}
        {brand.messaging.forbidden?.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 24, borderTop: "1px solid #E5E5E5" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#CF222E", letterSpacing: ".06em", textTransform: "uppercase", marginRight: 8 }}>Never say</span>
          {brand.messaging.forbidden.map((f, i) => <Tag key={i} red>{f}</Tag>)}
        </div>}
      </Spread>
    </>}

    {/* ═══ 05 Competitive Landscape ═══ */}
    {(brand.competitive || brand.competitors?.length > 0 || brand.audience) && <>
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
            {brand.competitive?.threats?.length > 0 && <div style={{ padding: "24px 28px", background: "#FFF8E1" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#9A6700", marginBottom: 8 }}>Competitive risks</div>
              {brand.competitive.threats.map((t, i) => <div key={i} style={{ fontSize: 14, color: "#2A2A2A", lineHeight: 1.65, marginBottom: 4 }}>{t}</div>)}
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
    </>}

    {/* ═══ 06 Brand Imagery ═══ */}
    {brandImages.length > 0 && <>
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
    </>}

    {/* ═══ Insights ═══ */}
    {brand.insights?.length > 0 && <Spread minH="auto" bg="#FFF">
      <SectionLabel>Cross-source insights</SectionLabel>
      {brand.insights.map((ins, i) => <div key={i} style={{ padding: "16px 24px", background: "#EFF6FF", marginBottom: 8, fontSize: 14, color: "#2A2A2A", lineHeight: 1.65, borderLeft: "3px solid #2563EB" }}>{ins}</div>)}
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
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 clamp(24px,5vw,56px)", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
    <div>
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
      {brand && !loading && steps.length === 0 && <Profile brand={brand} sources={sources} images={images} brandImages={brandImages} brandLogo={brandLogo} />}

      {/* Error */}
      {error && <div style={{ maxWidth: 640, margin: "0 auto", padding: `0 clamp(24px,5vw,56px)` }}><div style={{ padding: "14px 18px", background: "#FFF0F0", borderRadius: 10, marginBottom: 16, fontSize: 14, color: "#CF222E", fontWeight: 500 }}>{error}</div></div>}

      <div ref={bRef} style={{ height: 160 }} />
    </div>

    {/* Input bar */}
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, background: "linear-gradient(transparent, #FFF 28px)", padding: "28px 0 24px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 clamp(24px,5vw,56px)" }}>
        <div style={{ background: "#FFF", border: "1px solid #E5E5E5", borderRadius: 14, padding: 14, boxShadow: "0 4px 24px rgba(0,0,0,.06)" }}>
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
