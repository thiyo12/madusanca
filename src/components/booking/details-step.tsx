"use client";

export interface DetailsStepProps {
  value: DetailsValue;
  onChange: (next: DetailsValue) => void;
  error: string | null;
}

export interface DetailsValue {
  firstName: string;
  lastName: string;
  studentName: string;
  licenseClass: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  notes: string;
  website: string;
  consent: boolean;
}

export const emptyDetails: DetailsValue = {
  firstName: "",
  lastName: "",
  studentName: "",
  licenseClass: "",
  email: "",
  phone: "",
  street: "",
  city: "",
  province: "BC",
  postalCode: "",
  notes: "",
  website: "",
  consent: false,
};

const inputClasses =
  "w-full rounded-[13px] border border-[#d7dfdc] bg-white px-3.5 py-3 text-sm text-ink outline-none transition-colors placeholder:text-[#91a0a4] focus:border-[#83b657] focus:ring-[3px] focus:ring-[#c2ee84]/35";

const labelClasses = "grid gap-1.5 text-[12px] font-bold text-ink";

export function DetailsStep({ value, onChange, error }: DetailsStepProps) {
  function set<K extends keyof DetailsValue>(key: K, next: DetailsValue[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClasses}>
          First name *
          <input
            autoComplete="given-name"
            required
            maxLength={30}
            placeholder="First name"
            className={inputClasses}
            value={value.firstName}
            onChange={(event) => set("firstName", event.target.value)}
          />
        </label>
        <label className={labelClasses}>
          Last name *
          <input
            autoComplete="family-name"
            required
            maxLength={30}
            placeholder="Last name"
            className={inputClasses}
            value={value.lastName}
            onChange={(event) => set("lastName", event.target.value)}
          />
        </label>
        <label className={labelClasses}>
          Full legal name (as shown on licence) *
          <input
            autoComplete="name"
            required
            maxLength={60}
            placeholder="Your full name"
            className={inputClasses}
            value={value.studentName}
            onChange={(event) => set("studentName", event.target.value)}
          />
        </label>
        <label className={labelClasses}>
          BC licence class *
          <select
            required
            className={inputClasses}
            value={value.licenseClass}
            onChange={(event) => set("licenseClass", event.target.value)}
          >
            <option value="">Select your class</option>
            <option value="7L">Class 7L (Learner)</option>
            <option value="7N">Class 7N (Novice)</option>
            <option value="5">Class 5</option>
            <option value="Other">Other / out-of-province</option>
          </select>
        </label>
        <label className={labelClasses}>
          Email address *
          <input
            type="email"
            autoComplete="email"
            required
            maxLength={160}
            placeholder="you@example.com"
            className={inputClasses}
            value={value.email}
            onChange={(event) => set("email", event.target.value)}
          />
        </label>
        <label className={labelClasses}>
          Phone number *
          <input
            type="tel"
            autoComplete="tel"
            required
            maxLength={25}
            placeholder="(604) 555-0199"
            className={inputClasses}
            value={value.phone}
            onChange={(event) => set("phone", event.target.value)}
          />
        </label>
        <label className={`${labelClasses} sm:col-span-2`}>
          Pickup street address *
          <input
            autoComplete="street-address"
            required
            maxLength={60}
            placeholder="Street address"
            className={inputClasses}
            value={value.street}
            onChange={(event) => set("street", event.target.value)}
          />
        </label>
        <label className={labelClasses}>
          City *
          <input
            autoComplete="address-level2"
            required
            maxLength={30}
            placeholder="Burnaby"
            className={inputClasses}
            value={value.city}
            onChange={(event) => set("city", event.target.value)}
          />
        </label>
        <label className={labelClasses}>
          Province *
          <select
            required
            className={inputClasses}
            value={value.province}
            onChange={(event) => set("province", event.target.value)}
          >
            <option value="BC">British Columbia (BC)</option>
          </select>
        </label>
        <label className={labelClasses}>
          Postal code *
          <input
            autoComplete="postal-code"
            required
            maxLength={7}
            placeholder="V5H 2A9"
            className={inputClasses}
            value={value.postalCode}
            onChange={(event) => set("postalCode", event.target.value.toUpperCase())}
          />
        </label>
        <label className={`${labelClasses} sm:col-span-2`}>
          Notes for your instructor (optional)
          <textarea
            rows={3}
            maxLength={50}
            placeholder="Pickup notes or experience level…"
            className={`${inputClasses} resize-y`}
            value={value.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        </label>
      </div>

      {/* Honeypot — hidden from real users */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label>
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={value.website}
            onChange={(event) => set("website", event.target.value)}
          />
        </label>
      </div>

      <label className="mt-5 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-[#616872]">
        <input
          type="checkbox"
          required
          checked={value.consent}
          onChange={(event) => set("consent", event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#6a9d42]"
        />
        <span>
          I agree that my details may be used to manage this booking, as described in the{" "}
          <a href="/privacy" className="font-semibold text-gold-deep underline-offset-2 hover:underline">
            Privacy Policy
          </a>
          . *
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-[#fff0ed] px-4 py-3 text-[13px] font-semibold text-[#bc4633]">
          {error}
        </p>
      )}

      <p className="mt-4 text-[12.5px] leading-relaxed text-soft">
        No account is needed. We&rsquo;ll email your confirmation and a private link to manage this booking. Please bring your valid driver&rsquo;s licence to every lesson; we don&rsquo;t collect the licence number or date of birth on this form.
      </p>
    </div>
  );
}
