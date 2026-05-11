import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Badge } from "./ui/Badge";
import type {
  ContactDossier,
  CompanyDossier,
  DossierTag,
  DossierMetric,
  DossierField,
  DossierContactEntry,
  DossierDigitalChannel,
  DossierQuote,
  DossierTimelineEntry,
  DossierTableRow,
  DossierVertical,
  DossierRecognition,
  DossierAlert,
  DossierSource,
  DossierNewsItem,
  CompanyLeader,
} from "@boringos-crm/shared";

/* ── Collapsible Section ── */
function Section({
  num,
  title,
  lead,
  defaultOpen = false,
  children,
}: {
  num: string;
  title: string;
  lead?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-emerald-900/40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-baseline gap-3 py-3 px-1 text-left hover:bg-emerald-950/30 transition-colors"
      >
        <span className="text-[10px] font-mono font-semibold tracking-[0.25em] text-emerald-400 shrink-0">
          {num}
        </span>
        <span className="text-[17px] font-semibold text-emerald-50 flex-1">
          {title}
        </span>
        {lead && (
          <span className="text-[11px] font-mono text-emerald-400/55 tracking-wide hidden sm:block">
            {lead}
          </span>
        )}
        <span className="text-emerald-400/55 text-sm shrink-0">{open ? "\u25B4" : "\u25BE"}</span>
      </button>
      {open && <div className="pb-4 px-1">{children}</div>}
    </div>
  );
}

/* ── Sub-components ── */
function TagPill({ tag }: { tag: DossierTag }) {
  return (
    <span
      className={`inline-block text-[10px] font-mono tracking-wide uppercase px-2 py-0.5 border ${
        tag.accent
          ? "border-emerald-400 text-emerald-400 bg-emerald-950/30"
          : "border-emerald-900/40 text-emerald-100/85 bg-[#0e1518]"
      }`}
    >
      {tag.label}
    </span>
  );
}

function MetricCard({ m }: { m: DossierMetric }) {
  return (
    <div className="border-r border-emerald-900/40 last:border-r-0 px-4 py-3">
      <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55">
        {m.label}
      </div>
      <div className="text-[22px] font-bold text-emerald-50 mt-0.5 leading-tight">
        {m.value}
        {m.unit && <span className="text-[11px] font-normal text-emerald-100/85 ml-1">{m.unit}</span>}
      </div>
      {m.subtitle && <div className="text-[10px] text-emerald-400/55 mt-0.5">{m.subtitle}</div>}
    </div>
  );
}

