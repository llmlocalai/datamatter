export default function About() {
  const focusAreas = [
     {
      icon: "🎯",
      title: "Cost Estimation",
      desc: "ML-driven program cost models",
     },
     {
      icon: "📋",
      title: "Budget Justification",
      desc: "NLP for OMB 30/130 submissions",
     },
     {
      icon: "⚙️",
      title: "Resource Optimization",
      desc: "Constraint-based allocation models",
     },
     {
      icon: "📊",
      title: "Fiscal Forecasting",
      desc: "5-year PPBE scenario analysis",
     },
   ];

  return (
     <section id="about" className="py-24 px-4 sm:px-6 lg:px-8">
       <div className="max-w-6xl mx-auto">
         <div className="grid lg:grid-cols-2 gap-12 items-center">
           <div>
             <span className="text-accent-400 text-sm font-semibold uppercase tracking-wider">
              About
             </span>
             <h2 className="text-3xl sm:text-4xl font-bold text-navy-50 mt-3">
              Bridging AI & Defense Budgeting
             </h2>
             <p className="mt-6 text-navy-300 leading-relaxed">
              As a budget analyst at OUSD(C), I develop and deploy AI and data
              science solutions that support the Department of Defense's
              Planning, Programming, Budgeting, and Execution (PPBE) process.
              My work spans machine learning for cost estimation, NLP for
              budget justification narratives, and optimization models for
              resource allocation across the 5-year defense budget window.
             </p>
             <p className="mt-4 text-navy-400 leading-relaxed">
              Every solution is designed to be defensible, auditable, and
              aligned with DoD data governance and CUI handling requirements.
             </p>
           </div>

           <div className="grid grid-cols-2 gap-4">
             {focusAreas.map((area) => (
               <div
                key={area.title}
                className="glass-card rounded-xl p-5 hover:border-accent-500/30 transition-all duration-300"
               >
                 <span className="text-2xl">{area.icon}</span>
                 <h3 className="text-navy-100 font-semibold text-sm mt-3">
                   {area.title}
                 </h3>
                 <p className="text-navy-400 text-xs mt-1">{area.desc}</p>
               </div>
             ))}
           </div>
         </div>
       </div>
     </section>
   );
}
