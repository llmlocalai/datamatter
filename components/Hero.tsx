export default function Hero() {
  const stats = [
    { value: "$800B+", label: "Defense Budget Analyzed" },
    { value: "100+", label: "ML Models Deployed" },
    { value: "5-Year", label: "PPBE Window Coverage" },
    { value: "24/7", label: "Automated Pipelines" },
  ];

  return (
    <section
      id="hero"
      className="relative min-h-screen flex items-center justify-center overflow-hidden grid-pattern"
    >
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent-500/10 rounded-full blur-3xl animate-pulse-glow" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent-400/8 rounded-full blur-3xl animate-pulse-glow" style={{ animationDelay: "2s" }} />

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="animate-fade-in-up">
          <span className="inline-block px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-accent-400 bg-accent-500/10 border border-accent-500/20 rounded-full mb-6">
            Office of the Under Secretary of Defense for Comptroller
          </span>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-navy-50 leading-tight">
            AI & Data Solutions for{" "}
            <span className="gradient-text">DoD Budget Analysis</span>
          </h1>

          <p className="mt-6 text-lg text-navy-300 max-w-2xl mx-auto leading-relaxed">
            Leveraging machine learning, natural language processing, and
            advanced data analytics to transform how the Department of Defense
            plans, justifies, and manages its budget.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#solutions"
              className="px-8 py-3.5 bg-accent-500 hover:bg-accent-600 text-navy-950 font-semibold rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-accent-500/25"
            >
              Explore Solutions
            </a>
            <a
              href="#contact"
              className="px-8 py-3.5 border border-navy-600 hover:border-accent-500/50 text-navy-200 hover:text-accent-400 font-medium rounded-lg transition-all duration-200"
            >
              Get in Touch
            </a>
          </div>
        </div>

        <div className="mt-20 grid grid-cols-2 sm:grid-cols-4 gap-6 animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl sm:text-3xl font-bold text-accent-400">
                {stat.value}
              </div>
              <div className="text-xs sm:text-sm text-navy-400 mt-1">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-navy-950 to-transparent" />
    </section>
  );
}
