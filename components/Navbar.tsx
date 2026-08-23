"use client";

import { useState, useEffect } from "react";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const links = [
    { href: "/showcase", label: "Showcases" },
    { href: "/contracting", label: "Contracting" },
   { href: "/funds-control", label: "Funds Control" },
   { href: "/regulation", label: "Regulation Q&A" },
   { href: "/budget", label: "Budget" },
    { href: "/ppbe", label: "PPBE" },
    { href: "/gao", label: "GAO" },
    { href: "/congressional", label: "Congress" },
  ];

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-navy-950/90 backdrop-blur-md border-b border-navy-800/50 shadow-lg"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <a href="#" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-400 to-accent-600 flex items-center justify-center text-navy-950 font-bold text-xs">
              AI
            </div>
            <span className="text-navy-100 font-semibold text-sm hidden sm:block">
              DoD AI Solutions
            </span>
          </a>

          <div className="hidden md:flex items-center gap-8">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-navy-300 hover:text-accent-400 text-sm font-medium transition-colors duration-200"
              >
                {link.label}
              </a>
            ))}
            <a
              href="#contact"
              className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-navy-950 text-sm font-semibold rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-accent-500/20"
            >
              Get in Touch
            </a>
          </div>

          <button
            className="md:hidden text-navy-200"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden pb-4 space-y-3">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="block text-navy-300 hover:text-accent-400 text-sm font-medium py-2"
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <a
              href="#contact"
              className="block px-4 py-2 bg-accent-500 text-navy-950 text-sm font-semibold rounded-lg text-center"
              onClick={() => setMenuOpen(false)}
            >
              Get in Touch
            </a>
          </div>
        )}
      </div>
    </nav>
  );
}
