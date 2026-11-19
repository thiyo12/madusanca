import { LocalAreaPage } from "@/components/seo/local-area-page";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Driving Lessons in Vancouver, BC",
  description:
    "Personalized private driving lessons in Vancouver, BC. Get one-on-one beginner instruction, practical coaching, and road-test preparation.",
  path: "/areas/vancouver",
});

export default function VancouverPage() {
  return (
    <LocalAreaPage
      city="Vancouver"
      intro="Get one-on-one instruction that meets you where you are—from your first lessons to focused practice as you work toward a road test."
      focusTitle="Practise with purpose"
      focusText="Every learner arrives with different priorities. Share what feels comfortable, what feels challenging, and what you want to accomplish. Your instructor can use that context to shape a practical lesson and give you clear feedback for what comes next."
      faqs={[
        {
          question: "Are private driving lessons available in Vancouver?",
          answer:
            "Wisdom Driving Academy offers private, one-on-one driving instruction. Contact the academy to confirm current Vancouver scheduling and location arrangements.",
        },
        {
          question: "Can lessons be tailored to my experience?",
          answer:
            "Yes. Coaching is personalized, whether you are a beginner or looking to strengthen particular skills before a road test.",
        },
        {
          question: "How do I choose a lesson package?",
          answer:
            "Review the current lesson options, then contact the academy if you would like help deciding which format best suits your goals.",
        },
      ]}
    />
  );
}
