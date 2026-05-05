export default function FeatureCard({ icon: Icon, title, description, index = 0 }) {
  return (
    <div className="animate-reveal group rounded-[1.35rem] border border-black/10 bg-white p-6 shadow-md hover:-translate-y-2 hover:border-leaf/30 hover:shadow-glow" style={{ animationDelay: `${index * 90}ms` }}>
      <div className="grid h-12 w-12 place-items-center rounded-full bg-[#c8dc94] text-ink group-hover:rotate-3 group-hover:scale-110">
        <Icon size={24} />
      </div>
      <h3 className="mt-6 text-xl font-black text-ink">{title}</h3>
      <p className="mt-3 leading-7 text-black/60">{description}</p>
    </div>
  );
}
