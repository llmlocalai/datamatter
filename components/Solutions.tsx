export default function Solutions() {
  const solutions = [
     {
      icon: "🤖",
      title: "AI-Powered Cost Estimation",
      desc: "Machine learning models that analyze historical program data to produce accurate, defensible cost estimates for DoD acquisition programs — reducing variance and improving budget justification.",
      tags: ["Random Forest", "XGBoost", "Time Series"],
     },
     {
      icon: "📈",
      title: "Resource Allocation Optimization",
      desc: "Constraint-based optimization algorithms that model trade-offs across programs, services, and fiscal years to maximize mission readiness per dollar.",
      tags: ["Linear Programming", "Monte Carlo", "Pareto"],
     },
     {
      icon: "📝",
      title: "NLP for Budget Justification",
      desc: "Natural language processing pipelines that parse and summarize program justifications, flag inconsistencies, and auto-generate congressional budget submission narratives.",
      tags: ["LLMs", "NER", "Summarization"],
     },
     {
      icon: "🔗",
      title: "Automated Data Pipelines",
      desc: "ETL pipelines that ingest data from DoD financial systems (DAF, Navy, Army) into unified analytics platforms with real-time dashboards for budget tracking.",
      tags: ["Python", "SQL", "Airflow"],
     },
     {
      icon: "📊",
      title: "Fiscal Policy Simulation",
      desc: "Agent-based and scenario simulation models that project the fiscal impact of policy changes across the 5-year defense budget window.",
      tags: ["System Dynamics", "Scenario Analysis", "R"],
     },
     {
      icon: "🔒",
      title: "Data Security & Compliance",
      desc: "Role-based access control, data classification handling, and audit trails ensuring all analytics comply with DoD data governance and CUI handling requirements.",
      tags: ["RBAC", "CUI", "Audit Logs"],
     },
   ];

  return (
     <section id="solutions" className="py-24 px-4 sm:px-6 lg:px-8">
       <div className="max-w-6xl mx-auto">
         <div className="text-center mb-16">
           <span className="text-accent-400 text-sm font-semibold uppercase tracking-wider">
            Solutions
           </span>
           <h2 className="text-3xl sm:text-4xl font-bold text-navy-50 mt-3">
            AI & Data Solutions for DoD Budget Analysis
           </h2>
           <div className="w-16 h-1 bg-accent-500 rounded-full mx-auto mt-4" />
         </div>

         <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
           {solutions.map((s) => (
             <div
              key={s.title}
              className="glass-card rounded-xl p-6 hover:border-accent-500/40 hover:shadow-lg hover:shadow-accent-500/5 transition-all duration-300 group"
             >
               <span className="text-3xl">{s.icon}</span>
               <h3 className="text-navy-100 font-semibold text-base mt-4">
                 {s.title}
               </h3>
               <p className="text-navy-400 text-sm mt-2 leading-relaxed">
                 {s.desc}
               </p>
               <div className="flex flex-wrap gap-2 mt-4">
                 {s.tags.map((tag) => (
                   <span
                    key={tag}
                    className="px-2.5 py-1 text-xs font-medium rounded-full bg-navy-800/60 text-accent-400 border border-navy-700/40"
                   >
                     {tag}
                   </span>
                 ))}
               </div>
             </div>
           ))}
         </div>
       </div>
     </section>
   );
}
