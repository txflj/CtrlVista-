import { CASES } from "../../core/cases.mjs";
export interface ArchiveRecord {
  id: string;
  caseId: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  assumptions: string[];
}
const order = ["motor", "temperature", "position", "challenge"];
const english = [
  "MOTOR SPEED",
  "TEMPERATURE",
  "POSITION CONTROL",
  "CONTROL CHALLENGE",
];
export const archiveColumns = ["基础控制", "进阶控制"];
// The entrance shares the authoritative experiment definitions with the engine.
export const records: ArchiveRecord[] = order.map((caseId, index) => {
  const item = CASES.find(
    (candidate: { id: string }) => candidate.id === caseId,
  )!;
  return {
    id: `K-${String(index + 1).padStart(3, "0")}`,
    caseId,
    title: item.name,
    en: english[index],
    department: index < 2 ? "目标跟踪与扰动抑制" : "动态响应与多目标取舍",
    category: archiveColumns[index < 2 ? 0 : 1],
    date: caseId === "challenge" ? "综合挑战" : "引导实验",
    lead: caseId === "motor" ? "P / PI" : "P / PI / PID",
    clearance: "LOCAL SIMULATION",
    abstract: item.description,
    findings: item.learningGoals,
    assumptions: item.assumptions,
  };
});
export const categories = ["全部实验", ...archiveColumns];
export function columnFiles(lane: number) {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.category === archiveColumns[lane])
    .map(({ index }) => index);
}
export function fileLocation(index: number) {
  const lane = archiveColumns.indexOf(records[index].category);
  const row = 12 + columnFiles(lane).indexOf(index);
  return { lane, row, slot: lane * 32 + row };
}
export function fileAtSlot(slot: number) {
  const files = columnFiles(Math.floor(slot / 32));
  return files[Math.max(0, Math.min(files.length - 1, (slot % 32) - 12))];
}
