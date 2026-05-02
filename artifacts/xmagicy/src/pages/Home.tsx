import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useSubmitContact } from "@workspace/api-client-react";
import { SiYoutube, SiTiktok } from "react-icons/si";
import { Mail, Image as ImageIcon, Video, TrendingUp, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

import avatarPng from "@/assets/avatar.png";
import thumb1Png from "@/assets/thumb-1.png";
import thumb2Png from "@/assets/thumb-2.png";
import thumb3Png from "@/assets/thumb-3.png";
import thumb4Png from "@/assets/thumb-4.png";
import thumb5Png from "@/assets/thumb-5.png";
import thumb6Png from "@/assets/thumb-6.png";

const portfolioItems = [
  {
    id: 1,
    title: "Cinematic Gaming Edit",
    type: "Video edit",
    image: thumb1Png,
    description: "A fast-paced, highly edited gaming montage with dynamic transitions, sound design, and color grading. (Placeholder artwork)",
  },
  {
    id: 2,
    title: "Tech Review Hook",
    type: "Thumbnail",
    image: thumb2Png,
    description: "High CTR thumbnail for a tech review channel. Bold colors, clear subject, and intriguing text. (Placeholder artwork)",
  },
  {
    id: 3,
    title: "Finance Channel Growth",
    type: "Channel",
    image: thumb3Png,
    description: "Helped a personal finance channel double their monthly views through strategic packaging and retention editing. (Placeholder artwork)",
  },
  {
    id: 4,
    title: "Vlog Storytelling",
    type: "Video edit",
    image: thumb4Png,
    description: "Narrative-driven edit for a travel vlog. Focus on pacing, music selection, and emotional beats. (Placeholder artwork)",
  },
  {
    id: 5,
    title: "Podcast Highlights",
    type: "Thumbnail",
    image: thumb5Png,
    description: "Eye-catching thumbnail for a podcast clip designed to stand out on mobile feeds. (Placeholder artwork)",
  },
  {
    id: 6,
    title: "Brand Identity Refresh",
    type: "Channel",
    image: thumb6Png,
    description: "Complete visual overhaul for a creator including banner, profile picture, and thumbnail templates. (Placeholder artwork)",
  },
];

const contactSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name is too long"),
  email: z.string().email("Invalid email address"),
  message: z.string().min(1, "Message is required").max(4000, "Message is too long"),
});

const fadeInUp: import("framer-motion").Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2
    }
  }
};

