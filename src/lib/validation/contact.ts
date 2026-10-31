import { z } from "zod";

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(80),
  email: z.email("Please enter a valid email address.").max(160),
  phone: z
    .string()
    .trim()
    .max(25, "Phone number is too long.")
    .optional()
    .or(z.literal("")),
  subject: z.string().trim().max(120).optional().or(z.literal("")),
  message: z
    .string()
    .trim()
    .min(10, "Message should be at least 10 characters.")
    .max(2000),
  /** Honeypot — hidden field; bots fill it and the route silently drops them */
  website: z.string().trim().max(120).optional().or(z.literal("")),
  consent: z.literal(true, {
    message: "You must agree to the privacy policy.",
  }),
}).strict();

export type ContactInput = z.input<typeof contactSchema>;
export type ContactData = z.output<typeof contactSchema>;
