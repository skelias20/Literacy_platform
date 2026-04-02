// app/admin/assessments/page.tsx
// CHANGES FROM v1:
// - taskFormat select removed from configuration panel entirely
// - configFormat state and all references removed
// - ConfigData type updated (no taskFormat)
// - saveConfig no longer sends taskFormat
// - Listening slot picker guidance updated: "Must have a question bank" note added

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminFetch } from "@/lib/fetchWithAuth";

type LiteracyLevel = "foundational" | "functional" | "transitional" | "advanced";
type AssessmentKind = "initial" | "periodic";
type TaskFormat = "free_response" | "mcq" | "msaq" | "fill_blank";
type SkillType = "reading" | "listening" | "writing" | "speaking";

type Row = {
  id: string; kind: AssessmentKind; sessionNumber: number; taskFormat: TaskFormat;
  submittedAt: string; assignedLevel: LiteracyLevel | null;
  child: {
    id: string; childFirstName: string; childLastName: string;
    grade: number; status: string; level: LiteracyLevel | null;
    parent: { email: string; phone: string; firstName: string; lastName: string };
  };
};

type SessionDetail = {
  id: string; sessionNumber: number; isLatest: boolean;
  submittedAt: string | null; assignedLevel: LiteracyLevel | null;
  taskFormat: TaskFormat; artifacts: Artifact[];
};

type McqFillEntry = { questionId: string; studentAnswer: string; isCorrect: boolean; correctAnswer: string };
type MsaqEntry    = { questionId: string; studentAnswers: string[]; correctAnswers: string[]; score: number; maxScore: number };
type AnswerEntry  = McqFillEntry | MsaqEntry;

type Artifact = {
  id: string; skill: string; textBody: string | null;
  fileId: string | null; answersJson: AnswerEntry[] | null; createdAt: string;
  contentItemId: string | null;
  contentItem: { id: string; title: string; skill: string; type: string; textBody: string | null; assetUrl: string | null } | null;
};

type HistoryRow = {
  id: string; kind: AssessmentKind; sessionNumber: number; taskFormat: TaskFormat;
  submittedAt: string; assignedLevel: LiteracyLevel | null; reviewedAt: string | null;
  child: {
    id: string; childFirstName: string; childLastName: string;
    grade: number; level: LiteracyLevel | null;
    parent: { email: string; phone: string; firstName: string; lastName: string };
  };
};

type ConfigData = {
  id: string | null;
  initialSessionCount: number;
  periodicSessionCount: number;
  updatedAt: string | null;
};

type SlotItem = {
  id: string; title: string; skill: SkillType; type: string;
  level: LiteracyLevel | null; assetUrl: string | null; mimeType: string | null;
  questionBank: { id: string; deletedAt: string | null } | null;
};

type Slot = {
  id: string; level: LiteracyLevel; skill: SkillType; sessionNumber: number;
  contentItem: SlotItem & { deletedAt: string | null };
};

type McqQ  = { id: string; type: "mcq";        prompt: string; options: string[];   correctAnswer: string };
type MsaqQ = { id: string; type: "msaq";       prompt: string; answerCount: number; correctAnswers: string[] };
type FillQ = { id: string; type: "fill_blank"; prompt: string;                      correctAnswer: string };
type AnyQ  = McqQ | MsaqQ | FillQ;

const LEVELS: LiteracyLevel[] = ["foundational", "functional", "transitional", "advanced"];
const SKILLS: SkillType[]     = ["reading", "listening", "writing", "speaking"];
const KIND_LABELS: Record<AssessmentKind, string> = {
  initial: "Initial", periodic: "Periodic re-evaluation",
};
const HISTORY_PAGE_SIZE = 20;

