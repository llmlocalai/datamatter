"use client";

import { useState } from "react";

export default function Contact() {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
   };

  return (
      <section id="contact" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-accent-400 text-sm font-semibold uppercase tracking-wider">
            Contact
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-navy-50 mt-3">
            Let's Build Smarter Budget Analytics
            </h2>
            <div className="w-16 h-1 bg-accent-500 rounded-full mx-auto mt-4" />
          </div>

          {submitted ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <span className="text-4xl">✅</span>
              <h3 className="text-navy-100 font-semibold text-lg mt-4">
              Message Sent!
              </h3>
              <p className="text-navy-400 text-sm mt-2">
              Thank you for reaching out. I'll get back to you shortly.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="glass-card rounded-xl p-8 space-y-5">
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label className="text-navy-300 text-sm font-medium block mb-2">
                  Name
                  </label>
                  <input
                  type="text"
                  required
                  className="w-full px-4 py-2.5 rounded-lg bg-navy-900/60 border border-navy-700/40 text-navy-100 text-sm focus:outline-none focus:border-accent-500 transition-colors"
                  placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="text-navy-300 text-sm font-medium block mb-2">
                  Email
                  </label>
                  <input
                  type="email"
                  required
                  className="w-full px-4 py-2.5 rounded-lg bg-navy-900/60 border border-navy-700/40 text-navy-100 text-sm focus:outline-none focus:border-accent-500 transition-colors"
                  placeholder="you@example.com"
                  />
                </div>
              </div>
              <div>
                <label className="text-navy-300 text-sm font-medium block mb-2">
                Subject
                </label>
                <input
                type="text"
                className="w-full px-4 py-2.5 rounded-lg bg-navy-900/60 border border-navy-700/40 text-navy-100 text-sm focus:outline-none focus:border-accent-500 transition-colors"
                placeholder="Project inquiry, collaboration, etc."
                />
              </div>
              <div>
                <label className="text-navy-300 text-sm font-medium block mb-2">
                Message
                </label>
                <textarea
                rows={4}
                required
                className="w-full px-4 py-2.5 rounded-lg bg-navy-900/60 border border-navy-700/40 text-navy-100 text-sm focus:outline-none focus:border-accent-500 transition-colors resize-none"
                placeholder="Describe your project or question..."
                />
              </div>
              <button
              type="submit"
              className="w-full px-6 py-3 bg-accent-500 hover:bg-accent-600 text-navy-950 font-semibold rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-accent-500/20"
              >
              Send Message
              </button>
            </form>
          )}
        </div>
      </section>
    );
}
