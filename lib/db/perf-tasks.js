import "server-only";
import { getServiceClient } from "./serviceClient";

// HQ-assigned tasks (perf_tasks, created on VetXpress → Admin →
// Performance → Tasks). This app shows a person's open ones on My day and
// lets them mark progress, the same staff-side change the WordPress widget
// makes, so both stay in step. Creating and editing tasks stays on the
// VetXpress Tasks board.

export class PerfTaskNotFoundError extends Error {
  constructor() {
    super("Task not found.");
    this.name = "PerfTaskNotFoundError";
  }
}

function todayLagos() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function rowToTask(row) {
  const open = row.status === "pending" || row.status === "in_progress";
  return {
    id: row.id,
    staffId: row.staff_id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    isOverdue: open && !!row.due_date && row.due_date < todayLagos(),
    completedAt: row.completed_at,
  };
}

export async function listTasksForStaff(staffId) {
  const { data, error } = await getServiceClient()
    .from("perf_tasks")
    .select("*")
    .eq("staff_id", staffId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToTask);
}

export async function updateTaskStatus(taskId, staffId, newStatus) {
  if (newStatus !== "in_progress" && newStatus !== "completed") throw new Error("Invalid status.");
  const sb = getServiceClient();
  const { data: existing, error: fetchError } = await sb.from("perf_tasks").select("status").eq("id", taskId).eq("staff_id", staffId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) throw new PerfTaskNotFoundError();
  if (existing.status === "cancelled" || existing.status === "completed") throw new Error("This task can no longer be updated.");
  const { data: row, error } = await sb
    .from("perf_tasks")
    .update({ status: newStatus, completed_at: newStatus === "completed" ? new Date().toISOString() : null })
    .eq("id", taskId)
    .eq("staff_id", staffId)
    .select()
    .single();
  if (error) throw error;
  return rowToTask(row);
}
