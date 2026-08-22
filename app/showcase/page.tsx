import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const showcases = [
  {
    title: 'Budget Analysis Dashboard',
    description:
      'Enterprise-grade budget analysis for senior budget analysts. Leverage USASpending data, PPBE compliance metrics, and congressional oversight tracking.',
    icon: '📊',
    href: '/budget',
    tags: ['USASpending', 'PPBE', 'DoD Budget'],
    features: [
      'Budget function analysis',
      'Agency allocation tracking',
      'Fiscal year trends',
      'Real-time data updates',
    ],
  },
  {
    title: 'PPBE Compliance Tracker',
    description:
      'Track program compliance with Planning, Programming, and Budgeting System requirements across the Department of Defense.',
    icon: '📋',
    href: '/ppbe',
    tags: ['PPBE', 'OMB 30/130', 'Compliance'],
    features: [
      'Program compliance rates',
      'OMB Circular tracking',
      'Justification quality scoring',
      'Automated alerts',
    ],
  },
  {
    title: 'GAO Audit Findings',
    description:
      'Track Government Accountability Office findings and material weaknesses across DoD financial statements and budget execution.',
    icon: '🔍',
    href: '/gao',
    tags: ['GAO', 'Audit', 'Material Weaknesses'],
    features: [
      'Year-over-year trends',
      'Finding categorization',
      'Material weakness tracking',
      'Compliance reporting',
    ],
  },
  {
    title: 'Congressional Oversight',
    description:
      'Track congressional requests, testimony schedules, and response rates for senior budget analyst coordination.',
    icon: '🏛️',
    href: '/congressional',
    tags: ['Congress', 'Oversight', 'Testimony'],
    features: [
      'Request tracking',
      'Response rate metrics',
      'Testimony scheduling',
      'Committee coordination',
    ],
  },
];

export default function ShowcasePage() {
  return (
    <main className="min-h-screen bg-navy-950">
      <Navbar />

      {/* Hero Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-navy-800">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-50 mb-6">
            DoD Budget & Audit Showcases
          </h1>
          <p className="text-lg text-navy-300 max-w-3xl mx-auto">
            Enterprise-grade production-ready showcases for senior budget analysts. Built with
            machine learning, natural language processing, and advanced data analytics to
            transform how the Department of Defense plans, justifies, and manages its budget.
          </p>
        </div>
      </section>

      {/* Showcases Grid */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {showcases.map((showcase) => (
              <Link
                key={showcase.title}
                href={showcase.href}
                className="glass-card rounded-xl p-6 hover:border-accent-500/40 hover:shadow-lg transition-all duration-300 group"
              >
                <div className="text-3xl mb-4">{showcase.icon}</div>
                <h3 className="text-navy-50 font-bold text-lg mb-3">{showcase.title}</h3>
                <p className="text-navy-400 text-sm mb-4 line-clamp-4">
                  {showcase.description}
                </p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {showcase.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-1 text-xs font-medium rounded-full bg-navy-800/60 text-accent-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-accent-400 font-semibold">
                  View Details →
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Technology Stack */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-navy-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-50 text-center mb-12">
            Technology Stack
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="glass-card rounded-xl p-6 text-center">
              <h3 className="text-accent-400 font-semibold mb-3">Data Sources</h3>
              <p className="text-navy-300 text-sm">
                USASpending, FMR, OMB Circulars, DoD Guidance, CRS Reports
              </p>
            </div>

            <div className="glass-card rounded-xl p-6 text-center">
              <h3 className="text-accent-400 font-semibold mb-3">ML & AI</h3>
              <p className="text-navy-300 text-sm">
                Scikit-learn, XGBoost, PyTorch, Transformers, LangChain
              </p>
            </div>

            <div className="glass-card rounded-xl p-6 text-center">
              <h3 className="text-accent-400 font-semibold mb-3">Data Engineering</h3>
              <p className="text-navy-300 text-sm">
                Pandas, NumPy, PostgreSQL, BigQuery, Airflow, dbt, Docker
              </p>
            </div>

            <div className="glass-card rounded-xl p-6 text-center">
              <h3 className="text-accent-400 font-semibold mb-3">Visualization</h3>
              <p className="text-navy-300 text-sm">
                Plotly, Power BI, Tableau, Streamlit, Dash
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}