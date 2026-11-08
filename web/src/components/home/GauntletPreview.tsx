"use client";
import { CourseList } from "@/components/gauntlet/CourseList";

export function GauntletPreview() {
  return <CourseList limit={3} compact />;
}
