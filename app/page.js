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
  // Fix truncated JSON
  let a = c;
  const ob = (a.match(/\[/g) || []).length - (a.match(/\]/g) || []).length;
  const cb = (a.match(/\{/g) || []).length - (a.match(/\}/g) || []).length;
  for (let i = 0; i < ob; i++) a += "]";
  for (let i = 0; i < cb; i++) a += "}";
  a = a.replace(/,\s*(\]|\})/g, "$1");
  try { return JSON.parse(a); } catch {}
  // Extract first JSON object
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
  if (!domain) return [];
  try {
    const r = await fetch(`/api/brand-images?domain=${encodeURIComponent(domain)}`);
    const d = await r.json();
    return d.images || [];
  } catch { return []; }
}

function placeholderSvg(label, w = 240, h = 160) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#EDECE8" rx="4"/><rect x="${w * .12}" y="${h * .15}" width="${w * .76}" height="${h * .4}" rx="3" fill="#DDDCD8"/><rect x="${w * .12}" y="${h * .65}" width="${w * .45}" height="${h * .06}" rx="2" fill="#DDDCD8"/><rect x="${w * .12}" y="${h * .76}" width="${w * .3}" height="${h * .06}" rx="2" fill="#DDDCD8"/><text x="${w / 2}" y="${h * .4}" text-anchor="middle" font-family="system-ui" font-size="11" fill="#A8A8A0">${label}</text></svg>`)}`;
}

// ─── Components ──────────────────────────────────────────────────────────────

const M = { fontFamily: "'IBM Plex Mono', monospace" };
const DF = "'DM Serif Display', Georgia, serif";

function Spinner({ sz = 14 }) {
  return <div style={{ width: sz, height: sz, border: "1.5px solid #E6E4DF", borderTopColor: "#111", borderRadius: "50%", animation: "spin .5s linear infinite", flexShrink: 0 }} />;
}

function Tag({ children, red }) {
  return <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 4, fontSize: 12, ...M, letterSpacing: ".03em", background: red ? "#FFF0F0" : "#F3F2EF", color: red ? "#CF222E" : "#6E6E6E", border: `1px solid ${red ? "rgba(207,34,46,.15)" : "#E6E4DF"}` }}>{children}</span>;
}

function Sec({ num, label }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
    {num && <span style={{ ...M, fontSize: 11, color: "#D0CEC8" }}>{String(num).padStart(2, "0")}</span>}
    <span style={{ ...M, fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#A0A0A0" }}>{label}</span>
    <div style={{ flex: 1, height: 1, background: "#E6E4DF" }} />
  </div>;
}

function CBar({ label, value }) {
  const c = value > 85 ? "#1A7F37" : value > 60 ? "#111" : "#A0A0A0";
  return <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
    <span style={{ ...M, fontSize: 11, color: "#A0A0A0", minWidth: 64 }}>{label}</span>
    <div style={{ flex: 1, height: 3, background: "#E6E4DF", borderRadius: 2, overflow: "hidden", maxWidth: 200 }}>
      <div style={{ height: "100%", width: `${value}%`, background: c, borderRadius: 2, transition: "width 1s cubic-bezier(.16,1,.3,1)" }} />
    </div>
    <span style={{ ...M, fontSize: 11, color: "#6E6E6E", minWidth: 28, textAlign: "right" }}>{value}%</span>
  </div>;
}

function SourcePill({ label }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, background: "#111", color: "#FAFAF8", fontSize: 12, ...M }}>
    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80" }} />{label}
  </span>;
}

// ─── Profile ─────────────────────────────────────────────────────────────────

