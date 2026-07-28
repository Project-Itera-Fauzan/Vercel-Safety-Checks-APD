import { useState, useRef, useEffect, useCallback } from "react";
import plnLogo from "@/imports/logo-desktop.png";
import {
  predictImage,
  saveChecklist,
  fetchHistory,
  fetchStats,
  type ChecklistSaved,
  type StatsResponse,
} from "@/lib/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────

type ApdItem = "helmet" | "vest" | "shoes";
type View = "check" | "stats" | "history";
type ApdStatus = "idle" | "scanning" | "done";

interface DetectionResult {
  helmet: boolean;
  vest: boolean;
  shoes: boolean;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const TECHNICIANS = [
  { id: "T001", name: "Rayhan" },
  { id: "T002", name: "Agung" },
  { id: "T003", name: "Zulius" },
  { id: "T004", name: "Gilang" },
];


// Data riwayat & statistik sekarang diambil langsung dari backend (MySQL via Railway),
// lihat pemanggilan fetchHistory()/fetchStats() di HistoryView & StatsView di bawah.

// ─── APD Labels ───────────────────────────────────────────────────────────────

const APD_ITEMS: { key: ApdItem; label: string; icon: string }[] = [
  { key: "helmet", label: "Helm Safety", icon: "⛑" },
  { key: "vest", label: "Rompi / Vest", icon: "🦺" },
  { key: "shoes", label: "Sepatu Safety / Boots", icon: "👟" },
];


// ─── Sub-components ───────────────────────────────────────────────────────────

function NetworkBadge() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-semibold ${online ? "bg-emerald-950/60 text-emerald-400 border border-emerald-700/40" : "bg-red-950/60 text-red-400 border border-red-700/40"}`}
    >
      <span
        className={`w-2 h-2 rounded-full ${online ? "bg-emerald-400" : "bg-red-400"} ${online ? "blink" : ""}`}
      />
      {online ? "Online" : "Offline"}
    </div>
  );
}

// ─── Camera / Scan Simulation ─────────────────────────────────────────────────

function CameraView({
  onDetect,
  onReset,
}: {
  onDetect: (
    result: DetectionResult,
    confidences: Record<ApdItem, number>,
    techName: string,
    location: string,
    image?: string,
  ) => void;
  onReset: () => void;
}) {
  const [status, setStatus] = useState<ApdStatus>("idle");
  const [techId, setTechId] = useState("");
  const [location, setLocation] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Nyalakan kamera perangkat begitu komponen dipasang
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraError(null);
      } catch (err) {
        setCameraError("Tidak bisa mengakses kamera. Izinkan akses kamera di browser lalu muat ulang halaman.");
      }
    }

    startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const captureFrameAsBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.videoWidth === 0) {
        resolve(null);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
    });
  }, []);

  const startScan = useCallback(async () => {
    if (!techId) {
      alert("Pilih Anggota Tim terlebih dahulu.");
      return;
    }
    if (!location.trim()) {
      alert("Isi Lokasi Penugasan terlebih dahulu.");
      return;
    }

    setScanError(null);
    setStatus("scanning");

    try {
      const blob = await captureFrameAsBlob();
      if (!blob) {
        throw new Error("Gagal mengambil gambar dari kamera.");
      }

      // Simpan snapshot gambar yang baru saja diambil (untuk freeze frame & riwayat)
      const dataUrl = canvasRef.current?.toDataURL("image/jpeg", 0.85) ?? undefined;
      setCapturedImage(dataUrl ?? null);

      const response = await predictImage(blob);

      const result: DetectionResult = { helmet: false, vest: false, shoes: false };
      const confidences: Record<ApdItem, number> = { helmet: 0, vest: 0, shoes: 0 };

      for (const det of response.detections) {
        const pct = Math.round(det.confidence * 100);
        if (det.class_name === "Safety Helmet" && pct > confidences.helmet) {
          result.helmet = true;
          confidences.helmet = pct;
        } else if (det.class_name === "Safety Vest" && pct > confidences.vest) {
          result.vest = true;
          confidences.vest = pct;
        } else if (det.class_name === "Safety Boot" && pct > confidences.shoes) {
          result.shoes = true;
          confidences.shoes = pct;
        }
      }

      const techName = TECHNICIANS.find((t) => t.id === techId)?.name ?? techId;
      setStatus("done");
      onDetect(result, confidences, techName, location.trim(), dataUrl);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Gagal memproses deteksi. Coba lagi.");
      setStatus("idle");
    }
  }, [techId, location, captureFrameAsBlob, onDetect]);

  const reset = useCallback(() => {
    setStatus("idle");
    setScanError(null);
    setCapturedImage(null);
    onReset();
  }, [onReset]);

  return (
    <div className="flex flex-col gap-5">
      {/* Technician select */}
      <div>
        <label className="block text-xs font-semibold text-emerald-400 mb-1.5 uppercase tracking-widest">
          Anggota Tim
        </label>
        <select
          value={techId}
          onChange={(e) => setTechId(e.target.value)}
          disabled={status !== "idle"}
          className="w-full bg-[#0d2218] border border-[#1a4030] text-[#e8f0f5] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
        >
          <option value="">-- Pilih Anggota Tim --</option>
          {TECHNICIANS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Location input */}
      <div>
        <label className="block text-xs font-semibold text-emerald-400 mb-1.5 uppercase tracking-widest">
          Lokasi Penugasan
        </label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          disabled={status !== "idle"}
          placeholder="Contoh: GI Cilegon, Tower SUTT 150kV..."
          className="w-full bg-[#0d2218] border border-[#1a4030] text-[#e8f0f5] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50 placeholder:text-[#2a5a3a]"
        />
      </div>

      {/* Camera viewport */}
      <div className="relative w-full aspect-video bg-[#050e08] rounded-xl overflow-hidden border border-[#1a4030]">
        {/* Live camera feed */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Freeze frame: foto hasil capture, menutupi video selama status "done" */}
        {status === "done" && capturedImage && (
          <img
            src={capturedImage}
            alt="Hasil capture"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <canvas ref={canvasRef} className="hidden" />

        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#050e08]/90 px-6 text-center">
            <p className="text-sm font-mono text-red-400">{cameraError}</p>
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center">
          {status === "scanning" && (
            <>
              {/* Animated scan overlay */}
              <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 via-transparent to-emerald-500/5" />
              {/* Corner brackets */}
              {[
                "top-4 left-4 border-t-2 border-l-2",
                "top-4 right-4 border-t-2 border-r-2",
                "bottom-4 left-4 border-b-2 border-l-2",
                "bottom-4 right-4 border-b-2 border-r-2",
              ].map((cls, i) => (
                <div
                  key={i}
                  className={`absolute w-8 h-8 border-[#FFF200] ${cls}`}
                />
              ))}
              {/* Scan line */}
              <div
                className="scan-line absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent opacity-80"
                style={{ top: 0 }}
              />
              {/* Center target */}
              <div className="flex flex-col items-center gap-2">
                <div className="w-16 h-16 rounded-full border-2 border-[#FFF200]/60 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-[#FFF200] spinner" />
                </div>
                <span className="text-[#FFF200] text-xs font-mono font-bold tracking-widest">
                  MENGANALISIS APD...
                </span>
              </div>
              {/* Progress bar (indeterminate — durasi tergantung respons server) */}
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0d2218] overflow-hidden">
                <div className="h-full w-1/3 bg-emerald-400 animate-pulse" />
              </div>
            </>
          )}

          {status === "done" && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#050e08]/60">
              <div className="flex flex-col items-center gap-2">
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500 flex items-center justify-center">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path d="M5 13l4 4L19 7" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span className="text-emerald-400 text-xs font-mono font-bold tracking-widest">
                  ANALISIS SELESAI
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Live timestamp */}
        {status !== "idle" && (
          <div className="absolute top-3 left-3 font-mono text-[10px] text-emerald-400/70">
            {new Date().toLocaleString("id-ID")} · REC
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        {status !== "done" ? (
          <button
            onClick={startScan}
            disabled={status === "scanning"}
            className="flex-1 py-3.5 rounded-xl font-bold text-sm tracking-wide transition-all
              bg-[#FFF200] text-[#060f0a] hover:bg-yellow-300 active:scale-95
              disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100
              flex items-center justify-center gap-2"
          >
            {status === "scanning" ? (
              <>
                <span className="w-4 h-4 border-2 border-[#060f0a]/30 border-t-[#060f0a] rounded-full spinner" />
                Sedang Memindai...
              </>
            ) : (
              <>📸 Ambil Gambar &amp; Cek APD</>
            )}
          </button>
        ) : (
          <button
            onClick={reset}
            className="flex-1 py-3.5 rounded-xl font-bold text-sm tracking-wide transition-all
              bg-[#0f2a1e] text-[#e8f0f5] hover:bg-[#1a4030] active:scale-95 border border-[#1a4030]"
          >
            🔄 Ulangi Pengecekan
          </button>
        )}
      </div>

      {scanError && (
        <p className="text-xs font-mono text-red-400 text-center">{scanError}</p>
      )}
    </div>
  );
}

// ─── APD Checklist ────────────────────────────────────────────────────────────

function ApdChecklist({
  result,
  confidences,
  onApprove,
  canApprove,
}: {
  result: DetectionResult;
  confidences: Record<ApdItem, number>;
  onApprove: () => void;
  canApprove: boolean;
}) {
  const detectedCount = APD_ITEMS.filter((item) => result[item.key]).length;
  const allDetected = detectedCount === APD_ITEMS.length;
  const safetyPct = canApprove ? Math.round((detectedCount / APD_ITEMS.length) * 100) : 0;

  const barColor =
    safetyPct === 100
      ? "bg-emerald-400"
      : safetyPct >= 75
      ? "bg-yellow-400"
      : safetyPct >= 50
      ? "bg-orange-400"
      : "bg-red-500";

  const safetyLabel =
    safetyPct === 100
      ? "AMAN PENUH"
      : safetyPct >= 75
      ? "HAMPIR LENGKAP"
      : safetyPct >= 50
      ? "PERLU PERHATIAN"
      : safetyPct > 0
      ? "BERBAHAYA"
      : "BELUM DICEK";

  const safetyTextColor =
    safetyPct === 100
      ? "text-emerald-400"
      : safetyPct >= 75
      ? "text-yellow-400"
      : safetyPct >= 50
      ? "text-orange-400"
      : safetyPct > 0
      ? "text-red-400"
      : "text-[#2a5a3a]";

  return (
    <div className="flex flex-col gap-3">
      {/* Progress kelengkapan APD */}
      <div className="bg-[#0d2218] border border-[#1a4030] rounded-xl p-4 mb-1">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Kelengkapan APD
          </span>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-mono font-bold uppercase tracking-wide ${safetyTextColor}`}>
              {safetyLabel}
            </span>
            <span className={`text-xl font-bold font-mono ${safetyTextColor}`}>
              {safetyPct}%
            </span>
          </div>
        </div>
        {/* Progress bar */}
        <div className="w-full h-3 bg-[#060f0a] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${safetyPct}%` }}
          />
        </div>
        {/* Segment ticks */}
        <div className="flex justify-between mt-1.5">
          {APD_ITEMS.map(({ key, icon }) => (
            <div key={key} className="flex flex-col items-center gap-0.5">
              <span className={`text-base transition-all duration-500 ${canApprove && result[key] ? "opacity-100" : "opacity-20 grayscale"}`}>
                {icon}
              </span>
            </div>
          ))}
        </div>
        {/* Persentase keselamatan label */}
        <div className="mt-3 pt-3 border-t border-[#1a4030] flex items-center justify-between">
          <span className="text-[10px] font-mono text-[#3d7a50]">Persentase Keselamatan</span>
          <div className="flex gap-1">
            {[25, 50, 75, 100].map((threshold) => (
              <div
                key={threshold}
                className={`w-6 h-1.5 rounded-full transition-all duration-500 ${
                  safetyPct >= threshold ? barColor : "bg-[#1a4030]"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Hasil Deteksi APD
        </h3>
        {canApprove && (
          <span className="text-xs font-mono text-[#3d7a50]">
            {detectedCount}/{APD_ITEMS.length} item terdeteksi
          </span>
        )}
      </div>

      {APD_ITEMS.map(({ key, label, icon }) => {
        const detected = result[key];
        const conf = confidences[key];
        return (
          <div
            key={key}
            className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all duration-500 ${
              canApprove
                ? detected
                  ? "border-emerald-600/50 bg-emerald-950/30"
                  : "border-red-700/40 bg-red-950/20"
                : "border-[#1a4030] bg-[#0d2218]/40"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`text-lg transition-all duration-500 ${canApprove && !detected ? "opacity-30 grayscale" : ""}`}>{icon}</span>
              <div>
                <p className="text-sm font-semibold text-[#e8f0f5]">{label}</p>
                {canApprove && (
                  <p className="text-[10px] font-mono text-[#3d7a50] mt-0.5">
                    {detected ? `Confidence: ${conf}%` : "Tidak terdeteksi"}
                  </p>
                )}
              </div>
            </div>
            {canApprove ? (
              <span
                className={`text-xs font-mono font-bold px-3 py-1 rounded-full ${
                  detected
                    ? "bg-emerald-900/60 text-emerald-400 border border-emerald-700/40"
                    : "bg-red-900/60 text-red-400 border border-red-700/40"
                }`}
              >
                {detected ? "✓ Dipakai" : "✗ Tidak Ada"}
              </span>
            ) : (
              <span className="text-xs font-mono text-[#1a4030]">—</span>
            )}
          </div>
        );
      })}

      {/* Approval button */}
      <button
        onClick={onApprove}
        disabled={!canApprove}
        className={`mt-2 w-full py-4 rounded-xl font-bold text-sm tracking-widest transition-all active:scale-95
          ${canApprove
            ? allDetected
              ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20"
              : "bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-600/20"
            : "bg-[#0d2218] text-[#1a4030] border border-[#1a4030] cursor-not-allowed"
          }`}
      >
        {allDetected && canApprove
          ? "✔ BERIKAN IZIN KEBERANGKATAN"
          : canApprove && !allDetected
          ? "⚠ APD TIDAK LENGKAP — KIRIM SEBAGAI DITOLAK"
          : "Lakukan Pengecekan Terlebih Dahulu"}
      </button>
    </div>
  );
}

// ─── Statistics View ──────────────────────────────────────────────────────────

const APD_PIE_COLORS: Record<string, string> = {
  Helm: "#FFF200",
  Vest: "#22c55e",
  Sepatu: "#1D5A73",
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0d2218] border border-[#1a4030] rounded-lg px-3 py-2 text-xs font-mono shadow-xl">
        <p className="text-[#4a9070] mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.color }}>
            {p.name}: {p.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

function StatsView() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStats()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Gagal memuat statistik");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm font-mono text-[#4a9070]">Memuat statistik...</p>;
  }
  if (error || !stats) {
    return <p className="text-sm font-mono text-red-400">Gagal memuat statistik: {error}</p>;
  }
  if (stats.total === 0) {
    return <p className="text-sm font-mono text-[#4a9070]">Belum ada data pengecekan APD.</p>;
  }

  const rate = Math.round((stats.approved / stats.total) * 100);
  const apdPieWithColor = stats.apd_rates.map((d) => ({ ...d, color: APD_PIE_COLORS[d.name] ?? "#4a9070" }));

  const statCards = [
    { label: "Total Pengecekan", value: stats.total, sub: "Sepanjang waktu", color: "#22c55e" },
    { label: "Diizinkan", value: stats.approved, sub: `${rate}% approval rate`, color: "#34d399" },
    { label: "Ditolak", value: stats.rejected, sub: "APD tidak lengkap", color: "#ED1C24" },
    { label: "Rata-rata Confidence", value: `${stats.avg_confidence}%`, sub: "Akurasi deteksi AI", color: "#FFF200" },
  ];

  return (
    <div className="flex flex-col gap-6 fade-in-up">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="bg-[#0d2218] border border-[#1a4030] rounded-xl p-5">
            <p className="text-[10px] font-mono uppercase tracking-widest text-[#4a9070] mb-2">{s.label}</p>
            <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[11px] text-[#4a9070] mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Bar chart */}
        <div className="lg:col-span-2 bg-[#0d2218] border border-[#1a4030] rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-4">
            Pengecekan per Hari (Minggu Ini)
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.weekly} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243d52" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "#7a9db5", fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#7a9db5", fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="approved" name="Diizinkan" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="rejected" name="Ditolak" fill="#ED1C24" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie chart - APD detection rates */}
        <div className="bg-[#0d2218] border border-[#1a4030] rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-4">
            Tingkat Pemakaian APD
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={apdPieWithColor} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={3} dataKey="value">
                {apdPieWithColor.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Legend
                formatter={(value) => (
                  <span style={{ color: "#7a9db5", fontSize: 11, fontFamily: "JetBrains Mono" }}>{value}</span>
                )}
              />
              <Tooltip content={<CustomTooltip />} formatter={(v) => [`${v}%`, "Terdeteksi"]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Trend line */}
      <div className="bg-[#0d2218] border border-[#1a4030] rounded-xl p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-4">
          Tren Tingkat Kelulusan APD (14 Hari Terakhir)
        </p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={stats.trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#243d52" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#7a9db5", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
            <YAxis domain={[60, 100]} tick={{ fill: "#7a9db5", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} unit="%" />
            <Tooltip content={<CustomTooltip />} formatter={(v) => [`${v}%`, "Tingkat Lulus"]} />
            <Line type="monotone" dataKey="rate" stroke="#FFF200" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#FFF200" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── History View ─────────────────────────────────────────────────────────────

function HistoryView() {
  const [filter, setFilter] = useState<"all" | "approved" | "rejected">("all");
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<ChecklistSaved[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchHistory()
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Gagal memuat riwayat");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = entries.filter((h) => {
    const matchFilter =
      filter === "all" || (filter === "approved" ? h.approved : !h.approved);
    const matchSearch =
      !search ||
      h.technician.toLowerCase().includes(search.toLowerCase()) ||
      h.id.toLowerCase().includes(search.toLowerCase()) ||
      h.location.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  if (loading) {
    return <p className="text-sm font-mono text-[#4a9070]">Memuat riwayat...</p>;
  }
  if (error) {
    return <p className="text-sm font-mono text-red-400">Gagal memuat riwayat: {error}</p>;
  }

  return (
    <div className="flex flex-col gap-4 fade-in-up">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Cari ID, nama teknisi, lokasi..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-[#0d2218] border border-[#1a4030] text-[#e8f0f5] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 placeholder:text-[#2a5a3a]"
        />
        <div className="flex gap-2">
          {(["all", "approved", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2.5 rounded-lg text-xs font-mono font-semibold uppercase tracking-wide transition-all ${
                filter === f
                  ? "bg-emerald-500 text-white"
                  : "bg-[#0d2218] text-[#4a9070] border border-[#1a4030] hover:border-emerald-500"
              }`}
            >
              {f === "all" ? "Semua" : f === "approved" ? "Diizinkan" : "Ditolak"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#0d2218] border border-[#1a4030] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a4030]">
                {["ID", "Waktu", "Teknisi", "Lokasi", "Foto", "APD", "Status"].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-[#4a9070]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <tr
                  key={entry.id}
                  className={`border-b border-[#0f2a1e]/60 hover:bg-[#0f2a1e]/40 transition-colors ${i % 2 === 0 ? "" : "bg-[#060f0a]/30"}`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-emerald-400">{entry.id}</td>
                  <td className="px-4 py-3 text-xs text-[#4a9070] whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#e8f0f5]">{entry.technician}</td>
                  <td className="px-4 py-3 text-xs text-[#4a9070] whitespace-nowrap">{entry.location}</td>
                  <td className="px-4 py-3">
                    {entry.image ? (
                      <button
                        onClick={() => setPreview(entry.image!)}
                        className="block w-11 h-11 rounded-lg overflow-hidden border border-[#1a4030] hover:border-emerald-500 transition-colors"
                        title="Lihat foto"
                      >
                        <img
                          src={entry.image}
                          alt={`Foto ${entry.id}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <span className="text-xs font-mono text-[#1a4030]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-wrap">
                      {APD_ITEMS.map(({ key, icon }) => (
                        <span
                          key={key}
                          title={key}
                          className={`text-sm ${entry.result[key] ? "opacity-100" : "opacity-20 grayscale"}`}
                        >
                          {icon}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full ${
                        entry.approved
                          ? "bg-emerald-900/40 text-emerald-400 border border-emerald-700/30"
                          : "bg-red-900/40 text-red-400 border border-red-700/30"
                      }`}
                    >
                      {entry.approved ? "IZIN" : "TOLAK"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-[#1a4030] text-[11px] font-mono text-[#2a5a3a]">
          {filtered.length} dari {entries.length} entri{entries.length === 0 && " (belum ada riwayat)"}
        </div>
      </div>

      {/* Lightbox foto */}
      {preview && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview}
            alt="Preview foto"
            className="max-w-full max-h-full rounded-xl border border-[#1a4030]"
          />
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<View>("check");
  const [detection, setDetection] = useState<DetectionResult>({
    helmet: false,
    vest: false,
    shoes: false,
  });
  const [hasScanned, setHasScanned] = useState(false);
  const [approvedCount, setApprovedCount] = useState(0);
  const [confidences, setConfidences] = useState<Record<ApdItem, number>>({
    helmet: 0,
    vest: 0,
    shoes: 0,
  });
  const [lastTech, setLastTech] = useState("");
  const [lastLocation, setLastLocation] = useState("");
  const [lastImage, setLastImage] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const handleDetect = useCallback(
    (
      result: DetectionResult,
      conf: Record<ApdItem, number>,
      techName: string,
      location: string,
      image?: string,
    ) => {
      // Dipanggil hanya saat scan sungguhan selesai (lihat CameraView.startScan),
      // jadi hasScanned selalu true di sini — termasuk saat tidak ada APD yang
      // terdeteksi sama sekali, supaya tetap bisa dikirim sebagai "DITOLAK".
      setDetection(result);
      setConfidences(conf);
      setLastTech(techName);
      setLastLocation(location);
      setLastImage(image);
      setHasScanned(true);
    },
    [],
  );

  const handleReset = useCallback(() => {
    setDetection({ helmet: false, vest: false, shoes: false });
    setConfidences({ helmet: 0, vest: 0, shoes: 0 });
    setLastTech("");
    setLastLocation("");
    setLastImage(undefined);
    setHasScanned(false);
  }, []);

  const handleApprove = useCallback(async () => {
    setSaving(true);
    try {
      const isComplete = detection.helmet && detection.vest && detection.shoes;
      await saveChecklist({
        technician: lastTech,
        location: lastLocation,
        helmet: detection.helmet,
        vest: detection.vest,
        shoes: detection.shoes,
        conf_helmet: confidences.helmet,
        conf_vest: confidences.vest,
        conf_shoes: confidences.shoes,
        image: lastImage,
      });
      setApprovedCount((c) => c + (isComplete ? 1 : 0));
      if (isComplete) {
        alert("✅ Izin Keberangkatan Diberikan!\n\nData telah dicatat ke sistem.");
      } else {
        alert("⛔ Izin Ditolak — APD tidak lengkap.\n\nData tetap dicatat ke sistem sebagai penolakan.");
      }
    } catch (err) {
      alert(
        `⚠️ Data gagal disimpan ke server (${err instanceof Error ? err.message : "unknown error"}).\nCek koneksi backend/Railway.`,
      );
    } finally {
      setSaving(false);
      setDetection({ helmet: false, vest: false, shoes: false });
      setConfidences({ helmet: 0, vest: 0, shoes: 0 });
      setLastImage(undefined);
      setHasScanned(false);
    }
  }, [detection, confidences, lastTech, lastLocation, lastImage]);

  const navItems: { id: View; label: string; icon: string }[] = [
    { id: "check", label: "Cek APD", icon: "🔍" },
    { id: "stats", label: "Statistik", icon: "📊" },
    { id: "history", label: "Riwayat", icon: "📋" },
  ];

  return (
    <div className="min-h-screen bg-[#060f0a] text-[#e8f0f5]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#060f0a]/95 backdrop-blur border-b border-[#1a4030]">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo area */}
            <div className="flex items-center gap-3">
              <img src={plnLogo} alt="PLN Icon Plus" className="h-10 w-auto object-contain" />
              <div className="hidden sm:block">
                <p className="font-bold text-sm text-[#e8f0f5] leading-tight">Sistem Pengecekan APD</p>
                <p className="text-[10px] font-mono text-emerald-400 leading-tight">Safety Management System</p>
              </div>
            </div>

            {/* Nav + status */}
            <div className="flex items-center gap-3">
              {/* Desktop nav */}
              <nav className="hidden sm:flex items-center gap-1 bg-[#0d2218] border border-[#1a4030] rounded-xl p-1">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                      view === item.id
                        ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                        : "text-[#4a9070] hover:text-[#e8f0f5]"
                    }`}
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </nav>

              {approvedCount > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-900/40 border border-emerald-700/30 text-emerald-400 text-xs font-mono">
                  ✓ {approvedCount} izin hari ini
                </div>
              )}

              <NetworkBadge />
            </div>
          </div>

          {/* Mobile nav */}
          <div className="flex sm:hidden gap-1 pb-3">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                  view === item.id
                    ? "bg-emerald-500 text-white"
                    : "text-[#4a9070] bg-[#0d2218] border border-[#1a4030]"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        {view === "check" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 fade-in-up">
            {/* Status bar */}
            <div className="lg:col-span-5 flex items-center gap-3">
              <div className="flex-1 h-px bg-[#1a4030]" />
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#2a5a3a]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FFF200] blink" />
                PENGECEKAN APD TERPADU — SISTEM AKTIF
              </div>
              <div className="flex-1 h-px bg-[#1a4030]" />
            </div>

            {/* Camera column */}
            <div className="lg:col-span-3 bg-[#0d2218] border border-[#1a4030] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-1 h-5 rounded-full bg-[#FFF200]" />
                <h2 className="text-sm font-bold text-[#e8f0f5] uppercase tracking-wider">
                  Kamera Pengecekan
                </h2>
              </div>
              <CameraView onDetect={handleDetect} onReset={handleReset} />
            </div>

            {/* Checklist column */}
            <div className="lg:col-span-2 bg-[#0d2218] border border-[#1a4030] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-1 h-5 rounded-full bg-emerald-500" />
                <h2 className="text-sm font-bold text-[#e8f0f5] uppercase tracking-wider">
                  Checklist APD
                </h2>
              </div>
              <ApdChecklist
                result={detection}
                confidences={confidences}
                onApprove={handleApprove}
                canApprove={hasScanned && !saving}
              />
            </div>

          </div>
        )}

        {view === "stats" && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-[#1a4030]" />
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#2a5a3a]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 blink" />
                DASBOR STATISTIK — PERIODE BERJALAN
              </div>
              <div className="flex-1 h-px bg-[#1a4030]" />
            </div>
            <StatsView />
          </>
        )}

        {view === "history" && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-[#1a4030]" />
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#2a5a3a]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FFF200] blink" />
                RIWAYAT PENGECEKAN APD
              </div>
              <div className="flex-1 h-px bg-[#1a4030]" />
            </div>
            <HistoryView />
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1a4030] mt-12 py-4 px-8">
        <p className="text-center text-[10px] font-mono text-[#2a5a3a]">
          PLN Icon Plus · Sistem Pengecekan APD Terpadu · &copy; 2025 · Keselamatan adalah prioritas utama
        </p>
      </footer>
    </div>
  );
}
