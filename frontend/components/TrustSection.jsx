const logos = ["NORTHSTAR", "ATLAS", "MERIDIAN", "CLEARLEDGER", "QUANTA"];

export default function TrustSection() {
  const repeatedLogos = [...logos, ...logos];

  return (
    <section className="overflow-hidden border-y border-black/5 bg-white/70 py-8">
      <div className="container-shell grid gap-5 text-center md:grid-cols-[0.8fr_2fr] md:text-left">
        <p className="text-sm font-semibold text-black/50">Trusted by fast-moving SMEs</p>
        <div className="relative overflow-hidden">
          <div className="animate-marquee flex min-w-max gap-10">
            {repeatedLogos.map((logo, index) => (
            <div key={`${logo}-${index}`} className="shimmer-surface text-sm font-black tracking-[0.18em] text-black/35">
              {logo}
            </div>
          ))}
          </div>
        </div>
      </div>
    </section>
  );
}