export default function Home() {
  const { toast } = useToast();
  const [selectedProject, setSelectedProject] = useState<typeof portfolioItems[0] | null>(null);

  const form = useForm<z.infer<typeof contactSchema>>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      email: "",
      message: "",
    },
  });

  const submitContact = useSubmitContact();

  const onSubmit = (values: z.infer<typeof contactSchema>) => {
    submitContact.mutate(
      { data: values },
      {
        onSuccess: () => {
          toast({
            title: "Message sent!",
            description: "Thanks for reaching out. I'll get back to you soon.",
          });
          form.reset();
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Uh oh.",
            description: "Something went wrong. Please try again later.",
          });
        },
      }
    );
  };

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Lock body scroll when modal is open
  useEffect(() => {
    if (selectedProject) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [selectedProject]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedProject(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden selection:bg-primary/30">
      {/* Header */}
      <header className="fixed top-0 w-full z-40 bg-background/80 backdrop-blur-md border-b border-white/5">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div 
            className="text-2xl font-black tracking-tighter cursor-pointer"
            onClick={() => scrollTo("hero")}
            data-testid="link-home"
          >
            <span className="text-white">x</span>
            <span className="text-gradient">M</span>
            <span className="text-white">agicy</span>
          </div>
          <nav className="hidden md:flex gap-8 text-sm font-medium text-muted-foreground">
            {["About", "Work", "Services", "Contact"].map((item) => (
              <button
                key={item}
                onClick={() => scrollTo(item.toLowerCase())}
                className="hover:text-white transition-colors"
                data-testid={`link-${item.toLowerCase()}`}
              >
                {item}
              </button>
            ))}
          </nav>
          <Button 
            className="md:hidden bg-white/10 hover:bg-white/20 text-white"
            onClick={() => scrollTo("contact")}
            data-testid="button-mobile-contact"
          >
            Hire me
          </Button>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section id="hero" className="relative min-h-[100dvh] flex items-center justify-center pt-20">
          <div className="container mx-auto px-6 relative z-10 text-center">
            <motion.div
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
              className="max-w-4xl mx-auto"
            >
              <motion.h1 
                variants={fadeInUp}
                className="text-6xl md:text-8xl lg:text-9xl font-black tracking-tighter mb-6"
              >
                <span className="text-white">x</span>
                <span className="text-gradient">M</span>
                <span className="text-white">agicy</span>
              </motion.h1>
              <motion.p 
                variants={fadeInUp}
                className="text-xl md:text-2xl text-muted-foreground mb-4 font-medium"
              >
                Thumbnail design and video editing
              </motion.p>
              <motion.p 
                variants={fadeInUp}
                className="text-2xl md:text-4xl font-medium text-white/90"
              >
                I help creators make work that gets clicked.
              </motion.p>
            </motion.div>
          </div>
          
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 1 }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 cursor-pointer text-muted-foreground hover:text-white transition-colors"
            onClick={() => scrollTo("about")}
            data-testid="scroll-indicator"
          >
            <span className="text-xs uppercase tracking-widest font-medium">Scroll to see my work</span>
            <motion.div 
              animate={{ y: [0, 8, 0] }} 
              transition={{ repeat: Infinity, duration: 2, ease: [0.42, 0, 0.58, 1] }}
              className="w-px h-12 bg-gradient-to-b from-primary/50 to-transparent"
            />
          </motion.div>
        </section>

        {/* About Section */}
        <section id="about" className="py-32 relative">
          <div className="container mx-auto px-6">
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={staggerContainer}
              className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-12 md:gap-20"
            >
              <motion.div variants={fadeInUp} className="w-48 h-48 md:w-64 md:h-64 shrink-0 rounded-full overflow-hidden border border-white/10 relative group">
                <div className="absolute inset-0 bg-gradient opacity-0 group-hover:opacity-20 transition-opacity duration-500 z-10 mix-blend-overlay"></div>
                <img src={avatarPng} alt="Maarten (xMagicy)" className="w-full h-full object-cover" />
                <div className="absolute bottom-2 left-0 right-0 text-center z-20">
                  <span className="text-[10px] text-white/40 bg-black/40 px-2 py-1 rounded backdrop-blur-sm">Placeholder</span>
                </div>
              </motion.div>
              <motion.div variants={fadeInUp} className="space-y-6 text-lg md:text-xl text-muted-foreground leading-relaxed">
                <p>
                  I'm Maarten, a 24-year-old creative from the Netherlands. I work full-time on YouTube, specializing in freelance thumbnail design and video editing that drives retention and clicks.
                </p>
                <p>
                  I'm always exploring new creative tools to push the boundaries of what's possible, and recently started vibe coding to build better experiences.
                </p>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Portfolio Section */}
        <section id="work" className="py-32 bg-black/20">
          <div className="container mx-auto px-6">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={fadeInUp}
              className="mb-16 md:mb-24 text-center md:text-left"
            >
              <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Selected Work</h2>
              <p className="text-muted-foreground text-lg">Clicking makes them bigger.</p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {portfolioItems.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="group relative cursor-pointer"
                  onClick={() => setSelectedProject(item)}
                  data-testid={`card-portfolio-${item.id}`}
                >
                  <div className="aspect-video w-full overflow-hidden rounded-lg bg-card border border-white/5 transition-all duration-500 group-hover:scale-[1.02] group-hover:border-primary/30 hover-glow">
                    <img src={item.image} alt={item.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 opacity-80 group-hover:opacity-100" />
                    <div className="absolute top-2 right-2">
                      <span className="text-[10px] text-white/50 bg-black/60 px-2 py-1 rounded backdrop-blur-sm">Placeholder</span>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white/90 group-hover:text-white transition-colors">{item.title}</h3>
                    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-white/5 text-muted-foreground border border-white/5">
                      {item.type}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Services Section */}
        <section id="services" className="py-32">
          <div className="container mx-auto px-6">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={fadeInUp}
              className="mb-16 md:mb-24 text-center md:text-left"
            >
              <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Services</h2>
              <p className="text-muted-foreground text-lg">How I can help your channel grow.</p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { title: "Thumbnail design", icon: ImageIcon, desc: "High-CTR packaging that gets viewers through the door." },
                { title: "Video editing", icon: Video, desc: "Retention-driven editing that keeps them watching until the end." },
                { title: "Channel building", icon: TrendingUp, desc: "Strategic advice on formats, branding, and long-term growth." }
              ].map((service, i) => (
                <motion.div
                  key={service.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="p-8 rounded-2xl bg-card border border-white/5 flex flex-col h-full hover:border-primary/20 transition-colors"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6 text-primary">
                    <service.icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">{service.title}</h3>
                  <p className="text-muted-foreground mb-8 flex-grow">{service.desc}</p>
                  <button 
                    onClick={() => scrollTo("contact")}
                    className="text-sm font-bold text-primary hover:text-white transition-colors self-start flex items-center gap-2"
                    data-testid={`button-service-${i}`}
                  >
                    Get in touch <TrendingUp className="w-4 h-4" />
                  </button>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section id="contact" className="py-32 bg-black/20 border-t border-white/5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient opacity-[0.03] mix-blend-screen pointer-events-none"></div>
          
          <div className="container mx-auto px-6 relative z-10">
            <div className="max-w-5xl mx-auto flex flex-col lg:flex-row gap-16 lg:gap-24">
              
              <motion.div 
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-100px" }}
                variants={fadeInUp}
                className="lg:w-1/3"
              >
                <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-6">Let's work.</h2>
                <p className="text-muted-foreground text-lg mb-10">
                  Ready to level up your channel? Drop me a message and let's discuss how we can collaborate.
                </p>
                
                <div className="space-y-6">
                  <a href="mailto:hello@xmagicy.com" className="flex items-center gap-4 text-muted-foreground hover:text-white transition-colors group" data-testid="link-social-email">
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary/20 group-hover:text-primary transition-colors">
                      <Mail className="w-5 h-5" />
                    </div>
                    <span className="font-medium">hello@xmagicy.com</span>
                  </a>
                  <a href="https://youtube.com/@xmagicy" target="_blank" rel="noreferrer" className="flex items-center gap-4 text-muted-foreground hover:text-white transition-colors group" data-testid="link-social-youtube">
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-red-500/20 group-hover:text-red-500 transition-colors">
                      <SiYoutube className="w-5 h-5" />
                    </div>
                    <span className="font-medium">YouTube</span>
                  </a>
                  <a href="https://tiktok.com/@xmagicy" target="_blank" rel="noreferrer" className="flex items-center gap-4 text-muted-foreground hover:text-white transition-colors group" data-testid="link-social-tiktok">
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white/20 group-hover:text-white transition-colors">
                      <SiTiktok className="w-5 h-5" />
                    </div>
                    <span className="font-medium">TikTok</span>
                  </a>
                </div>
              </motion.div>

              <motion.div 
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-100px" }}
                variants={fadeInUp}
                className="lg:w-2/3"
              >
                <div className="bg-card/50 backdrop-blur-sm border border-white/10 rounded-2xl p-8 md:p-10">
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/70">Name</FormLabel>
                            <FormControl>
                              <Input placeholder="John Doe" className="bg-black/40 border-white/10 focus-visible:ring-primary h-12" {...field} data-testid="input-name" />
                            </FormControl>
                            <FormMessage className="text-destructive" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/70">Email</FormLabel>
                            <FormControl>
                              <Input placeholder="john@example.com" className="bg-black/40 border-white/10 focus-visible:ring-primary h-12" {...field} data-testid="input-email" />
                            </FormControl>
                            <FormMessage className="text-destructive" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="message"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/70">Message</FormLabel>
                            <FormControl>
                              <Textarea 
                                placeholder="Tell me about your channel and what you need help with..." 
                                className="bg-black/40 border-white/10 focus-visible:ring-primary min-h-[150px] resize-none" 
                                {...field} 
                                data-testid="input-message"
                              />
                            </FormControl>
                            <FormMessage className="text-destructive" />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        disabled={submitContact.isPending}
                        className="w-full bg-white text-black hover:bg-white/90 h-12 font-bold text-base"
                        data-testid="button-submit"
                      >
                        {submitContact.isPending ? (
                          <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending...</>
                        ) : "Send message"}
                      </Button>
                    </form>
                  </Form>
                </div>
              </motion.div>
              
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-10 bg-background">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <p className="text-sm text-muted-foreground">© 2026 xMagicy. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <a href="https://youtube.com/@xmagicy" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-white transition-colors" data-testid="link-footer-youtube">
              <SiYoutube className="w-5 h-5" />
            </a>
            <a href="https://tiktok.com/@xmagicy" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-white transition-colors" data-testid="link-footer-tiktok">
              <SiTiktok className="w-5 h-5" />
            </a>
          </div>
        </div>
      </footer>

      {/* Project Modal */}
      <AnimatePresence>
        {selectedProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" data-testid="modal-portfolio">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setSelectedProject(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-4xl bg-card border border-white/10 rounded-2xl overflow-hidden shadow-2xl z-10 flex flex-col max-h-[90vh]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-title"
            >
              <button 
                onClick={() => setSelectedProject(null)}
                className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center transition-colors backdrop-blur-md"
                data-testid="button-close-modal"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="w-full aspect-video bg-black relative shrink-0">
                <img 
                  src={selectedProject.image} 
                  alt={selectedProject.title} 
                  className="w-full h-full object-contain" 
                />
                <div className="absolute bottom-4 right-4">
                  <span className="text-xs text-white/50 bg-black/80 px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10">Placeholder Artwork</span>
                </div>
              </div>
              
              <div className="p-8 overflow-y-auto">
                <div className="flex items-center gap-4 mb-4">
                  <h2 id="modal-title" className="text-2xl md:text-3xl font-bold">{selectedProject.title}</h2>
                  <span className="text-xs font-medium px-3 py-1 rounded-full bg-primary/20 text-primary border border-primary/20">
                    {selectedProject.type}
                  </span>
                </div>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  {selectedProject.description}
                </p>
                <div className="mt-8 pt-8 border-t border-white/5">
                  <Button 
                    className="bg-white text-black hover:bg-white/90"
                    onClick={() => {
                      setSelectedProject(null);
                      setTimeout(() => scrollTo("contact"), 100);
                    }}
                    data-testid="button-modal-contact"
                  >
                    I want something like this
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
