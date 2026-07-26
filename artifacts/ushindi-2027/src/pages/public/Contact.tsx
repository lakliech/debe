import { useState } from "react";
import { Mail, Phone, MapPin, MessageSquare, CheckCircle2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import PublicPortalLayout from "@/components/layout/PublicPortalLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const schema = z.object({
  name: z.string().min(2, "Name required"),
  email: z.string().email("Valid email required"),
  subject: z.string().min(3, "Subject required"),
  message: z.string().min(10, "Please include a message"),
});
type FormData = z.infer<typeof schema>;

const contactCards = [
  {
    icon: MapPin,
    titleEn: "Headquarters",
    titleSw: "Makao Makuu",
    lines: ["Upper Hill, Nairobi", "Kenya"],
  },
  {
    icon: Mail,
    titleEn: "Media Enquiries",
    titleSw: "Maswali ya Habari",
    lines: ["media@lindamwananchi.ke"],
  },
  {
    icon: Phone,
    titleEn: "WhatsApp",
    titleSw: "WhatsApp",
    lines: ["+254 700 000 000"],
  },
];

export default function Contact() {
  const { t } = useLanguage();
  const { toast } = useToast();

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await fetch(`${BASE}/api/public/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send message");
      }
      return res.json();
    },
    onError: (err: any) => {
      toast({
        title: t("Error", "Hitilafu"),
        description: err.message || t("Could not send your message. Please try again.", "Haiwezekani kutuma ujumbe wako. Tafadhali jaribu tena."),
        variant: "destructive",
      });
    },
  });

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = (data: FormData) => mutate(data);

  return (
    <PublicPortalLayout>
      {/* Hero */}
      <section className="bg-black text-white py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-primary mb-2">
            {t("Get in Touch", "Wasiliana")}
          </p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">
            {t("CONTACT US", "WASILIANA NASI")}
          </h1>
        </div>
      </section>

      <section className="py-12 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          {/* Contact info cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
            {contactCards.map((card) => (
              <div key={card.titleEn} className="border border-border p-6 shadow-sm">
                <div className="w-10 h-10 bg-primary flex items-center justify-center mb-3">
                  <card.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-black text-sm uppercase tracking-tight mb-2">
                  {t(card.titleEn, card.titleSw)}
                </h3>
                {card.lines.map((line) => (
                  <p key={line} className="text-muted-foreground text-sm">{line}</p>
                ))}
              </div>
            ))}
          </div>

          {/* Contact form */}
          <div className="max-w-2xl">
            <h2 className="text-lg font-black uppercase tracking-tight mb-6">
              {t("Send a Message", "Tuma Ujumbe")}
            </h2>

            {isSuccess ? (
              <div className="border border-green-200 bg-green-50 p-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-4" />
                <h3 className="font-black text-xl uppercase text-green-800 mb-2">
                  {t("Message Received!", "Ujumbe Umepokelewa!")}
                </h3>
                <p className="text-green-700 text-sm">
                  {t(
                    "Thank you for reaching out. Our team will get back to you within 2–3 business days.",
                    "Asante kwa kuwasiliana nasi. Timu yetu itawasiliana nawe ndani ya siku 2-3 za kazi."
                  )}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name">{t("Full Name *", "Jina Kamili *")}</Label>
                    <Input
                      id="name"
                      {...register("name")}
                      placeholder={t("Your name", "Jina lako")}
                      className={cn("mt-1", errors.name && "border-red-500")}
                    />
                    {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
                  </div>
                  <div>
                    <Label htmlFor="email">{t("Email *", "Barua Pepe *")}</Label>
                    <Input
                      id="email"
                      type="email"
                      {...register("email")}
                      placeholder="email@example.com"
                      className={cn("mt-1", errors.email && "border-red-500")}
                    />
                    {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
                  </div>
                </div>
                <div>
                  <Label htmlFor="subject">{t("Subject *", "Mada *")}</Label>
                  <Input
                    id="subject"
                    {...register("subject")}
                    placeholder={t("What is this about?", "Hii inahusu nini?")}
                    className={cn("mt-1", errors.subject && "border-red-500")}
                  />
                  {errors.subject && <p className="text-red-500 text-xs mt-1">{errors.subject.message}</p>}
                </div>
                <div>
                  <Label htmlFor="message">{t("Message *", "Ujumbe *")}</Label>
                  <Textarea
                    id="message"
                    rows={5}
                    {...register("message")}
                    placeholder={t("Write your message here...", "Andika ujumbe wako hapa...")}
                    className={cn("mt-1", errors.message && "border-red-500")}
                  />
                  {errors.message && <p className="text-red-500 text-xs mt-1">{errors.message.message}</p>}
                </div>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex items-center gap-2 bg-primary text-white hover:bg-primary/90 px-8 py-3 font-bold text-sm tracking-wide transition-colors disabled:opacity-50"
                >
                  <MessageSquare className="h-4 w-4" />
                  {isPending ? t("Sending...", "Inatuma...") : t("Send Message", "Tuma Ujumbe")}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </PublicPortalLayout>
  );
}
