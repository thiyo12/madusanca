import { z } from "zod";

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const dateOnlySchema = z.string().refine(isValidDateOnly, "Please choose a valid date.");

export const availabilityQuerySchema = z.object({
  lessonId: z.string().trim().min(1).max(64),
  /** YYYY-MM-DD (Vancouver); defaults server-side to today. */
  from: z
    .string()
    .refine(isValidDateOnly, "Invalid date.")
    .optional(),
  to: z
    .string()
    .refine(isValidDateOnly, "Invalid date.")
    .optional(),
}).strict();

export const createBookingSchema = z.object({
  lessonId: z.string().trim().min(1).max(64),
  startsAt: isoDateTimeSchema,
  studentName: z.string().trim().min(2, "Please enter your name.").max(80),
  email: z.email("Please enter a valid email address.").max(160),
  phone: z
    .string()
    .trim()
    .min(7, "Please enter a phone number we can reach you at.")
    .max(25),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  /** Honeypot — bots fill it and the route silently pretends to succeed. */
  website: z.string().trim().max(120).optional().or(z.literal("")),
  consent: z.literal(true, {
    message: "You must agree to the privacy policy.",
  }),
}).strict();

export const manageSchema = z.object({
  action: z.enum(["get", "reschedule", "cancel"]),
  startsAt: isoDateTimeSchema.optional(),
}).strict();


/**
 * Self-service booking finder: prove email ownership with a one-time code,
 * then list and manage bookings. No token required up front.
 */
export const otpSchema = z
  .object({
    action: z.enum(["send", "verify", "token"]),
    email: z.email("Please enter the email you booked with.").max(160),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code.")
      .optional(),
    reference: z
      .string()
      .trim()
      .regex(/^WDA-[A-Z0-9]{6}$/i, "Reference looks like WDA-XXXXXX.")
      .optional()
      .or(z.literal("")),
  }).strict()
  .refine((data) => data.action === "send" || Boolean(data.code), {
    message: "Enter the 6-digit code.",
    path: ["code"],
  });

/** Admin lesson-catalogue editor (package/module pricing cards). */
export const lessonFormSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{3,64}$/, "Invalid lesson id."),
  name: z.string().trim().min(3, "Name is too short.").max(80, "Name is too long."),
  durationMin: z.coerce
    .number({ message: "Duration must be a number." })
    .int("Duration must be whole minutes.")
    .min(15, "Minimum duration is 15 minutes.")
    .max(600, "Maximum duration is 600 minutes."),
  priceCad: z.coerce
    .number({ message: "Price must be a number." })
    .min(0, "Price cannot be negative.")
    .max(10000, "Price looks too high."),
  description: z
    .string()
    .trim()
    .min(3, "Add a short description.")
    .max(200, "Description is too long."),
  features: z
    .array(z.string().trim().min(1).max(100))
    .min(1, "List at least one feature.")
    .max(8, "Maximum 8 features."),
  category: z.enum(["package", "module"], { message: "Pick a category." }),
  popular: z.boolean(),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type CreateBookingInputDto = z.infer<typeof createBookingSchema>;
export type ManageInput = z.infer<typeof manageSchema>;
export type OtpInput = z.infer<typeof otpSchema>;
export type LessonFormInput = z.infer<typeof lessonFormSchema>;
