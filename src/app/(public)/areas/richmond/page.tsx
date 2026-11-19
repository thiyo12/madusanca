import { LocalAreaPage } from "@/components/seo/local-area-page";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Driving Lessons in Richmond, BC",
  description:
    "One-on-one driving lessons for learners in Richmond, BC. Build practical skills with personalized beginner coaching and road-test preparation.",
  path: "/areas/richmond",
});

export default function RichmondPage() {
  return (
    <LocalAreaPage
      city="Richmond"
      intro="Build practical driving skills with a private instructor, personalized feedback, and a lesson plan aligned with your goals."
      focusTitle="Turn practice into progress"
      focusText="Whether you are starting from the beginning or refreshing your skills before a road test, focused practice can help you understand what is going well and what to work on next. Your instructor adapts the coaching to your needs."
      faqs={[
        {
          question: "Do you teach first-time drivers in Richmond?",
          answer:
            "Yes. Beginner-focused instruction is available, and coaching is adapted to your experience level.",
        },
        {
          question: "Do you provide road-test preparation in Richmond?",
          answer:
            "Yes. Road-test preparation is one of the services offered. Contact the academy to discuss your goals and confirm availability.",
        },
        {
          question: "How can I confirm my lesson location?",
          answer:
            "The academy confirms location arrangements directly based on current availability. Contact the school before booking to discuss your preferred location.",
        },
      ]}
    />
  );
}
