// Klien API untuk backend PPE Detection (FastAPI di Railway).
// URL backend diambil dari environment variable VITE_API_URL (di-set di Vercel/.env).

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8000";

export interface PredictDetection {
  class_id: number;
  class_name: string;
  confidence: number; // 0..1
  box_xyxy: [number, number, number, number];
}

export interface PredictResponse {
  count: number;
  detections: PredictDetection[];
}

export async function predictImage(blob: Blob): Promise<PredictResponse> {
  const formData = new FormData();
  formData.append("file", blob, "capture.jpg");

  const res = await fetch(`${API_BASE}/predict`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Gagal memanggil /predict (${res.status})`);
  }
  return res.json();
}

export interface ChecklistPayload {
  technician: string;
  location: string;
  helmet: boolean;
  vest: boolean;
  shoes: boolean;
  conf_helmet: number;
  conf_vest: number;
  conf_shoes: number;
  image?: string;
  override_approved?: boolean;
}

export interface ChecklistSaved {
  id: string;
  timestamp: string;
  technician: string;
  location: string;
  result: { helmet: boolean; vest: boolean; shoes: boolean };
  confidences: { helmet: number; vest: number; shoes: number };
  approved: boolean;
  image?: string | null;
}

export async function saveChecklist(payload: ChecklistPayload): Promise<ChecklistSaved> {
  const res = await fetch(`${API_BASE}/checklist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Gagal menyimpan checklist (${res.status})`);
  }
  return res.json();
}

export async function fetchHistory(limit = 200): Promise<ChecklistSaved[]> {
  const res = await fetch(`${API_BASE}/checklist/history?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Gagal mengambil riwayat (${res.status})`);
  }
  const data = await res.json();
  return data.entries as ChecklistSaved[];
}

export interface StatsResponse {
  total: number;
  approved: number;
  rejected: number;
  avg_confidence: number;
  weekly: { day: string; approved: number; rejected: number }[];
  apd_rates: { name: string; value: number }[];
  trend: { date: string; rate: number | null }[];
}

export async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_BASE}/checklist/stats`);
  if (!res.ok) {
    throw new Error(`Gagal mengambil statistik (${res.status})`);
  }
  return res.json();
}
