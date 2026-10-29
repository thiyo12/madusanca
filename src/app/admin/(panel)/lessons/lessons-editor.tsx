"use client";

import { useState } from "react";
import { LessonForm } from "./lesson-form";
import { formatLessonPrice, type Lesson } from "@/lib/data/lessons";

interface LessonsEditorProps {
  lessons: Lesson[];
}

export function LessonsEditor({ lessons }: LessonsEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const section = (title: string, rows: Lesson[]) => (
    <section key={title} className="mt-6">
      <h2 className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-soft">
        {title}
      </h2>
      <div className="mt-3 overflow-hidden rounded-[18px] border border-line bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-mist text-[11px] font-extrabold uppercase tracking-wide text-soft">
                <th scope="col" className="px-4 py-3">Lesson</th>
                <th scope="col" className="px-4 py-3">Duration</th>
                <th scope="col" className="px-4 py-3">Price</th>
                <th scope="col" className="px-4 py-3 text-right">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((lesson) => (
                <LessonRow
                  key={lesson.id}
                  lesson={lesson}
                  editing={editingId === lesson.id}
                  onEdit={() => setEditingId(lesson.id)}
                  onClose={() => setEditingId(null)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );

  const packages = lessons.filter((lesson) => lesson.category === "package");
  const modules = lessons.filter((lesson) => lesson.category === "module");

  return (
    <div>
      {section("Packages", packages)}
      {section("Skill modules", modules)}
    </div>
  );
}

interface LessonRowProps {
  lesson: Lesson;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
}

function LessonRow({ lesson, editing, onEdit, onClose }: LessonRowProps) {
  if (editing) {
    return (
      <tr>
        <td colSpan={4} className="bg-[#fcfcfd] px-4 py-5">
          <p className="mb-4 text-[13.5px] font-extrabold text-ink">{lesson.name}</p>
          <LessonForm lesson={lesson} onDone={onClose} />
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-[#fcfcfd]">
      <td className="px-4 py-3.5">
        <p className="text-[13.5px] font-bold text-ink">
          {lesson.name}
          {lesson.popular && (
            <span className="ml-2 rounded-full bg-gold-soft px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#604717]">
              Popular
            </span>
          )}
        </p>
        <p className="text-[12px] text-soft">{lesson.description}</p>
      </td>
      <td className="px-4 py-3.5 text-[13px] text-ink">{lesson.durationMin} min</td>
      <td className="px-4 py-3.5 text-[13px] font-extrabold text-ink">
        {formatLessonPrice(lesson.priceCad)}
      </td>
      <td className="px-4 py-3.5 text-right">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-9 items-center rounded-[8px] border border-line bg-white px-3.5 text-[12.5px] font-extrabold text-ink transition-colors hover:border-gold hover:text-gold-deep"
        >
          Edit
        </button>
      </td>
    </tr>
  );
}