function Profile({ brand, sources, images, brandImages }) {
  const colors = Array.isArray(brand.colors) ? brand.colors : [...(brand.colors?.primary || []), ...(brand.colors?.secondary || [])];
  const cn = brand.confidence || {};

  return <div style={{ paddingTop: 40, paddingBottom: 32 }}>
    {/* Header */}
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {brand.domain && <img src={`https://www.google.com/s2/favicons?domain=${brand.domain}&sz=128`} alt="" style={{ width: 48, height: 48, borderRadius: 8, border: "1px solid #E6E4DF", objectFit: "contain", background: "#FFF" }} onError={e => { e.target.style.display = "none"; }} />}
          <h1 style={{ fontFamily: DF, fontSize: "clamp(36px,6vw,56px)", fontWeight: 400, letterSpacing: "-.02em", lineHeight: .95 }}>{brand.name}</h1>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 8 }}>{sources.map((s, i) => <SourcePill key={i} label={s} />)}</div>
      </div>
      {brand.tagline && <p style={{ fontFamily: DF, fontSize: 18, fontStyle: "italic", color: "#6E6E6E", marginBottom: 8 }}>{brand.tagline}</p>}
      {brand.summary && <p style={{ fontSize: 15, color: "#3A3A3A", lineHeight: 1.7, maxWidth: 600 }}>{brand.summary}</p>}
      {brand.personality?.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 16 }}>{brand.personality.map((p, i) => <Tag key={i}>{p}</Tag>)}</div>}
      {images.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>{images.map((img, i) => <img key={i} src={img} style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 6, border: "1px solid #E6E4DF" }} />)}</div>}
    </div>
    <div style={{ height: 1, background: "#111", marginBottom: 40 }} />

    {/* Colors */}
    {colors.length > 0 && <div style={{ marginBottom: 48 }}><Sec num={1} label="Color Palette" />
      <div style={{ display: "flex", gap: 2, marginBottom: 12, borderRadius: 8, overflow: "hidden" }}>
        {colors.slice(0, 8).map((c, i) => <div key={i} style={{ flex: 1, height: 56, background: c.hex || "#ccc", border: (c.hex || "").toUpperCase().includes("FFF") ? "1px solid #E6E4DF" : "none" }} />)}
      </div>
      <div style={{ display: "flex", gap: 2 }}>{colors.slice(0, 8).map((c, i) => <div key={i} style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 500, marginBottom: 1 }}>{c.name}</div><div style={{ ...M, fontSize: 10, color: "#A0A0A0" }}>{c.hex}</div></div>)}</div>
    </div>}

    {/* Typography */}
    {brand.typography?.primary && <div style={{ marginBottom: 48 }}><Sec num={2} label="Typography" />
      <div style={{ marginBottom: 12 }}><span style={{ fontFamily: DF, fontSize: 28 }}>{brand.typography.primary}</span><span style={{ ...M, fontSize: 11, color: "#A0A0A0", marginLeft: 12 }}>Primary</span></div>
      {brand.typography.secondary && brand.typography.secondary !== "null" && <div style={{ marginBottom: 12 }}><span style={{ fontSize: 20, fontWeight: 300 }}>{brand.typography.secondary}</span><span style={{ ...M, fontSize: 11, color: "#A0A0A0", marginLeft: 12 }}>Secondary</span></div>}
      {(brand.typography.rules || []).map((r, i) => <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #E6E4DF", fontSize: 13, color: "#3A3A3A", lineHeight: 1.6 }}>{r}</div>)}
    </div>}

    {/* Voice */}
    {(brand.voice?.words?.length > 0 || brand.voice?.do?.length > 0) && <div style={{ marginBottom: 48 }}><Sec num={3} label="Voice & Tone" />
      {brand.voice.words?.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>{brand.voice.words.map((w, i) => <span key={i} style={{ fontFamily: DF, fontSize: 18, fontStyle: "italic" }}>{w}{i < brand.voice.words.length - 1 && <span style={{ color: "#D0CEC8", margin: "0 6px" }}>·</span>}</span>)}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
        {brand.voice.do?.length > 0 && <div>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#1A7F37", marginBottom: 8 }}>The brand does</div>
          {brand.voice.do.map((v, i) => <div key={i} style={{ display: "flex", gap: 8, padding: "7px 0", borderBottom: "1px solid #E6E4DF", fontSize: 14, color: "#3A3A3A", lineHeight: 1.55 }}><span style={{ ...M, fontSize: 12, color: "#1A7F37", flexShrink: 0 }}>+</span><span>{v}</span></div>)}
        </div>}
        {brand.voice.dont?.length > 0 && <div>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#CF222E", marginBottom: 8 }}>The brand avoids</div>
          {brand.voice.dont.map((v, i) => <div key={i} style={{ display: "flex", gap: 8, padding: "7px 0", borderBottom: "1px solid #E6E4DF", fontSize: 14, color: "#3A3A3A", lineHeight: 1.55 }}><span style={{ ...M, fontSize: 12, color: "#CF222E", flexShrink: 0 }}>−</span><span>{v}</span></div>)}
        </div>}
      </div>
    </div>}

    {/* Messaging */}
    {brand.messaging?.proposition && <div style={{ marginBottom: 48 }}><Sec num={4} label="Messaging" />
      <div style={{ padding: "24px 28px", background: "#111", color: "#FAFAF8", borderRadius: 8, marginBottom: 20 }}>
        <div style={{ ...M, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#A0A0A0", marginBottom: 8 }}>Core proposition</div>
        <p style={{ fontFamily: DF, fontSize: 20, fontStyle: "italic", lineHeight: 1.45 }}>{brand.messaging.proposition}</p>
      </div>
      {brand.messaging.pillars?.length > 0 && <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(brand.messaging.pillars.length, 3)}, 1fr)`, gap: 12 }}>
        {brand.messaging.pillars.map((p, i) => <div key={i} style={{ padding: "16px 18px", background: "#F3F2EF", borderRadius: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{typeof p === "string" ? p : p.title || ""}</div>
          {typeof p === "object" && p.desc && <div style={{ fontSize: 13, color: "#6E6E6E", lineHeight: 1.55 }}>{p.desc}</div>}
        </div>)}
      </div>}
      {brand.messaging.forbidden?.length > 0 && <div style={{ marginTop: 16, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ ...M, fontSize: 10, color: "#CF222E", letterSpacing: ".06em", textTransform: "uppercase", marginRight: 4 }}>Never say</span>
        {brand.messaging.forbidden.map((f, i) => <Tag key={i} red>{f}</Tag>)}
      </div>}
    </div>}

    {/* Competitive Analysis */}
    {(brand.competitive || brand.competitors?.length > 0 || brand.audience) && <div style={{ marginBottom: 48 }}><Sec num={5} label="Competitive Landscape" />
      
      {/* Audience */}
      {brand.audience && <div style={{ marginBottom: 24 }}>
        <div style={{ ...M, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#A0A0A0", marginBottom: 8 }}>Audience</div>
        <div style={{ fontSize: 14, color: "#3A3A3A", lineHeight: 1.65 }}>{typeof brand.audience === "string" ? brand.audience : brand.audience?.primary || ""}</div>
      </div>}

      {/* Positioning */}
      {brand.competitive?.positioning && <div style={{ padding: "16px 20px", background: "#F3F2EF", borderRadius: 8, marginBottom: 24 }}>
        <div style={{ ...M, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#A0A0A0", marginBottom: 6 }}>Positioning</div>
        <div style={{ fontSize: 14, color: "#3A3A3A", lineHeight: 1.65 }}>{brand.competitive.positioning}</div>
      </div>}

      {/* Competitor color comparison */}
      {(brand.competitive?.competitors?.length > 0 || brand.competitors?.length > 0) && (() => {
        const comps = brand.competitive?.competitors || brand.competitors?.map(c => typeof c === "string" ? { name: c } : c) || [];
        return <div style={{ marginBottom: 24 }}>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#A0A0A0", marginBottom: 12 }}>Competitor Comparison</div>
          
          {/* Visual comparison bar — brand vs competitors */}
          <div style={{ display: "flex", gap: 2, marginBottom: 16, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ flex: 2, height: 40, background: (brand.colors?.[0]?.hex || brand.colors?.primary?.[0]?.hex || "#111"), display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ ...M, fontSize: 10, color: "#FFF", textShadow: "0 1px 2px rgba(0,0,0,.3)" }}>{brand.name}</span>
            </div>
            {comps.slice(0, 4).map((comp, i) => 
              <div key={i} style={{ flex: 1, height: 40, background: comp.hex || ["#1877F2", "#E60023", "#FF9900", "#0A66C2"][i] || "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ ...M, fontSize: 9, color: "#FFF", textShadow: "0 1px 2px rgba(0,0,0,.3)", textAlign: "center", padding: "0 4px" }}>{comp.name?.split(" ")[0]}</span>
              </div>
            )}
          </div>

          {/* Competitor detail rows */}
          {comps.map((comp, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "8px 1fr 1fr 2fr", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: "1px solid #E6E4DF" }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: comp.hex || ["#1877F2", "#E60023", "#FF9900", "#0A66C2"][i] || "#888", flexShrink: 0 }} />
            <div style={{ fontSize: 14, fontWeight: 500 }}>{comp.name || comp}</div>
            <div style={{ ...M, fontSize: 11, color: "#6E6E6E" }}>{comp.tone || ""}</div>
            <div style={{ fontSize: 13, color: "#A0A0A0" }}>{comp.overlap || ""}</div>
          </div>)}
        </div>;
      })()}

      {/* Whitespace + Threats side by side */}
      {(brand.competitive?.whitespace || brand.competitive?.threats?.length > 0) && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {brand.competitive.whitespace && <div style={{ padding: "16px 18px", background: "#ECFDF3", borderLeft: "3px solid #1A7F37", borderRadius: "0 6px 6px 0" }}>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#1A7F37", marginBottom: 6 }}>Whitespace owned</div>
          <div style={{ fontSize: 13, color: "#3A3A3A", lineHeight: 1.6 }}>{brand.competitive.whitespace}</div>
        </div>}
        {brand.competitive.threats?.length > 0 && <div style={{ padding: "16px 18px", background: "#FFF8E1", borderLeft: "3px solid #9A6700", borderRadius: "0 6px 6px 0" }}>
          <div style={{ ...M, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#9A6700", marginBottom: 6 }}>Competitive risks</div>
          {brand.competitive.threats.map((t, i) => <div key={i} style={{ fontSize: 13, color: "#3A3A3A", lineHeight: 1.6, marginBottom: 4 }}>{t}</div>)}
        </div>}
      </div>}
    </div>}

    {/* Brand Imagery */}
    {brandImages.length > 0 && <div style={{ marginBottom: 48 }}><Sec num={6} label="Brand Imagery" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {brandImages.map((url, i) => <div key={i} style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #E6E4DF", background: "#F3F2EF" }}>
          <img src={url} alt="" style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }} onError={e => { e.target.parentElement.style.display = "none"; }} />
        </div>)}
      </div>
      {brand.domain && <div style={{ ...M, fontSize: 10, color: "#D0CEC8", marginTop: 8 }}>Sourced from {brand.domain}</div>}
    </div>}

    {/* Insights */}
    {brand.insights?.length > 0 && <div style={{ marginBottom: 48 }}><Sec label="Cross-source insights" />
      {brand.insights.map((ins, i) => <div key={i} style={{ padding: "14px 18px", background: "#EFF6FF", borderLeft: "3px solid #0550AE", borderRadius: "0 6px 6px 0", marginBottom: 8, fontSize: 13, color: "#3A3A3A", lineHeight: 1.6 }}>{ins}</div>)}
    </div>}

    {/* Confidence */}
    <div><Sec label="Confidence" />
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
      // Initial analysis
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
        // Fetch real brand images in background
        if (result.domain) fetchBrandImages(result.domain).then(setBrandImages);
      } catch (e) {
        clearTimers(); setError(e.message); setSteps([]);
      } finally { setLoading(false); }

    } else {
      // Enrichment
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

  function reset() { clearTimers(); setBrand(null); setSources([]); setImages([]); setBrandImages([]); setSteps([]); setError(null); setInput(""); setLoading(false); }
  const canSend = (input.trim() || images.length > 0) && !loading;

  return <div style={{ minHeight: "100vh", background: "#FAFAF8", fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, color: "#111", lineHeight: 1.6 }}>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

    {/* Topbar */}
    <div style={{ position: "sticky", top: 0, zIndex: 50, background: "#FAFAF8", borderBottom: "1px solid #E6E4DF" }}>
      <div style={{ maxWidth: 740, margin: "0 auto", padding: "0 clamp(20px,5vw,48px)", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 500 }}>
          <svg width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#111"/><rect x="3.5" y="3.5" width="5" height="5" rx="1" fill="#FAFAF8"/><rect x="11.5" y="11.5" width="5" height="5" rx="1" fill="#FAFAF8"/></svg>
          BrandBook
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {brand && <button onClick={reset} style={{ background: "none", border: "1px solid #E6E4DF", padding: "5px 14px", borderRadius: 6, fontSize: 12, color: "#6E6E6E", cursor: "pointer", fontFamily: "inherit" }}>New brand</button>}
          <span style={{ ...M, fontSize: 10, color: "#A0A0A0", letterSpacing: ".08em", textTransform: "uppercase" }}>Prototype</span>
        </div>
      </div>
    </div>

    {/* Content */}
    <div style={{ maxWidth: 740, margin: "0 auto", padding: "0 clamp(20px,5vw,48px)" }}>
      {/* Empty state */}
      {!brand && !loading && steps.length === 0 && <div style={{ paddingTop: "16vh", paddingBottom: 48 }}>
        <h1 style={{ fontFamily: DF, fontSize: "clamp(32px,5vw,48px)", fontWeight: 400, lineHeight: 1.1, letterSpacing: "-.02em", marginBottom: 16 }}>Start with a name.</h1>
        <p style={{ fontSize: 16, color: "#6E6E6E", lineHeight: 1.65, maxWidth: 440 }}>BrandBook builds an intelligence profile from whatever you give it. A company name is enough to start. Add guidelines, images, or context to sharpen the picture.</p>
      </div>}

      {/* Steps */}
      {steps.length > 0 && <div style={{ padding: "32px 0" }}>{steps.map((s, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
        {s.done ? <span style={{ color: "#1A7F37", fontSize: 14, width: 18, textAlign: "center" }}>✓</span> : s.active ? <Spinner /> : <span style={{ width: 18, height: 18, borderRadius: "50%", border: "1px solid #E6E4DF", display: "block" }} />}
        <span style={{ fontSize: 14, color: s.done ? "#111" : s.active ? "#3A3A3A" : "#A0A0A0" }}>{s.label}</span>
      </div>)}</div>}

      {/* Profile */}
      {brand && !loading && steps.length === 0 && <Profile brand={brand} sources={sources} images={images} brandImages={brandImages} />}

      {/* Error */}
      {error && <div style={{ padding: "12px 16px", background: "#FFF0F0", borderRadius: 6, marginBottom: 16, fontSize: 14, color: "#CF222E" }}>{error}</div>}

      <div ref={bRef} style={{ height: 160 }} />
    </div>

    {/* Input bar */}
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, background: "linear-gradient(transparent, #FAFAF8 24px)", padding: "24px 0 20px" }}>
      <div style={{ maxWidth: 740, margin: "0 auto", padding: "0 clamp(20px,5vw,48px)" }}>
        <div style={{ background: "#FFF", border: "1px solid #E6E4DF", borderRadius: 12, padding: 12, boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          {/* Attached images */}
          {images.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {images.map((img, i) => <div key={i} style={{ position: "relative", width: 56, height: 56, borderRadius: 6, overflow: "hidden", border: "1px solid #E6E4DF" }}>
              <img src={img} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button onClick={() => setImages(p => p.filter((_, j) => j !== i))} style={{ position: "absolute", top: -4, right: -4, width: 18, height: 18, borderRadius: "50%", background: "#111", color: "#FFF", border: "none", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>)}
          </div>}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            {brand && <button onClick={addImage} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #E6E4DF", borderRadius: 6, padding: "4px 10px", fontSize: 12, color: "#6E6E6E", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
              Image
            </button>}
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }}
              placeholder={!brand ? "Enter a company name to start…" : "Add more — paste guidelines, describe assets, add context…"}
              rows={1} style={{ flex: 1, border: "none", outline: "none", resize: "none", fontSize: 15, fontFamily: "'DM Sans',sans-serif", color: "#111", background: "transparent", lineHeight: 1.5, minHeight: 24, maxHeight: 120, padding: "0 0 0 4px" }} />
            <button onClick={go} disabled={!canSend} style={{
              width: 36, height: 36, borderRadius: 8, border: "none",
              background: canSend ? "#111" : "#E6E4DF", color: canSend ? "#FAFAF8" : "#A0A0A0",
              cursor: loading ? "wait" : canSend ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              {loading ? <Spinner /> : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13L13 3M13 3H5M13 3V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
          </div>
        </div>
        {brand && <div style={{ textAlign: "center", marginTop: 8 }}><span style={{ ...M, fontSize: 10, color: "#D0CEC8" }}>Paste guidelines, add images, or add context to deepen the profile</span></div>}
      </div>
    </div>
  </div>;
}