function newQid() { return `q${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// Derive question format label from a question bank's first question type
function formatLabelFromBank(qb: { id: string; deletedAt: string | null } | null | undefined): string {
  return qb && !qb.deletedAt ? "Has question bank" : "No question bank";
}

export default function AdminAssessmentsPage() {
  const [list, setList]                   = useState<Row[]>([]);
  const [listLoading, setListLoading]     = useState(true);
  const [pendingPeriodicCount, setPendingPeriodicCount] = useState(0);
  const [totalSessions, setTotalSessions] = useState(1);
  const [periodicTotalSessions, setPeriodicTotalSessions] = useState(1);

  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [selectedRow, setSelectedRow]     = useState<Row | null>(null);
  const [allSessions, setAllSessions]     = useState<SessionDetail[]>([]);
  const [activeSession, setActiveSession] = useState<number>(1);
  const [detailLoading, setDetailLoading] = useState(false);

  const [assignLevel, setAssignLevel] = useState<LiteracyLevel>("foundational");
  const [assigning, setAssigning]     = useState(false);
  const [assignMsg, setAssignMsg]     = useState<string | null>(null);
  const [periodicConfirm, setPeriodicConfirm] = useState(false);

  const [config, setConfig]                 = useState<ConfigData | null>(null);
  const [configSessionCount, setConfigSessionCount] = useState(1);
  // savedSessionCount tracks the persisted value — used for the readiness grid display.
  // configSessionCount is the live input value that may not yet be saved.
  const [savedSessionCount, setSavedSessionCount]   = useState(1);
  const [configPeriodicSessionCount, setConfigPeriodicSessionCount] = useState(1);
  const [savedPeriodicSessionCount, setSavedPeriodicSessionCount]   = useState(1);
  const [completeness, setCompleteness]     = useState<Record<string, Record<string, number>>>({});
  const [missingSlots, setMissingSlots]     = useState<{ level: string; skill: string; sessionNumber: number }[]>([]);
  const [configSaving, setConfigSaving]     = useState(false);
  const [configMsg, setConfigMsg]           = useState<string | null>(null);
  const [configErr, setConfigErr]           = useState<string | null>(null);
  const [configLoading, setConfigLoading]   = useState(true);

  const [slots, setSlots]                   = useState<Slot[]>([]);
  const [availableContent, setAvailableContent] = useState<SlotItem[]>([]);
  const [slotLevel, setSlotLevel]           = useState<LiteracyLevel>("foundational");
  const [slotsLoading, setSlotsLoading]     = useState(true);
  const [slotSaving, setSlotSaving]         = useState<string | null>(null);
  const [slotMsg, setSlotMsg]               = useState<string | null>(null);
  const [slotErr, setSlotErr]               = useState<string | null>(null);

  const [qbSlotKey, setQbSlotKey]           = useState<string | null>(null);
  const [qbAudioId, setQbAudioId]           = useState<string | null>(null);
  const [questions, setQuestions]           = useState<AnyQ[]>([]);
  const [loadedQuestions, setLoadedQuestions] = useState<AnyQ[]>([]);
  const [qbFormat, setQbFormat]             = useState<"mcq" | "msaq" | "fill_blank">("mcq");
  const [qbLoading, setQbLoading]           = useState(false);
  const [qbSaving, setQbSaving]             = useState(false);
  const [qbMsg, setQbMsg]                   = useState<string | null>(null);
  const [qbErr, setQbErr]                   = useState<string | null>(null);

  const qbIsDirty = useMemo(
    () => JSON.stringify(questions) !== JSON.stringify(loadedQuestions),
    [questions, loadedQuestions]
  );

  const [triggerScope, setTriggerScope] = useState<"all" | LiteracyLevel>("all");
  const [triggering, setTriggering]     = useState(false);
  const [triggerMsg, setTriggerMsg]     = useState<string | null>(null);
  const [triggerErr, setTriggerErr]     = useState<string | null>(null);

  // History section
  const [historyOpen, setHistoryOpen]                           = useState(false);
  const [historyItems, setHistoryItems]                         = useState<HistoryRow[]>([]);
  const [historyTotal, setHistoryTotal]                         = useState(0);
  const [historyPage, setHistoryPage]                           = useState(1);
  const [historyLoading, setHistoryLoading]                     = useState(false);
  const [historyKind, setHistoryKind]                           = useState<"" | "initial" | "periodic">("");
  const [historySearch, setHistorySearch]                       = useState("");
  const [historyDateFrom, setHistoryDateFrom]                   = useState("");
  const [historyDateTo, setHistoryDateTo]                       = useState("");
  const [historyExpandedId, setHistoryExpandedId]               = useState<string | null>(null);
  const [historyExpandedSessions, setHistoryExpandedSessions]   = useState<SessionDetail[]>([]);
  const [historyExpandedActive, setHistoryExpandedActive]       = useState(1);
  const [historyExpandedLoading, setHistoryExpandedLoading]     = useState(false);

  async function loadList() {
    setListLoading(true);
    const res  = await adminFetch("/api/admin/assessments");
    const data = await res.json().catch(() => ({}));
    setList(data.assessments ?? []);
    setPendingPeriodicCount(data.pendingPeriodicCount ?? 0);
    setTotalSessions(data.totalSessions ?? 1);
    setPeriodicTotalSessions(data.periodicSessionCount ?? 1);
    setListLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res  = await adminFetch("/api/admin/assessments");
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      setList(data.assessments ?? []);
      setPendingPeriodicCount(data.pendingPeriodicCount ?? 0);
      setTotalSessions(data.totalSessions ?? 1);
      setPeriodicTotalSessions(data.periodicSessionCount ?? 1);
      setListLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res  = await adminFetch("/api/admin/assessments/config");
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      setConfig(data.config ?? null);
      setConfigSessionCount(data.config?.initialSessionCount ?? 1);
      setSavedSessionCount(data.config?.initialSessionCount ?? 1);
      setConfigPeriodicSessionCount(data.config?.periodicSessionCount ?? 1);
      setSavedPeriodicSessionCount(data.config?.periodicSessionCount ?? 1);
      setCompleteness(data.completeness ?? {});
      setMissingSlots(data.missingSlots ?? []);
      setConfigLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setSlotsLoading(true);
      const res  = await adminFetch("/api/admin/assessments/default-content");
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      setSlots(data.slots ?? []);
      setAvailableContent(data.availableContent ?? []);
      setSlotsLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  async function openDetail(row: Row) {
    setSelectedId(row.id); setSelectedRow(row);
    setAllSessions([]); setAssignMsg(null); setDetailLoading(true);
    setPeriodicConfirm(false);
    setAssignLevel((row.assignedLevel ?? row.child.level ?? "foundational") as LiteracyLevel);
    const res  = await adminFetch(`/api/admin/assessments/${row.id}`);
    const data = await res.json().catch(() => ({}));
    setDetailLoading(false);
    if (!res.ok) { setAssignMsg(data.error ?? "Failed to load."); return; }
    const sessions: SessionDetail[] = data.allSessions ?? [];
    setAllSessions(sessions);
    const latest = sessions.filter((s) => s.submittedAt).at(-1);
    setActiveSession(latest?.sessionNumber ?? 1);
  }

  async function submitAssignLevel() {
    // Use the ID of the session currently being viewed (the last session tab),
    // not the list-row ID which may be an earlier session.
    const sessionId = activeSessionData?.id ?? selectedId;
    if (!sessionId) return;
    setAssigning(true); setAssignMsg(null);
    const res  = await adminFetch("/api/admin/assessments/assign-level", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentId: sessionId, level: assignLevel }),
    });
    const data = await res.json().catch(() => ({}));
    setAssigning(false);
    if (!res.ok) { setAssignMsg((data as { error?: string }).error ?? "Failed."); return; }
    setAssignMsg(
      selectedRow?.kind === "periodic"
        ? `Level updated to ${assignLevel}.`
        : `Level assigned: ${assignLevel}. Student is now active.`
    );
    await loadList();
  }

  async function saveConfig() {
    setConfigSaving(true); setConfigMsg(null); setConfigErr(null);
    const res  = await adminFetch("/api/admin/assessments/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initialSessionCount: configSessionCount,
        periodicSessionCount: configPeriodicSessionCount,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setConfigSaving(false);
    if (!res.ok) {
      setConfigErr((data as { error?: string }).error ?? "Failed to save.");
      if (data.missingSlots) setMissingSlots(data.missingSlots);
      return;
    }
    setConfig(data.config);
    setSavedSessionCount(data.config?.initialSessionCount ?? configSessionCount);
    setSavedPeriodicSessionCount(data.config?.periodicSessionCount ?? configPeriodicSessionCount);
    setCompleteness(data.completeness ?? {});
    setMissingSlots(data.missingSlots ?? []);
    setConfigMsg("Configuration saved.");
  }

  async function reloadSlotsAndConfig() {
    const [r1, r2] = await Promise.all([
      adminFetch("/api/admin/assessments/default-content"),
      adminFetch("/api/admin/assessments/config"),
    ]);
    const [d1, d2] = await Promise.all([r1.json().catch(() => ({})), r2.json().catch(() => ({}))]);
    setSlots(d1.slots ?? []);
    setAvailableContent(d1.availableContent ?? []);
    setCompleteness(d2.completeness ?? {});
    setMissingSlots(d2.missingSlots ?? []);
  }

  async function assignSlot(level: LiteracyLevel, skill: SkillType, sessionNumber: number, contentItemId: string) {
    const key = `${level}_${skill}_${sessionNumber}`;
    setSlotSaving(key); setSlotMsg(null); setSlotErr(null);
    const res  = await adminFetch("/api/admin/assessments/default-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, skill, sessionNumber, contentItemId }),
    });
    const data = await res.json().catch(() => ({}));
    setSlotSaving(null);
    if (!res.ok) { setSlotErr((data as { error?: string }).error ?? "Failed."); return; }
    await reloadSlotsAndConfig();
    setSlotMsg("Slot assigned.");
    if (skill === "listening") {
      openQbForSlot(level, skill, sessionNumber, contentItemId);
    }
  }

  async function clearSlot(level: LiteracyLevel, skill: SkillType, sessionNumber: number) {
    const key = `${level}_${skill}_${sessionNumber}`;
    setSlotSaving(key); setSlotMsg(null); setSlotErr(null);
    const res  = await adminFetch("/api/admin/assessments/default-content", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, skill, sessionNumber }),
    });
    const data = await res.json().catch(() => ({}));
    setSlotSaving(null);
    if (!res.ok) { setSlotErr((data as { error?: string }).error ?? "Failed."); return; }
    await reloadSlotsAndConfig();
    if (qbSlotKey === key) { setQbSlotKey(null); setQbAudioId(null); setQuestions([]); setLoadedQuestions([]); }
  }

  function openQbForSlot(level: LiteracyLevel, skill: SkillType, sessionNumber: number, audioId: string) {
    const key = `${level}_${skill}_${sessionNumber}`;
    setQbSlotKey(key); setQbAudioId(audioId);
    setQbMsg(null); setQbErr(null);
    // Reset to mcq before loading — loadQb will override this if the bank has a different format.
    // Without this reset, qbFormat could persist from a previous slot/session.
    setQbFormat("mcq");
    loadQb(audioId);
  }

  async function loadQb(audioId: string) {
    setQbLoading(true);
    const res  = await adminFetch(`/api/admin/content/${audioId}/question-bank`);
    const data = await res.json().catch(() => ({}));
    setQbLoading(false);
    if (!res.ok) { setQbErr(data.error ?? "Failed to load question bank."); return; }
    if (data.questionBank?.questions) {
      const qs = data.questionBank.questions as AnyQ[];
      setQuestions(qs);
      setLoadedQuestions(qs);
      // Derive format from the loaded questions
      const firstType = qs[0]?.type;
      if (firstType === "mcq" || firstType === "msaq" || firstType === "fill_blank") {
        setQbFormat(firstType);
      }
    } else {
      setQuestions([]);
      setLoadedQuestions([]);
    }
  }

  async function saveQb() {
    if (!qbAudioId || questions.length === 0) return;
    for (const q of questions) {
      if (!q.prompt.trim()) { setQbErr("All questions must have a prompt."); return; }
      if (q.type === "mcq") {
        if (!(q as McqQ).options.every((o) => o.trim())) { setQbErr("All MCQ options must be filled in."); return; }
        if (!(q as McqQ).options.includes((q as McqQ).correctAnswer)) { setQbErr("MCQ correct answer must match one of the options."); return; }
      }
      if (q.type === "msaq" && !(q as MsaqQ).correctAnswers.every((a) => a.trim())) {
        setQbErr("All MSAQ correct answers must be filled in."); return;
      }
      if (q.type === "fill_blank" && !(q as FillQ).correctAnswer.trim()) {
        setQbErr("All fill-in-the-blank questions need a correct answer."); return;
      }
    }
    setQbSaving(true); setQbErr(null); setQbMsg(null);
    const res  = await adminFetch(`/api/admin/content/${qbAudioId}/question-bank`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskFormat: qbFormat, questions }),
    });
    const data = await res.json().catch(() => ({}));
    setQbSaving(false);
    if (!res.ok) { setQbErr(data.error ?? "Failed to save question bank."); return; }
    setLoadedQuestions([...questions]);
    setQbMsg(data.action === "created" ? "Question bank created." : "Question bank updated.");
    // Reload slots so the content list reflects the newly available item
    await reloadSlotsAndConfig();
  }

  function addQuestion(type: "mcq" | "msaq" | "fill_blank") {
    const id = newQid();
    if (type === "mcq")        setQuestions((q) => [...q, { id, type: "mcq",        prompt: "", options: ["", "", "", ""], correctAnswer: "" }]);
    if (type === "msaq")       setQuestions((q) => [...q, { id, type: "msaq",       prompt: "", answerCount: 2, correctAnswers: ["", ""] }]);
    if (type === "fill_blank") setQuestions((q) => [...q, { id, type: "fill_blank", prompt: "", correctAnswer: "" }]);
  }

  function removeQuestion(id: string) { setQuestions((q) => q.filter((x) => x.id !== id)); }
  function updateQuestion(id: string, patch: Partial<AnyQ>) {
    setQuestions((qs) => qs.map((q) => q.id === id ? { ...q, ...patch } as AnyQ : q));
  }

  async function triggerPeriodic() {
    setTriggering(true); setTriggerMsg(null); setTriggerErr(null);
    const body = triggerScope === "all" ? { scope: "all" } : { scope: "level", level: triggerScope };
    const res  = await adminFetch("/api/admin/assessments/trigger-periodic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setTriggering(false);
    if (!res.ok) { setTriggerErr((data as { error?: string }).error ?? "Failed."); return; }
    setTriggerMsg((data as { message?: string }).message ?? "Re-evaluations triggered.");
    await loadList();
  }

  async function loadHistory(p: number) {
    setHistoryLoading(true);
    const params = new URLSearchParams({ page: String(p) });
    if (historyKind)           params.set("kind",     historyKind);
    if (historySearch.trim())  params.set("search",   historySearch.trim());
    if (historyDateFrom)       params.set("dateFrom", historyDateFrom);
    if (historyDateTo)         params.set("dateTo",   historyDateTo);
    const res  = await adminFetch(`/api/admin/assessments/history?${params}`);
    const data = await res.json().catch(() => ({}));
    setHistoryItems(data.history ?? []);
    setHistoryTotal(data.total ?? 0);
    setHistoryPage(p);
    setHistoryLoading(false);
  }

  async function openHistoryDetail(row: HistoryRow) {
    if (historyExpandedId === row.id) { setHistoryExpandedId(null); return; }
    setHistoryExpandedId(row.id);
    setHistoryExpandedSessions([]);
    setHistoryExpandedLoading(true);
    const res  = await adminFetch(`/api/admin/assessments/${row.id}`);
    const data = await res.json().catch(() => ({}));
    setHistoryExpandedLoading(false);
    const sessions: SessionDetail[] = data.allSessions ?? [];
    setHistoryExpandedSessions(sessions);
    const latest = sessions.filter((s) => s.submittedAt).at(-1);
    setHistoryExpandedActive(latest?.sessionNumber ?? 1);
  }

  const isAlreadyAssigned = selectedRow?.kind === "initial" && !!selectedRow.assignedLevel;
  const activeSessionData = allSessions.find((s) => s.sessionNumber === activeSession);
  const lastSessionNumber = allSessions.length > 0 ? Math.max(...allSessions.map((s) => s.sessionNumber)) : activeSession;
  const levelSlots        = slots.filter((s) => s.level === slotLevel);
  // true only when every session has been submitted (none are pending)
  const allSessionsSubmitted = allSessions.length > 0 && allSessions.every((s) => s.submittedAt !== null);

  function getSlot(skill: SkillType, sessionNumber: number) {
    return levelSlots.find((s) => s.skill === skill && s.sessionNumber === sessionNumber);
  }
  function getAvailable(skill: SkillType) {
    return availableContent.filter((c) => c.skill === skill);
  }

  const sessionNumbers = Array.from({ length: Math.max(configSessionCount, 1) }, (_, i) => i + 1);

  return (
    <main className="p-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Assessments</h1>
          <p className="mt-1 text-sm text-gray-600">
            Review submitted assessments, configure sessions, and assign literacy levels.
          </p>
        </div>
        <Link href="/admin" className="text-sm underline text-gray-500">← Admin</Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ── Left: Pending list ──────────────────────────────────────── */}
        <div className="rounded border p-4">
          <h2 className="font-semibold">Pending review</h2>
          <p className="mt-1 text-xs text-gray-500">Submitted assessments awaiting level assignment.</p>
          {pendingPeriodicCount > 0 && (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="font-medium">{pendingPeriodicCount} student{pendingPeriodicCount !== 1 ? "s" : ""}</span>
              {" "}ha{pendingPeriodicCount !== 1 ? "ve" : "s"} a re-evaluation waiting to be completed.
            </div>
          )}
          {listLoading && <p className="mt-3 text-sm text-gray-500">Loading...</p>}
          {!listLoading && list.length === 0 && (
            <p className="mt-3 text-sm text-gray-600">No assessments pending review.</p>
          )}
          {!listLoading && list.length > 0 && (() => {
            const initialList  = list.filter((a) => a.kind === "initial");
            const periodicList = list.filter((a) => a.kind === "periodic");
            function renderCard(a: Row) {
              return (
                <button key={a.id} onClick={() => openDetail(a)}
                  className={`w-full rounded border p-3 text-left hover:bg-gray-50 ${selectedId === a.id ? "border-black bg-gray-50" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">{a.child.childFirstName} {a.child.childLastName}</span>
                    {a.kind === "periodic" && (
                      <span className="text-xs text-gray-400">#{a.sessionNumber}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    Grade {a.child.grade} · Submitted {new Date(a.submittedAt).toLocaleDateString()}
                  </div>
                  {a.kind === "initial" && a.sessionNumber < totalSessions && (
                    <div className="mt-0.5 text-xs text-amber-600 font-medium">
                      Session {a.sessionNumber} of {totalSessions} — more sessions pending
                    </div>
                  )}
                  {a.kind === "initial" && a.sessionNumber >= totalSessions && (
                    <div className="mt-0.5 text-xs text-green-600 font-medium">
                      All {totalSessions} session{totalSessions !== 1 ? "s" : ""} submitted — ready for level assignment
                    </div>
                  )}
                  {a.kind === "periodic" && periodicTotalSessions > 1 && a.sessionNumber < periodicTotalSessions && (
                    <div className="mt-0.5 text-xs text-amber-600 font-medium">
                      Session {a.sessionNumber} of {periodicTotalSessions} — more sessions pending
                    </div>
                  )}
                  {a.kind === "periodic" && periodicTotalSessions > 1 && a.sessionNumber >= periodicTotalSessions && (
                    <div className="mt-0.5 text-xs text-green-600 font-medium">
                      All {periodicTotalSessions} sessions submitted — ready for level update
                    </div>
                  )}
                  {a.child.level && <div className="mt-0.5 text-xs text-gray-400 capitalize">Current level: {a.child.level}</div>}
                </button>
              );
            }
            return (
              <div className="mt-3 space-y-4">
                {initialList.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                        Initial Placement
                      </span>
                      <span className="text-xs text-gray-400">{initialList.length} pending</span>
                    </div>
                    <div className="space-y-2">{initialList.map(renderCard)}</div>
                  </div>
                )}
                {periodicList.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">
                        Periodic Re-evaluation
                      </span>
                      <span className="text-xs text-gray-400">{periodicList.length} pending</span>
                    </div>
                    <div className="space-y-2">{periodicList.map(renderCard)}</div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* ── Middle: Artifacts + assign level ───────────────────────── */}
        <div className="rounded border p-4">
          <h2 className="font-semibold">Artifacts</h2>
          {!selectedRow && <p className="mt-3 text-sm text-gray-600">Select an assessment to review artifacts.</p>}
          {selectedRow && (
            <div className="mt-3 space-y-3">
              <div className="rounded bg-gray-50 px-3 py-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="font-medium">{selectedRow.child.childFirstName} {selectedRow.child.childLastName}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    selectedRow.kind === "periodic"
                      ? "bg-indigo-100 text-indigo-800"
                      : "bg-blue-100 text-blue-800"
                  }`}>
                    {selectedRow.kind === "periodic" ? "Periodic Re-evaluation" : "Initial Placement"}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Grade {selectedRow.child.grade}
                  {selectedRow.kind === "periodic" && ` · Session ${selectedRow.sessionNumber}`}
                  {selectedRow.child.level && (
                    <span className="ml-1 font-medium text-gray-600 capitalize">· Current level: {selectedRow.child.level}</span>
                  )}
                </p>
              </div>
              {detailLoading && <p className="text-sm text-gray-500">Loading...</p>}
              {!detailLoading && allSessions.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {allSessions.map((s) => (
                    <button key={s.sessionNumber} onClick={() => setActiveSession(s.sessionNumber)}
                      className={`rounded px-2 py-1 text-xs ${activeSession === s.sessionNumber ? "bg-black text-white" : "border text-gray-600 hover:bg-gray-50"}`}>
                      Session {s.sessionNumber}{!s.submittedAt && " (pending)"}
                    </button>
                  ))}
                </div>
              )}
              {!detailLoading && activeSessionData && (
                <div className="space-y-2">
                  {!activeSessionData.submittedAt ? (
                    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
                      Student has not yet submitted this session.
                    </div>
                  ) : activeSessionData.artifacts.length === 0 ? (
                    <p className="text-sm text-gray-600">No artifacts for this session.</p>
                  ) : (
                    activeSessionData.artifacts.map((x) => (
                      <div key={x.id} className="rounded border p-3">
                        <p className="text-sm font-medium capitalize">{x.skill}</p>

                        {/* Source content used in this assessment slot */}
                        {x.contentItem && (
                          <div className="mt-1 rounded bg-gray-50 px-2 py-1.5">
                            <p className="text-xs font-medium text-gray-500">Source: {x.contentItem.title}</p>
                            {x.contentItem.textBody && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs text-blue-600 underline">View source text</summary>
                                <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border bg-white p-2 text-xs">{x.contentItem.textBody}</pre>
                              </details>
                            )}
                            {x.contentItem.assetUrl && !x.contentItem.textBody && (
                              <a
                                className="mt-0.5 inline-block text-xs text-blue-600 underline"
                                href={`/api/admin/files/${x.contentItem.assetUrl.split("/").pop()}`}
                                target="_blank" rel="noreferrer"
                              >
                                Play / download source audio
                              </a>
                            )}
                          </div>
                        )}

                        {/* Student's response */}
                        {x.textBody && <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">{x.textBody}</pre>}
                        {x.fileId && !x.textBody && (
                          <a className="mt-2 inline-block text-xs underline" href={`/api/admin/files/${x.fileId}`} target="_blank" rel="noreferrer">
                            Download recording
                          </a>
                        )}
                        {x.answersJson && !x.textBody && !x.fileId && <AnswersReview entries={x.answersJson} />}
                        {!x.textBody && !x.fileId && !x.answersJson && <p className="mt-1 text-xs text-gray-400">(No response)</p>}
                      </div>
                    ))
                  )}
                </div>
              )}
              {activeSession === lastSessionNumber && allSessionsSubmitted &&(selectedRow.kind === "periodic" || selectedRow.child.status === "pending_level_review") && (
                <div className="rounded border p-3 mt-2">
                  <p className="text-sm font-medium">{selectedRow.kind === "periodic" ? "Update level" : "Assign level"}</p>
                  {selectedRow.kind === "periodic" && selectedRow.child.level && (
                    <p className="mt-1 text-xs text-gray-500">
                      Current level: <span className="font-semibold capitalize text-gray-700">{selectedRow.child.level}</span>
                    </p>
                  )}
                  {isAlreadyAssigned && (
                    <p className="mt-1 text-xs text-green-700">
                      Already assigned: <span className="font-semibold capitalize">{selectedRow.assignedLevel}</span>
                    </p>
                  )}
                  {!isAlreadyAssigned && !periodicConfirm && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select className="rounded border px-2 py-1 text-sm disabled:opacity-60"
                        value={assignLevel} disabled={assigning}
                        onChange={(e) => { setAssignLevel(e.target.value as LiteracyLevel); setPeriodicConfirm(false); }}>
                        {LEVELS.map((l) => <option key={l} value={l} className="capitalize">{l}</option>)}
                      </select>
                      <button
                        className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-60"
                        disabled={assigning}
                        onClick={() => {
                          if (selectedRow.kind === "periodic") {
                            setPeriodicConfirm(true);
                          } else {
                            submitAssignLevel();
                          }
                        }}>
                        {assigning ? "Saving..." : selectedRow.kind === "periodic" ? "Update level…" : "Save"}
                      </button>
                    </div>
                  )}
                  {!isAlreadyAssigned && periodicConfirm && (
                    <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 space-y-2">
                      <p className="text-sm text-amber-900 font-medium">Confirm level change</p>
                      <p className="text-xs text-amber-800">
                        This will change{" "}
                        <span className="font-semibold">{selectedRow.child.childFirstName} {selectedRow.child.childLastName}</span>
                        {"'s level from "}
                        <span className="font-semibold capitalize">{selectedRow.child.level ?? "none"}</span>
                        {" to "}
                        <span className="font-semibold capitalize">{assignLevel}</span>.
                      </p>
                      <div className="flex gap-2">
                        <button
                          className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-60"
                          disabled={assigning}
                          onClick={async () => { await submitAssignLevel(); setPeriodicConfirm(false); }}>
                          {assigning ? "Saving..." : "Confirm"}
                        </button>
                        <button
                          className="rounded border px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                          disabled={assigning}
                          onClick={() => setPeriodicConfirm(false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {assignMsg && (
                    <p className={`mt-2 text-xs ${assignMsg.includes("Failed") ? "text-red-600" : "text-green-700"}`}>{assignMsg}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Config + slots + trigger ────────────────────────── */}
        <div className="space-y-4">

          {/* Assessment configuration */}
          <div className="rounded border p-4">
            <h2 className="font-semibold">Assessment Configuration</h2>
            <p className="mt-1 text-xs text-gray-500">
              Controls how many sessions students complete before level assignment.
              The listening question format is determined automatically by the question bank
              attached to the listening content in each slot.
            </p>
            {configLoading ? (
              <p className="mt-3 text-sm text-gray-500">Loading...</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-sm font-medium">Initial sessions required</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input type="number" min={1} max={5}
                      className="w-16 rounded border px-2 py-1 text-sm"
                      value={configSessionCount}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(5, parseInt(e.target.value) || 1));
                        setConfigSessionCount(n);
                        // Keep periodic ≤ initial
                        if (configPeriodicSessionCount > n) setConfigPeriodicSessionCount(n);
                      }} />
                    <span className="text-xs text-gray-400">(max 5)</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Students complete this many sessions before admin assigns a level. All sessions include all four skills.
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">Periodic sessions per re-evaluation</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input type="number" min={1} max={configSessionCount}
                      className="w-16 rounded border px-2 py-1 text-sm"
                      value={configPeriodicSessionCount}
                      onChange={(e) => setConfigPeriodicSessionCount(Math.max(1, Math.min(configSessionCount, parseInt(e.target.value) || 1)))} />
                    <span className="text-xs text-gray-400">(max {configSessionCount})</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Number of sessions a student completes during each periodic re-evaluation. Cannot exceed initial sessions.
                  </p>
                </div>
                <button onClick={saveConfig} disabled={configSaving}
                  className="w-full rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-60">
                  {configSaving ? "Saving..." : "Save configuration"}
                </button>
                {configMsg && <p className="text-xs text-green-700">{configMsg}</p>}
                {configErr && <p className="text-xs text-red-600">{configErr}</p>}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Slot readiness</p>
                  <div className="space-y-0.5">
                    {LEVELS.map((l) => (
                      <div key={l} className="flex items-center gap-2 text-xs">
                        <span className="w-24 capitalize text-gray-500">{l}</span>
                        {SKILLS.map((s) => {
                          const filled = completeness[l]?.[s] ?? 0;
                          const ok = filled >= savedSessionCount;
                          return (
                            <span key={s} className={`rounded px-1 py-0.5 ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                              {s[0].toUpperCase()} {filled}/{savedSessionCount}
                            </span>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {missingSlots.length > 0 && (
                    <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2">
                      <p className="text-xs font-medium text-amber-800 mb-1">
                        {missingSlots.length} slot{missingSlots.length !== 1 ? "s" : ""} need content:
                      </p>
                      {LEVELS.map((l) => {
                        const lvlMissing = missingSlots.filter((s) => s.level === l);
                        if (lvlMissing.length === 0) return null;
                        return (
                          <div key={l} className="mb-0.5 flex flex-wrap items-baseline gap-1">
                            <button
                              className="text-xs font-medium text-amber-700 underline capitalize"
                              onClick={() => setSlotLevel(l)}>
                              {l}
                            </button>
                            <span className="text-xs text-amber-600">
                              — {lvlMissing.map((s) => `${s.skill[0].toUpperCase()} S${s.sessionNumber}`).join(", ")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Content slot assignment */}
          <div className="rounded border p-4">
            <h2 className="font-semibold">Assessment Content Slots</h2>
            <p className="mt-1 text-xs text-gray-500">
              Assign content from the{" "}
              <Link href="/admin/content" className="underline">Content Library</Link>{" "}
              to each session slot.
              Listening content must have a question bank before it can be assigned here.
            </p>
            <div className="mt-3">
              <label className="text-sm font-medium">Level</label>
              <select className="mt-1 w-full rounded border px-2 py-1 text-sm"
                value={slotLevel} onChange={(e) => setSlotLevel(e.target.value as LiteracyLevel)}>
                {LEVELS.map((l) => <option key={l} value={l} className="capitalize">{l}</option>)}
              </select>
            </div>
            {slotsLoading ? (
              <p className="mt-3 text-sm text-gray-500">Loading...</p>
            ) : (
              <div className="mt-3 space-y-4">
                {SKILLS.map((skill) => (
                  <div key={skill}>
                    <p className="text-sm font-medium capitalize mb-1">{skill}</p>
                    {skill === "listening" && (
                      <p className="text-xs text-gray-400 mb-2">
                        Only audio items with an authored question bank are listed.
                        Use the daily tasks page or the question bank builder below to add one.
                      </p>
                    )}
                    {sessionNumbers.map((n) => {
                      const slot     = getSlot(skill, n);
                      const available = getAvailable(skill);
                      const key      = `${slotLevel}_${skill}_${n}`;
                      const isSaving = slotSaving === key;
                      const isProtected = n <= savedSessionCount;
                      return (
                        <div key={n} className={`mb-2 rounded border p-2 ${!slot ? "border-amber-200 bg-amber-50" : ""}`}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-medium text-gray-500">Session {n}</span>
                            {/* Only show Clear for slots beyond the required session range */}
                            {slot && !isProtected && (
                              <button onClick={() => clearSlot(slotLevel, skill, n)} disabled={isSaving}
                                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
                                Clear
                              </button>
                            )}
                          </div>
                          {slot ? (
                            <div>
                              <p className="text-xs text-green-700 font-medium truncate">✅ {slot.contentItem.title}</p>
                              {skill === "listening" && (
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {formatLabelFromBank(slot.contentItem.questionBank)}
                                </p>
                              )}
                              {/* Replacement select for protected slots (Clear is blocked) */}
                              {isProtected && available.length > 0 && (
                                <select className="mt-1 w-full rounded border px-2 py-1 text-xs text-gray-600"
                                  defaultValue="" disabled={isSaving}
                                  onChange={(e) => { if (e.target.value) assignSlot(slotLevel, skill, n, e.target.value); }}>
                                  <option value="">— Replace with… —</option>
                                  {available.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.title}{c.level ? ` (${c.level})` : " (any level)"}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ) : (
                            available.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">
                                {skill === "listening"
                                  ? "No listening audio with a question bank available. Create one first."
                                  : "No content available for this skill."}
                              </p>
                            ) : (
                              <select className="w-full rounded border px-2 py-1 text-xs"
                                defaultValue="" disabled={isSaving}
                                onChange={(e) => { if (e.target.value) assignSlot(slotLevel, skill, n, e.target.value); }}>
                                <option value="">— Select content —</option>
                                {available.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.title}{c.level ? ` (${c.level})` : " (any level)"}
                                  </option>
                                ))}
                              </select>
                            )
                          )}

                          {/* Question bank builder for listening slots */}
                          {skill === "listening" && slot && (
                            <div className="mt-2">
                              {qbSlotKey !== key ? (
                                <button onClick={() => openQbForSlot(slotLevel, skill, n, slot.contentItem.id)}
                                  className="text-xs text-blue-600 underline">
                                  {slot.contentItem.questionBank && !slot.contentItem.questionBank.deletedAt
                                    ? "Edit question bank" : "View question bank"}
                                </button>
                              ) : (
                                <QuestionBankBuilder
                                  format={qbFormat}
                                  onFormatChange={setQbFormat}
                                  questions={questions}
                                  isDirty={qbIsDirty}
                                  loading={qbLoading}
                                  saving={qbSaving}
                                  msg={qbMsg}
                                  err={qbErr}
                                  onAdd={addQuestion}
                                  onRemove={removeQuestion}
                                  onUpdate={updateQuestion}
                                  onSave={saveQb}
                                  onClose={() => { setQbSlotKey(null); setQbAudioId(null); }}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {slotMsg && <p className="text-xs text-green-700">{slotMsg}</p>}
                {slotErr && <p className="text-xs text-red-600">{slotErr}</p>}
              </div>
            )}
          </div>

          {/* Trigger re-evaluation */}
          <div className="rounded border p-4">
            <h2 className="font-semibold">Trigger re-evaluation</h2>
            <p className="mt-1 text-xs text-gray-500">Create a new periodic assessment session for active students.</p>
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-sm font-medium">Scope</label>
                <select className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
                  value={triggerScope} onChange={(e) => setTriggerScope(e.target.value as "all" | LiteracyLevel)} disabled={triggering}>
                  <option value="all">All active students</option>
                  {LEVELS.map((l) => (
                    <option key={l} value={l} className="capitalize">{l.charAt(0).toUpperCase() + l.slice(1)} level only</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">Students with an open unsubmitted periodic assessment will be skipped.</p>
              </div>
              <button onClick={triggerPeriodic} disabled={triggering}
                className="w-full rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-60">
                {triggering ? "Triggering..." : "Trigger re-evaluation"}
              </button>
              {triggerMsg && <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{triggerMsg}</div>}
              {triggerErr && <p className="text-sm text-red-600">{triggerErr}</p>}
              <div className="rounded border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                <p className="font-medium text-gray-600 mb-1">Per-student trigger</p>
                Go to <Link href="/admin/students" className="underline">Student Management</Link> to trigger for a single student. (Not yet built.)
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Assessment History ───────────────────────────────────────────── */}
      <div className="mt-8">
        <button
          className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-black"
          onClick={() => {
            const next = !historyOpen;
            setHistoryOpen(next);
            if (next && historyItems.length === 0) loadHistory(1);
          }}
        >
          <span>{historyOpen ? "▾" : "▸"}</span>
          Assessment History
          <span className="text-xs font-normal text-gray-400">(completed — level already assigned)</span>
        </button>

        {historyOpen && (
          <div className="mt-3 rounded border p-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-end mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Kind</label>
                <select className="rounded border px-2 py-1 text-sm"
                  value={historyKind}
                  onChange={(e) => setHistoryKind(e.target.value as "" | "initial" | "periodic")}>
                  <option value="">All</option>
                  <option value="initial">Initial</option>
                  <option value="periodic">Periodic</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Student name</label>
                <input type="text" placeholder="Search…" className="rounded border px-2 py-1 text-sm w-36"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") loadHistory(1); }} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input type="date" className="rounded border px-2 py-1 text-sm"
                  value={historyDateFrom}
                  onChange={(e) => setHistoryDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input type="date" className="rounded border px-2 py-1 text-sm"
                  value={historyDateTo}
                  onChange={(e) => setHistoryDateTo(e.target.value)} />
              </div>
              <button className="rounded bg-black px-3 py-1.5 text-sm text-white"
                onClick={() => loadHistory(1)}>
                Apply
              </button>
            </div>

            {/* Results */}
            {historyLoading && <p className="text-sm text-gray-500">Loading…</p>}
            {!historyLoading && historyItems.length === 0 && (
              <p className="text-sm text-gray-600">No completed assessments found.</p>
            )}
            {!historyLoading && historyItems.length > 0 && (
              <div className="space-y-2">
                {historyItems.map((row) => {
                  const isExpanded = historyExpandedId === row.id;
                  const expandedSessionData = isExpanded
                    ? historyExpandedSessions.find((s) => s.sessionNumber === historyExpandedActive)
                    : null;
                  return (
                    <div key={row.id} className="rounded border">
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-4"
                        onClick={() => openHistoryDetail(row)}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm">
                            {row.child.childFirstName} {row.child.childLastName}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.kind === "periodic" ? "bg-indigo-100 text-indigo-800" : "bg-blue-100 text-blue-800"}`}>
                            {row.kind === "periodic" ? "Periodic Re-evaluation" : "Initial Placement"}{row.kind === "periodic" && ` #${row.sessionNumber}`}
                          </span>
                          {row.assignedLevel && (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 capitalize">
                              {row.assignedLevel}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-xs text-gray-400">
                          <span>Grade {row.child.grade}</span>
                          <span>{new Date(row.submittedAt).toLocaleDateString()}</span>
                          <span>{isExpanded ? "▴" : "▾"}</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t px-3 py-3">
                          {historyExpandedLoading && <p className="text-sm text-gray-500">Loading…</p>}
                          {!historyExpandedLoading && historyExpandedSessions.length > 1 && (
                            <div className="flex flex-wrap gap-1 mb-3">
                              {historyExpandedSessions.map((s) => (
                                <button key={s.sessionNumber}
                                  onClick={() => setHistoryExpandedActive(s.sessionNumber)}
                                  className={`rounded px-2 py-1 text-xs ${historyExpandedActive === s.sessionNumber ? "bg-black text-white" : "border text-gray-600 hover:bg-gray-50"}`}>
                                  Session {s.sessionNumber}
                                  {s.assignedLevel && (
                                    <span className="ml-1 text-green-400">✓</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                          {!historyExpandedLoading && expandedSessionData && (
                            <div className="space-y-2">
                              {!expandedSessionData.submittedAt ? (
                                <div className="rounded border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
                                  Student has not yet submitted this session.
                                </div>
                              ) : expandedSessionData.artifacts.length === 0 ? (
                                <p className="text-sm text-gray-600">No artifacts for this session.</p>
                              ) : (
                                expandedSessionData.artifacts.map((x) => (
                                  <div key={x.id} className="rounded border p-3">
                                    <p className="text-sm font-medium capitalize">{x.skill}</p>
                                    {x.contentItem && (
                                      <div className="mt-1 rounded bg-gray-50 px-2 py-1.5">
                                        <p className="text-xs font-medium text-gray-500">Source: {x.contentItem.title}</p>
                                        {x.contentItem.textBody && (
                                          <details className="mt-1">
                                            <summary className="cursor-pointer text-xs text-blue-600 underline">View source text</summary>
                                            <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border bg-white p-2 text-xs">{x.contentItem.textBody}</pre>
                                          </details>
                                        )}
                                        {x.contentItem.assetUrl && !x.contentItem.textBody && (
                                          <a
                                            className="mt-0.5 inline-block text-xs text-blue-600 underline"
                                            href={`/api/admin/files/${x.contentItem.assetUrl.split("/").pop()}`}
                                            target="_blank" rel="noreferrer"
                                          >
                                            Play / download source audio
                                          </a>
                                        )}
                                      </div>
                                    )}
                                    {x.textBody && (
                                      <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">{x.textBody}</pre>
                                    )}
                                    {x.fileId && !x.textBody && (
                                      <a className="mt-2 inline-block text-xs underline"
                                        href={`/api/admin/files/${x.fileId}`} target="_blank" rel="noreferrer">
                                        Download recording
                                      </a>
                                    )}
                                    {x.answersJson && !x.textBody && !x.fileId && (
                                      <AnswersReview entries={x.answersJson} />
                                    )}
                                    {!x.textBody && !x.fileId && !x.answersJson && (
                                      <p className="mt-1 text-xs text-gray-400">(No response)</p>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {!historyLoading && historyTotal > HISTORY_PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <button className="rounded border px-3 py-1 disabled:opacity-50"
                  disabled={historyPage <= 1}
                  onClick={() => loadHistory(historyPage - 1)}>
                  ← Previous
                </button>
                <span className="text-xs text-gray-500">
                  Page {historyPage} of {Math.ceil(historyTotal / HISTORY_PAGE_SIZE)} · {historyTotal} total
                </span>
                <button className="rounded border px-3 py-1 disabled:opacity-50"
                  disabled={historyPage >= Math.ceil(historyTotal / HISTORY_PAGE_SIZE)}
                  onClick={() => loadHistory(historyPage + 1)}>
                  Next →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function AnswersReview({ entries }: { entries: AnswerEntry[] }) {
  if (!entries?.length) return <p className="mt-1 text-xs text-gray-400">No answers recorded.</p>;
  return (
    <div className="mt-2 space-y-1">
      {entries.map((e, i) => {
        if ("studentAnswers" in e) {
          return (
            <div key={i} className="rounded border border-gray-200 p-2 text-xs">
              <p className="font-medium text-gray-700">Q{i + 1}: {e.score}/{e.maxScore} correct</p>
              <p className="text-gray-500">Student: {e.studentAnswers.join(", ") || "—"}</p>
              <p className="text-green-700">Correct: {e.correctAnswers.join(", ")}</p>
            </div>
          );
        }
        return (
          <div key={i} className={`rounded border p-2 text-xs ${e.isCorrect ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <p className="font-medium">Q{i + 1}: {e.isCorrect ? "✅ Correct" : "❌ Incorrect"}</p>
            <p className="text-gray-600">Student: {e.studentAnswer || "—"}</p>
            {!e.isCorrect && <p className="text-green-700">Correct: {e.correctAnswer}</p>}
          </div>
        );
      })}
    </div>
  );
}

type QBBuilderProps = {
  format: "mcq" | "msaq" | "fill_blank";
  onFormatChange: (f: "mcq" | "msaq" | "fill_blank") => void;
  questions: AnyQ[];
  isDirty: boolean;
  loading: boolean;
  saving: boolean;
  msg: string | null;
  err: string | null;
  onAdd: (type: "mcq" | "msaq" | "fill_blank") => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<AnyQ>) => void;
  onSave: () => void;
  onClose: () => void;
};

function QuestionBankBuilder({ format, onFormatChange, questions, isDirty, loading, saving, msg, err, onAdd, onRemove, onUpdate, onSave, onClose }: QBBuilderProps) {
  return (
    <div className="mt-2 rounded border border-blue-100 bg-blue-50 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-blue-800">Question Bank</span>
        <div className="flex items-center gap-2">
          {isDirty && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">Unsaved</span>}
          <button onClick={onSave} disabled={saving || questions.length === 0}
            className="rounded border border-blue-300 bg-white px-2 py-0.5 text-xs text-blue-700 disabled:opacity-60">
            {saving ? "Saving..." : "Save bank"}
          </button>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
        </div>
      </div>
 
      {/* Format selector — always visible so admin can add mixed question types.
          Changing format only affects which type the next "Add" button creates.
          Existing questions of other types are preserved unchanged. */}
      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs text-gray-500 shrink-0">Add question type:</label>
        <select
          className="flex-1 rounded border px-2 py-0.5 text-xs"
          value={format}
          onChange={(e) => onFormatChange(e.target.value as "mcq" | "msaq" | "fill_blank")}
          disabled={loading || saving}
        >
          <option value="mcq">Multiple choice (MCQ)</option>
          <option value="msaq">Multiple short answer (MSAQ)</option>
          <option value="fill_blank">Fill in the blank</option>
        </select>
        <button
          onClick={() => onAdd(format)}
          disabled={loading || saving}
          className="shrink-0 rounded border bg-white px-2 py-0.5 text-xs text-blue-700 disabled:opacity-60"
        >
          + Add
        </button>
      </div>
 
      {msg && <p className="mb-2 text-xs text-green-700">{msg}</p>}
      {err && <p className="mb-2 text-xs text-red-600">{err}</p>}
      {loading && <p className="text-xs text-gray-500">Loading...</p>}
 
      {!loading && (
        <div className="space-y-3">
          {questions.length === 0 && (
            <p className="text-xs text-gray-400">No questions yet. Select a type above and click Add.</p>
          )}
 
          {questions.map((q, i) => (
            <div key={q.id} className="rounded border bg-white p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium">Q{i + 1} — {q.type.replace("_", " ").toUpperCase()}</span>
                <button onClick={() => onRemove(q.id)} className="text-xs text-red-500">Remove</button>
              </div>
              <input
                className="w-full rounded border px-2 py-1 text-xs"
                value={q.prompt}
                onChange={(e) => onUpdate(q.id, { prompt: e.target.value })}
                placeholder="Prompt / question text"
              />
              {q.type === "mcq" && (
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-1">Options — click radio for correct</p>
                  {(q as McqQ).options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-1 mb-1">
                      <input type="radio" name={`ca_${q.id}`}
                        checked={(q as McqQ).correctAnswer === opt && opt.trim() !== ""}
                        onChange={() => onUpdate(q.id, { correctAnswer: opt } as Partial<McqQ>)}
                        disabled={!opt.trim()} />
                      <input className="flex-1 rounded border px-2 py-0.5 text-xs" value={opt}
                        placeholder={`Option ${oi + 1}`}
                        onChange={(e) => {
                          const opts = [...(q as McqQ).options]; opts[oi] = e.target.value;
                          onUpdate(q.id, { options: opts } as Partial<McqQ>);
                        }} />
                    </div>
                  ))}
                </div>
              )}
              {q.type === "msaq" && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-500">Answers expected:</span>
                    <input type="number" min={1} max={6} className="w-12 rounded border px-1 py-0.5 text-xs"
                      value={(q as MsaqQ).answerCount}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(6, parseInt(e.target.value) || 1));
                        const arr = [...(q as MsaqQ).correctAnswers];
                        while (arr.length < n) arr.push("");
                        onUpdate(q.id, { answerCount: n, correctAnswers: arr.slice(0, n) } as Partial<MsaqQ>);
                      }} />
                  </div>
                  {(q as MsaqQ).correctAnswers.map((ans, ai) => (
                    <input key={ai} className="w-full rounded border px-2 py-0.5 text-xs mb-1"
                      value={ans} placeholder={`Correct answer ${ai + 1}`}
                      onChange={(e) => {
                        const arr = [...(q as MsaqQ).correctAnswers]; arr[ai] = e.target.value;
                        onUpdate(q.id, { correctAnswers: arr } as Partial<MsaqQ>);
                      }} />
                  ))}
                </div>
              )}
              {q.type === "fill_blank" && (
                <input className="mt-2 w-full rounded border px-2 py-0.5 text-xs"
                  value={(q as FillQ).correctAnswer} placeholder="Correct answer"
                  onChange={(e) => onUpdate(q.id, { correctAnswer: e.target.value } as Partial<FillQ>)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}