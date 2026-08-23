export default function Footer() {
  return (
      <footer className="border-t border-navy-800/50 py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-400 to-accent-600 flex items-center justify-center text-navy-950 font-bold text-xs">
              AI
              </div>
              <span className="text-navy-300 text-sm font-medium">
              DoD AI Solutions
              </span>
            </div>

            <div className="flex items-center gap-6">
              <a href="#about" className="text-navy-400 hover:text-accent-400 text-sm transition-colors">
              About
              </a>
              <a href="#solutions" className="text-navy-400 hover:text-accent-400 text-sm transition-colors">
              Solutions
              </a>
              <a href="#contact" className="text-navy-400 hover:text-accent-400 text-sm transition-colors">
              Contact
              </a>
            </div>

            <p className="text-navy-500 text-xs">
              © {new Date().getFullYear()} — All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    );
}