function FieldGrid({ fields }: { fields: DossierField[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
      {fields.map((f, i) => (
        <div key={i}>
          <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">
            {f.label}
          </div>
          <div className="text-[13px] text-emerald-50">
            {f.value}
            {f.source && (
              <span className="ml-1.5">
                <Badge color={f.source.includes("linkedin") ? "blue" : f.source.includes("web") ? "green" : "gray"}>
                  {f.source}
                </Badge>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ContactDirectoryTable({ entries }: { entries: DossierContactEntry[] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {entries.map((e, i) => (
          <tr key={i} className="border-b border-emerald-900/40 last:border-b-0">
            <td className="py-2 pr-4 text-emerald-100/85 font-medium w-[35%]">{e.label}</td>
            <td className="py-2 text-emerald-50">
              {e.value}
              {e.note && (
                <span className="ml-1.5 text-[10px] font-mono text-amber-300">{e.note}</span>
              )}
              {e.verified === false && !e.note && (
                <span className="ml-1.5 text-[10px] font-mono text-amber-300">[~verify]</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DigitalChannelCard({ ch }: { ch: DossierDigitalChannel }) {
  const statusColor =
    ch.status === "active" ? "green" : ch.status === "inactive" ? "yellow" : "gray";
  return (
    <div className="border border-emerald-900/40 rounded-md p-3 relative">
      <div className="absolute top-2 right-2">
        <Badge color={statusColor}>
          {ch.status === "active" ? "Active" : ch.status === "inactive" ? "Inactive" : "Archive"}
        </Badge>
      </div>
      <div className="text-[9px] font-mono tracking-[0.2em] uppercase text-emerald-400 mb-0.5">
        {ch.platform}
      </div>
      {ch.handle && <div className="text-[13px] font-semibold text-emerald-50">{ch.handle}</div>}
      {ch.url && (
        <div className="text-[11px] text-emerald-100/85 truncate">{ch.url}</div>
      )}
      <p className="text-[12px] text-emerald-100/85 mt-1.5 leading-snug">{ch.description}</p>
      {ch.postFrequency && (
        <div className="text-[10px] text-emerald-400/55 mt-1">Posts: {ch.postFrequency}</div>
      )}
    </div>
  );
}

function QuoteBlock({ q }: { q: DossierQuote }) {
  return (
    <div className="border-l-3 border-emerald-400 bg-emerald-950/30/30 px-5 py-3 my-3 relative">
      <span className="absolute left-2 -top-1 text-[32px] text-emerald-400 leading-none font-serif">
        {"\u201C"}
      </span>
      <p className="text-[15px] italic text-emerald-50 leading-relaxed pl-4">{q.text}</p>
      <span className="block mt-1.5 pl-4 text-[10px] font-mono tracking-[0.15em] text-emerald-400/55 uppercase">
        {"\u2014"} {q.source}
        {q.date && ` (${q.date})`}
      </span>
    </div>
  );
}

function TimelineView({ entries }: { entries: DossierTimelineEntry[] }) {
  return (
    <div className="relative pl-7">
      <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-border-dark opacity-40" />
      {entries.map((e, i) => (
        <div key={i} className="relative mb-4 last:mb-0">
          <div
            className="absolute -left-[22px] top-1.5 w-[9px] h-[9px] bg-accent rotate-45"
            style={{ boxShadow: "0 0 0 3px var(--color-bg)" }}
          />
          <div className="text-[10px] font-mono tracking-[0.18em] text-emerald-400 font-semibold">
            {e.yearRange}
          </div>
          <div className="text-[14px] font-semibold text-emerald-50 mt-0.5">{e.title}</div>
          <div className="text-[12px] text-emerald-100/85 leading-snug mt-0.5">{e.body}</div>
        </div>
      ))}
    </div>
  );
}

function FinancialTable({ rows, disclaimer }: { rows: DossierTableRow[]; disclaimer?: string }) {
  return (
    <>
      {disclaimer && (
        <div className="text-[11px] text-amber-300 bg-amber-950/30 px-3 py-2 border-l-3 border-text-yellow mb-3">
          {disclaimer}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#0e1518]">
            <th className="text-left py-2 px-3 text-[9px] font-mono tracking-[0.15em] uppercase text-emerald-400/55 font-medium">
              Metric
            </th>
            <th className="text-left py-2 px-3 text-[9px] font-mono tracking-[0.15em] uppercase text-emerald-400/55 font-medium">
              Value
            </th>
            <th className="text-left py-2 px-3 text-[9px] font-mono tracking-[0.15em] uppercase text-emerald-400/55 font-medium">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-emerald-900/40">
              <td className="py-2 px-3 font-medium text-emerald-50">{r.metric}</td>
              <td className="py-2 px-3 text-emerald-50">{r.value}</td>
              <td className="py-2 px-3 text-[11px] text-emerald-400/55">{r.sourceNote ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function VerticalCards({ verticals }: { verticals: DossierVertical[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {verticals.map((v, i) => (
        <div key={i} className="border border-emerald-900/40 rounded-md p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[14px] font-semibold text-emerald-50">{v.name}</span>
            <Badge color={v.status === "active" ? "green" : v.status === "exited" ? "blue" : "gray"}>
              {v.status}
            </Badge>
          </div>
          <p className="text-[12px] text-emerald-100/85 leading-snug">{v.description}</p>
          {v.highlights && v.highlights.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {v.highlights.map((h, j) => (
                <span key={j} className="text-[10px] px-1.5 py-0.5 bg-[#0e1518] border border-emerald-900/40 text-emerald-100/85">
                  {h}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AlertsBox({ alerts }: { alerts: DossierAlert[] }) {
  return (
    <div className="border border-emerald-400 bg-emerald-950/30/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-mono tracking-[0.3em] uppercase text-emerald-400 font-bold">
          {"\u25C6"} Actionable Intelligence
        </span>
        <span className="text-[10px] font-mono text-emerald-400/55">{alerts.length} alerts</span>
      </div>
      <ul className="space-y-0">
        {alerts.map((a, i) => (
          <li key={i} className="py-2.5 pl-5 border-b border-dashed border-emerald-900/40 last:border-b-0 relative text-[13px] leading-snug">
            <span className="absolute left-0 top-3 text-emerald-400 font-bold">{"\u25B8"}</span>
            <span className="font-semibold text-emerald-50">{a.hook}.</span>{" "}
            <span className="text-emerald-100/85">{a.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceTierBadge({ tier }: { tier: DossierSource["tier"] }) {
  const map: Record<string, "green" | "blue" | "orange" | "red"> = {
    verified: "green",
    public: "blue",
    database: "orange",
    inferred: "red",
  };
  return <Badge color={map[tier] ?? "gray"}>{tier}</Badge>;
}

function SourceGrid({ sources }: { sources: DossierSource[] }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {sources.map((s) => (
        <div key={s.id} className="border border-emerald-900/40 p-3 text-[12px]">
          <div className="text-[9px] font-mono tracking-[0.18em] text-emerald-400 font-semibold">{s.id}</div>
          <div className="font-semibold text-emerald-50 mt-0.5">{s.title}</div>
          {s.url && (
            <div className="text-[10px] font-mono text-emerald-400/55 truncate mt-0.5">{s.url}</div>
          )}
          <p className="text-emerald-100/85 mt-1 leading-snug">{s.contribution}</p>
          <div className="mt-1.5">
            <SourceTierBadge tier={s.tier} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecognitionList({ items }: { items: DossierRecognition[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((r, i) => (
        <div key={i} className="border border-emerald-900/40 p-3">
          {r.year && (
            <div className="text-[10px] font-mono tracking-[0.18em] text-emerald-400 font-semibold">{r.year}</div>
          )}
          <div className="text-[13px] font-semibold text-emerald-50 mt-0.5">{r.title}</div>
          {r.description && (
            <div className="text-[11px] text-emerald-100/85 mt-0.5">{r.description}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function NewsItems({ items }: { items: DossierNewsItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((n, i) => (
        <div key={i} className="border-b border-emerald-900/40 pb-2 last:border-b-0">
          <div className="flex items-baseline gap-2">
            {n.date && <span className="text-[10px] font-mono text-emerald-400 font-semibold">{n.date}</span>}
            <span className="text-[13px] font-semibold text-emerald-50">{n.headline}</span>
          </div>
          {n.detail && <p className="text-[12px] text-emerald-100/85 mt-0.5">{n.detail}</p>}
        </div>
      ))}
    </div>
  );
}

function LeadershipCards({ leaders }: { leaders: CompanyLeader[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {leaders.map((l, i) => (
        <div key={i} className="border border-emerald-900/40 rounded-md p-3">
          <div className="text-[14px] font-semibold text-emerald-50">{l.name}</div>
          <div className="text-[12px] text-emerald-400">{l.role}</div>
          {l.background && <p className="text-[12px] text-emerald-100/85 mt-1">{l.background}</p>}
          {l.contactId && (
            <Link to={`/contacts/${l.contactId}`} className="text-[11px] text-emerald-400 hover:underline mt-1 inline-block">
              View contact dossier {"\u2192"}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

function GeographyPills({ locations }: { locations: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {locations.map((loc, i) => (
        <span key={i} className="text-[11px] px-2.5 py-1 border border-emerald-900/40 bg-[#0e1518] text-emerald-50">
          {loc}
        </span>
      ))}
    </div>
  );
}

function MarketSection({ market }: { market: NonNullable<ContactDossier["market"]> }) {
  return (
    <div className="space-y-3">
      {market.keyClients && market.keyClients.length > 0 && (
        <div>
          <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Key Clients</div>
          <div className="flex flex-wrap gap-1.5">
            {market.keyClients.map((c, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 bg-[#0e1518] border border-emerald-900/40 text-emerald-50">{c}</span>
            ))}
          </div>
        </div>
      )}
      {market.competition && (
        <div>
          <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Competition</div>
          <p className="text-[13px] text-emerald-50">{market.competition}</p>
        </div>
      )}
      {market.positioning && (
        <div>
          <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Positioning</div>
          <p className="text-[13px] text-emerald-50">{market.positioning}</p>
        </div>
      )}
      {market.proprietaryTech && market.proprietaryTech.length > 0 && (
        <div>
          <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Proprietary Tech</div>
          <div className="flex flex-wrap gap-1.5">
            {market.proprietaryTech.map((t, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 bg-violet-950/30 border border-emerald-900/40 text-violet-300">{t}</span>
            ))}
          </div>
        </div>
      )}
      {market.certifications && market.certifications.length > 0 && (
        <div>
          <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Certifications</div>
          <div className="flex flex-wrap gap-1.5">
            {market.certifications.map((c, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 bg-emerald-950/30 border border-emerald-900/40 text-emerald-300">{c}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Dossier View ── */

interface ContactDossierViewProps {
  data: ContactDossier;
  entityName: string;
}

export function ContactDossierView({ data, entityName }: ContactDossierViewProps) {
  const d = data;
  let secNum = 0;
  const sec = () => `S${String(++secNum).padStart(2, "0")}`;

  return (
    <div className="mt-8 border border-emerald-900/50 rounded-lg overflow-hidden bg-[#04080a] text-emerald-50 font-mono shadow-[0_0_60px_rgba(16,185,129,0.08)]">
      {/* Header */}
      <div className="bg-gradient-to-b from-[#020608] to-[#04090c] text-emerald-50 p-6 relative overflow-hidden border-b border-emerald-500/20">
        <div className="absolute -top-20 -right-20 w-[300px] h-[300px] bg-emerald-400/10 rounded-full blur-[60px]" />
        <div className="flex justify-between items-start relative z-10 border-b border-emerald-500/20 pb-3 mb-4">
          <div className="text-[10px] font-mono tracking-[0.18em] uppercase opacity-80">
            Hebbs {"\u00b7"} Intelligence
          </div>
          <div className="text-[10px] font-mono tracking-[0.15em] text-right opacity-70">
            <div className="border border-emerald-300/60 text-emerald-300 px-2 py-0.5 tracking-[0.28em] font-semibold text-[9px] mb-1 inline-block">
              ENRICHMENT
            </div>
          </div>
        </div>
        <div className="flex items-center gap-5 relative z-10">
          <div className="w-[90px] h-[90px] bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-[42px] font-light text-emerald-50 shrink-0 shadow-[0_0_30px_rgba(16,185,129,0.4)] border border-emerald-300/40">
            {d.header.monogram}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[36px] font-bold leading-none tracking-tight">{entityName}</h2>
            <p className="text-[13px] opacity-85 mt-1.5 whitespace-pre-line">{d.header.positioning}</p>
            <p className="text-[12px] opacity-70 mt-0.5 whitespace-pre-line">{d.header.headline}</p>
            {d.header.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {d.header.tags.map((t, i) => (
                  <span
                    key={i}
                    className={`text-[9px] font-mono tracking-[0.1em] uppercase px-2 py-0.5 border ${
                      t.accent ? "border-emerald-300/70 text-emerald-200" : "border-emerald-500/30 text-emerald-300/80"
                    }`}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          {d.header.quickStats && (
            <div className="text-right text-[10px] font-mono tracking-wide opacity-75 leading-relaxed shrink-0 hidden lg:block">
              {d.header.quickStats.primaryEmail && (
                <div><span className="block text-[9px] uppercase tracking-[0.14em] opacity-60 font-semibold">Email</span>{d.header.quickStats.primaryEmail}</div>
              )}
              {d.header.quickStats.location && (
                <div className="mt-1"><span className="block text-[9px] uppercase tracking-[0.14em] opacity-60 font-semibold">Location</span>{d.header.quickStats.location}</div>
              )}
              {d.header.quickStats.activeCompanies && (
                <div className="mt-1"><span className="block text-[9px] uppercase tracking-[0.14em] opacity-60 font-semibold">Active Companies</span>{d.header.quickStats.activeCompanies}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Metric strip */}
      {d.metrics.length > 0 && (
        <div className="flex border-b border-emerald-900/40 bg-[#0e1518] overflow-x-auto">
          {d.metrics.map((m, i) => (
            <MetricCard key={i} m={m} />
          ))}
        </div>
      )}

      {/* Sections */}
      <div className="px-6">
        {d.profile && (
          <Section num={sec()} title="Personal Profile" lead="Identity / Education / Base" defaultOpen>
            <div className="grid grid-cols-3 gap-x-6 gap-y-2.5">
              <div>
                <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Full Name</div>
                <div className="text-[13px] text-emerald-50">{d.profile.fullName}</div>
              </div>
              {d.profile.knownAs && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Known As</div>
                  <div className="text-[13px] text-emerald-50">{d.profile.knownAs}</div>
                </div>
              )}
              {d.profile.ageApprox && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Age (approx.)</div>
                  <div className="text-[13px] text-emerald-50">{d.profile.ageApprox}</div>
                </div>
              )}
              {d.profile.baseCities && d.profile.baseCities.length > 0 && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Base</div>
                  <div className="text-[13px] text-emerald-50">{d.profile.baseCities.join(" / ")}</div>
                </div>
              )}
              {d.profile.nationality && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Nationality</div>
                  <div className="text-[13px] text-emerald-50">{d.profile.nationality}</div>
                </div>
              )}
              {d.profile.familyCircle && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Trusted Circle</div>
                  <div className="text-[13px] text-emerald-50">{d.profile.familyCircle}</div>
                </div>
              )}
            </div>
            {d.profile.education && d.profile.education.length > 0 && (
              <div className="mt-3">
                <FieldGrid fields={d.profile.education} />
              </div>
            )}
            {d.profile.affiliations && d.profile.affiliations.length > 0 && (
              <div className="mt-3">
                <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Affiliations</div>
                <div className="flex flex-wrap gap-1.5">
                  {d.profile.affiliations.map((a, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 bg-[#0e1518] border border-emerald-900/40 text-emerald-100/85">{a}</span>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {d.contactDirectory && d.contactDirectory.length > 0 && (
          <Section num={sec()} title="Contact Directory" defaultOpen>
            <ContactDirectoryTable entries={d.contactDirectory} />
          </Section>
        )}

        {d.digital && d.digital.length > 0 && (
          <Section num={sec()} title="Digital & Social Presence" lead="Channel-by-channel">
            <div className="grid grid-cols-2 gap-3">
              {d.digital.map((ch, i) => (
                <DigitalChannelCard key={i} ch={ch} />
              ))}
            </div>
          </Section>
        )}

        {d.persona && (
          <Section num={sec()} title="Persona Insights" lead="Psychographic profile">
            <div className="grid grid-cols-3 gap-x-6 gap-y-2.5">
              {d.persona.decisionStyle && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Decision Style</div>
                  <div className="text-[13px] text-emerald-50">{d.persona.decisionStyle}</div>
                </div>
              )}
              {d.persona.philosophy && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Philosophy</div>
                  <div className="text-[13px] text-emerald-50">{d.persona.philosophy}</div>
                </div>
              )}
              {d.persona.communicationStyle && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Communication</div>
                  <div className="text-[13px] text-emerald-50">{d.persona.communicationStyle}</div>
                </div>
              )}
              {d.persona.whatTheyRespect && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">What They Respect</div>
                  <div className="text-[13px] text-emerald-50">{d.persona.whatTheyRespect}</div>
                </div>
              )}
              {d.persona.whatTheyDismiss && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">What They Dismiss</div>
                  <div className="text-[13px] text-emerald-50">{d.persona.whatTheyDismiss}</div>
                </div>
              )}
              {d.persona.innerCircle && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Inner Circle</div>
                  <div className="text-[13px] text-emerald-50">{d.persona.innerCircle}</div>
                </div>
              )}
            </div>
            {d.persona.influences && d.persona.influences.length > 0 && (
              <div className="mt-3">
                <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Influences</div>
                <div className="flex flex-wrap gap-1.5">
                  {d.persona.influences.map((inf, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 bg-[#0e1518] border border-emerald-900/40 text-emerald-100/85">{inf}</span>
                  ))}
                </div>
              </div>
            )}
            {d.persona.quotes && d.persona.quotes.length > 0 && (
              <div className="mt-3">
                {d.persona.quotes.map((q, i) => (
                  <QuoteBlock key={i} q={q} />
                ))}
              </div>
            )}
          </Section>
        )}

        {d.journey && d.journey.length > 0 && (
          <Section num={sec()} title="Career Timeline" lead="Chronological" defaultOpen>
            <TimelineView entries={d.journey} />
          </Section>
        )}

        {d.financial && (
          <Section num={sec()} title="Financial Snapshot" lead="Public disclosures only">
            <FinancialTable rows={d.financial.rows} disclaimer={d.financial.disclaimer} />
          </Section>
        )}

        {d.verticals && d.verticals.length > 0 && (
          <Section num={sec()} title="Business Verticals">
            <VerticalCards verticals={d.verticals} />
          </Section>
        )}

        {d.geography && d.geography.length > 0 && (
          <Section num={sec()} title="Geographic Footprint">
            <GeographyPills locations={d.geography} />
          </Section>
        )}

        {d.market && (
          <Section num={sec()} title="Clients & Market Position">
            <MarketSection market={d.market} />
          </Section>
        )}

        {d.recognition && d.recognition.length > 0 && (
          <Section num={sec()} title="Recognition & Honours">
            <RecognitionList items={d.recognition} />
          </Section>
        )}

        {/* Alerts — always visible */}
        {d.alerts.length > 0 && (
          <div className="py-4 border-b border-emerald-900/40">
            <AlertsBox alerts={d.alerts} />
          </div>
        )}

        {/* Sources — collapsible */}
        {d.sources.length > 0 && (
          <Section num={sec()} title="Source Index" lead={`${d.sources.length} sources`}>
            <SourceGrid sources={d.sources} />
          </Section>
        )}
      </div>

      {/* Footer */}
      <div className="bg-[#020608] text-emerald-400/70 px-6 py-4 text-[10px] font-mono tracking-wide border-t border-emerald-500/20">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-emerald-300 font-semibold tracking-[0.15em]">Hebbs.ai</span>
            {" with "}
            <span className="text-emerald-200">{d.model}</span>
          </div>
          <div>
            Enriched {new Date(d.enrichedAt).toLocaleDateString()} {"\u00b7"} {d.sourceCount} sources {"\u00b7"} v{d.version}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Company Dossier View ── */

interface CompanyDossierViewProps {
  data: CompanyDossier;
  entityName: string;
}

export function CompanyDossierView({ data, entityName }: CompanyDossierViewProps) {
  const d = data;
  let secNum = 0;
  const sec = () => `S${String(++secNum).padStart(2, "0")}`;

  return (
    <div className="mt-8 border border-emerald-900/50 rounded-lg overflow-hidden bg-[#04080a] text-emerald-50 font-mono shadow-[0_0_60px_rgba(16,185,129,0.08)]">
      {/* Header */}
      <div className="bg-gradient-to-b from-[#020608] to-[#04090c] text-emerald-50 p-6 relative overflow-hidden border-b border-emerald-500/20">
        <div className="absolute -top-20 -right-20 w-[300px] h-[300px] bg-emerald-400/10 rounded-full blur-[60px]" />
        <div className="flex justify-between items-start relative z-10 border-b border-emerald-500/20 pb-3 mb-4">
          <div className="text-[10px] font-mono tracking-[0.18em] uppercase opacity-80">
            Hebbs {"\u00b7"} Intelligence
          </div>
          <div className="text-[10px] font-mono tracking-[0.15em] text-right opacity-70">
            <div className="border border-emerald-300/60 text-emerald-300 px-2 py-0.5 tracking-[0.28em] font-semibold text-[9px] mb-1 inline-block">
              ENRICHMENT
            </div>
          </div>
        </div>
        <div className="flex items-center gap-5 relative z-10">
          <div className="w-[90px] h-[90px] bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-[42px] font-light text-emerald-50 shrink-0 shadow-[0_0_30px_rgba(16,185,129,0.4)] border border-emerald-300/40">
            {d.header.monogram}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[36px] font-bold leading-none tracking-tight">{entityName}</h2>
            <p className="text-[13px] opacity-85 mt-1.5">{d.header.positioning}</p>
            {d.header.tagline && (
              <p className="text-[12px] italic opacity-70 mt-0.5">{"\u201C"}{d.header.tagline}{"\u201D"}</p>
            )}
            {d.header.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {d.header.tags.map((t, i) => (
                  <span
                    key={i}
                    className={`text-[9px] font-mono tracking-[0.1em] uppercase px-2 py-0.5 border ${
                      t.accent ? "border-emerald-300/70 text-emerald-200" : "border-emerald-500/30 text-emerald-300/80"
                    }`}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="text-right text-[10px] font-mono tracking-wide opacity-75 leading-relaxed shrink-0 hidden lg:block">
            {d.header.founded && (
              <div><span className="block text-[9px] uppercase tracking-[0.14em] opacity-60 font-semibold">Founded</span>{d.header.founded}</div>
            )}
            {d.header.hq && (
              <div className="mt-1"><span className="block text-[9px] uppercase tracking-[0.14em] opacity-60 font-semibold">HQ</span>{d.header.hq}</div>
            )}
          </div>
        </div>
      </div>

      {/* Metric strip */}
      {d.metrics.length > 0 && (
        <div className="flex border-b border-emerald-900/40 bg-[#0e1518] overflow-x-auto">
          {d.metrics.map((m, i) => (
            <MetricCard key={i} m={m} />
          ))}
        </div>
      )}

      {/* Sections */}
      <div className="px-6">
        {d.overview && (
          <Section num={sec()} title="Company Overview" defaultOpen>
            <div className="grid grid-cols-3 gap-x-6 gap-y-2.5">
              {d.overview.legalName && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Legal Name</div>
                  <div className="text-[13px] text-emerald-50">{d.overview.legalName}</div>
                </div>
              )}
              {d.overview.type && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Type</div>
                  <div className="text-[13px] text-emerald-50">{d.overview.type}</div>
                </div>
              )}
              {d.overview.sector && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Sector</div>
                  <div className="text-[13px] text-emerald-50">{d.overview.sector}</div>
                </div>
              )}
              {d.overview.businessModel && (
                <div className="col-span-2">
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Business Model</div>
                  <div className="text-[13px] text-emerald-50">{d.overview.businessModel}</div>
                </div>
              )}
              {d.overview.hqAddress && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">HQ Address</div>
                  <div className="text-[13px] text-emerald-50">{d.overview.hqAddress}</div>
                </div>
              )}
            </div>
            {d.overview.description && (
              <p className="text-[13px] text-emerald-100/85 mt-3 leading-snug">{d.overview.description}</p>
            )}
          </Section>
        )}

        {d.leadership && d.leadership.length > 0 && (
          <Section num={sec()} title="Leadership" defaultOpen>
            <LeadershipCards leaders={d.leadership} />
          </Section>
        )}

        {d.verticals && d.verticals.length > 0 && (
          <Section num={sec()} title="Products & Verticals" defaultOpen>
            <VerticalCards verticals={d.verticals} />
          </Section>
        )}

        {d.technology && (
          <Section num={sec()} title="Technology & IP">
            <div className="space-y-3">
              {d.technology.proprietaryStack && d.technology.proprietaryStack.length > 0 && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Proprietary Stack</div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.technology.proprietaryStack.map((t, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 bg-violet-950/30 border border-emerald-900/40 text-violet-300">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {d.technology.infrastructure && d.technology.infrastructure.length > 0 && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Infrastructure</div>
                  <ul className="space-y-0.5">
                    {d.technology.infrastructure.map((item, i) => (
                      <li key={i} className="text-[12px] text-emerald-50 flex items-start gap-1.5">
                        <span className="text-emerald-400/55 mt-0.5">{"\u2022"}</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.technology.compliance && d.technology.compliance.length > 0 && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Compliance</div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.technology.compliance.map((c, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 bg-emerald-950/30 border border-emerald-900/40 text-emerald-300">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {d.clients && (
          <Section num={sec()} title="Clients & Reach">
            <div className="space-y-3">
              {d.clients.segments && d.clients.segments.length > 0 && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Client Segments</div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.clients.segments.map((s, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 bg-[#0e1518] border border-emerald-900/40 text-emerald-50">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {d.clients.totalCount && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Total Clients</div>
                  <div className="text-[13px] text-emerald-50">{d.clients.totalCount}</div>
                </div>
              )}
              {d.clients.geographicReach && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-0.5">Geographic Reach</div>
                  <div className="text-[13px] text-emerald-50">{d.clients.geographicReach}</div>
                </div>
              )}
            </div>
          </Section>
        )}

        {d.financial && (
          <Section num={sec()} title="Financial Snapshot" lead="Public disclosures only">
            <FinancialTable rows={d.financial.rows} disclaimer={d.financial.disclaimer} />
          </Section>
        )}

        {d.geography && d.geography.length > 0 && (
          <Section num={sec()} title="Geographic Footprint">
            <GeographyPills locations={d.geography} />
          </Section>
        )}

        {d.competition && (
          <Section num={sec()} title="Competition & Positioning">
            <div className="space-y-3">
              {d.competition.competitors && d.competition.competitors.length > 0 && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Competitors</div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.competition.competitors.map((c, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 bg-[#0e1518] border border-emerald-900/40 text-emerald-50">{c}</span>
                    ))}
                  </div>
                </div>
              )}
              {d.competition.positioning && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Positioning</div>
                  <p className="text-[13px] text-emerald-50">{d.competition.positioning}</p>
                </div>
              )}
              {d.competition.moat && (
                <div>
                  <div className="text-[9px] font-mono tracking-[0.18em] uppercase text-emerald-400/55 mb-1">Moat</div>
                  <p className="text-[13px] text-emerald-50">{d.competition.moat}</p>
                </div>
              )}
            </div>
          </Section>
        )}

        {d.recentNews && d.recentNews.length > 0 && (
          <Section num={sec()} title="Recent News & Signals">
            <NewsItems items={d.recentNews} />
          </Section>
        )}

        {d.recognition && d.recognition.length > 0 && (
          <Section num={sec()} title="Recognition & Honours">
            <RecognitionList items={d.recognition} />
          </Section>
        )}

        {/* Alerts — always visible */}
        {d.alerts.length > 0 && (
          <div className="py-4 border-b border-emerald-900/40">
            <AlertsBox alerts={d.alerts} />
          </div>
        )}

        {/* Sources */}
        {d.sources.length > 0 && (
          <Section num={sec()} title="Source Index" lead={`${d.sources.length} sources`}>
            <SourceGrid sources={d.sources} />
          </Section>
        )}
      </div>

      {/* Footer */}
      <div className="bg-[#020608] text-emerald-400/70 px-6 py-4 text-[10px] font-mono tracking-wide border-t border-emerald-500/20">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-emerald-300 font-semibold tracking-[0.15em]">Hebbs.ai</span>
            {" with "}
            <span className="text-emerald-200">{d.model}</span>
          </div>
          <div>
            Enriched {new Date(d.enrichedAt).toLocaleDateString()} {"\u00b7"} {d.sourceCount} sources {"\u00b7"} v{d.version}
          </div>
        </div>
      </div>
    </div>
  );
}
