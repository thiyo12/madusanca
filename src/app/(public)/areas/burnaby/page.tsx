import { LocalAreaPage } from "@/components/seo/local-area-page";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata({
  title: "Driving Lessons in Burnaby, BC",
  description:
    "Build driving confidence with private, one-on-one lessons in Burnaby. Beginner-focused coaching and road-test preparation from Wisdom Driving Academy.",
  path: "/areas/burnaby",
});

export default function BurnabyPage() {
  return (
    <LocalAreaPage
      city="Burnaby"
      intro="Start with the skills you have today. Get private, one-on-one driving instruction shaped around your experience, confidence, and next goals."
      focusTitle="A steady start for new drivers"
      focusText="If you are beginning to learn, it helps to know what to focus on first. Your instructor can tailor a lesson to your current experience, explain the next skills to practise, and help you build toward independent, confident driving."
      faqs={[
        {
          question: "Do you offer beginner driving lessons in Burnaby?",
          answer:
            "Yes. Wisdom Driving Academy offers beginner-focused, private instruction. Lessons are personalized to your current experience and learning goals.",
        },
        {
          question: "Can I book road-test preparation in Burnaby?",
          answer:
            "Road-test preparation is available. Contact the academy to discuss what you would like to practise and confirm lesson availability.",
        },
        {
          question: "Where will my Burnaby lesson start?",
          answer:
            "Lesson location arrangements depend on availability. Contact the academy before booking to confirm options for your preferred location.",
        },
      ]}
    />
  );
}
