import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import About from "@/components/About";
import Solutions from "@/components/Solutions";
import Skills from "@/components/Skills";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";

export default function Home() {
  return (
     <main className="min-h-screen bg-navy-950">
       <Navbar />
       <Hero />
       <About />
       <Solutions />
       <Skills />
       <Contact />
       <Footer />
     </main>
   );
}
