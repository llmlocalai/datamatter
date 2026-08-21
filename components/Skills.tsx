export default function Skills() {
  const categories = [
      {
      title: "Machine Learning & AI",
      skills: [
        "Scikit-learn",
        "XGBoost",
        "PyTorch",
        "TensorFlow",
        "Hugging Face Transformers",
        "LangChain",
      ],
      },
      {
      title: "Data Engineering & Analytics",
      skills: [
        "Python (Pandas, NumPy)",
        "SQL (PostgreSQL, BigQuery)",
        "Apache Airflow",
        "dbt",
        "Docker",
      ],
      },
      {
      title: "Visualization & Reporting",
      skills: [
        "Power BI",
        "Tableau",
        "Plotly",
        "Matplotlib",
        "Streamlit",
        "Dash",
      ],
      },
      {
      title: "DoD Budget & Policy",
      skills: [
        "PPBE Process",
        "OMB 30/130",
        "Budget Justification",
        "CBO Scorekeeping",
        "Fiscal Policy Analysis",
      ],
      },
    ];

  return (
      <section id="skills" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-accent-400 text-sm font-semibold uppercase tracking-wider">
            Skills & Tools
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-navy-50 mt-3">
            Technical & Domain Expertise
            </h2>
            <div className="w-16 h-1 bg-accent-500 rounded-full mx-auto mt-4" />
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {categories.map((cat) => (
              <div key={cat.title} className="glass-card rounded-xl p-6">
                <h3 className="text-accent-400 font-semibold text-sm uppercase tracking-wider mb-4">
                  {cat.title}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {cat.skills.map((skill) => (
                    <span
                    key={skill}
                    className="px-3 py-1.5 text-sm rounded-lg bg-navy-800/50 text-navy-200 border border-navy-700/30 hover:border-accent-500/40 hover:text-accent-400 transition-all duration-200"
                    >
                      {skill}
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
