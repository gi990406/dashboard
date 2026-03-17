// dashboard/server/server.js
const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");

// demo
const { spawn } = require("child_process");
const path = require("path");
//
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "config.json"), "utf-8")
);
//demo
const PORT = config.serverPort || 5000;
let replayProc = null;

const DIST_PATH = path.join(__dirname, "../dashboard-web/dist");
app.use(express.static(DIST_PATH));
//



// ------------------------------
// (demo) 라이다PC로 시작 요청 보낼 프록시
// ------------------------------
// const LIDAR_BASE = process.env.LIDAR_BASE || "http://LIDARIP"; // 라이다PC 실제로 바꾸기

// app.post("/api/demo/start", async (req, res) => {
//   try {
//     const r = await fetch(`${LIDAR_BASE}/api/demo/start`, {
//       method: "POST",
//       headers: { "Content-Type": "application/json"},
//       body: JSON.stringify(req.body ?? {}),
//     });

//     const data = await r.json().catch(() => ({}));
//     if (!r.ok) throw new Error(data?.message || "lidar demo start failed");

//     pushLog("Demo START forwarded to Lidar PC");
//     res.json({ok:true, lidar:data});

//   } catch(err) {
//     console.error("[demo/start]", err);
//     pushLog(`Demo START failed: ${String(err.message || err)}`);
//     res.status(502).json({ok:false, error:String(err.message || err)});
//   }
// });

//demo
app.post("/api/demo/start", (req, res) => {
  try {
    if (replayProc) {
      return res.json({ ok: true, message: "Replay already running" });
    }

    const replayPath = path.join(__dirname, "replay.js");

    replayProc = spawn(process.execPath, [replayPath], {
      cwd: __dirname,
      env: {
        ...process.env,
        DASHBOARD_BASE: `http://127.0.0.1:${PORT}`,
      },
      stdio: "pipe",
    });

    replayProc.stdout.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(msg);
    });

    replayProc.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error("[replay stderr]", msg);
    });

    replayProc.on("close", (code) => {
      console.log(`[replay] exited with code ${code}`);
      replayProc = null;
    });

    pushLog("Demo replay started");
    res.json({ ok: true, message: "Replay started" });
  } catch (err) {
    console.error("[demo/start]", err);
    pushLog(`Demo START failed: ${String(err.message || err)}`);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});
//

// ------------------------------
// MOCK 상태 (실장비 붙기 전 "구조 확인"용)
// ------------------------------
const state = {
  siteId: "Site-01",
  deviceId: "LIDAR-01",

  // KPI
  todaysEvents: 3,
  vehiclesPassed: 12842,
  wrongWayEvents: 2,
  unidentified: 24,

  // Lidar-like stats
  lidar: { pts: 2405, hz: 10 },

  // Controls
  gate: "CLOSED", // OPENED | CLOSED
  vmsLast: "",
};

let logs = [
  { msg: "System boot completed", time: nowTime() },
  { msg: "Mock pipeline ready", time: nowTime() },
];

function nowTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function pushLog(msg) {
  const item = { msg, time: nowTime() };
  logs.unshift(item);
  if (logs.length > 30) logs = logs.slice(0, 30);
  broadcast("log", item);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// ------------------------------
// REST (제어 요청 처리 구조 확인)
// ------------------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get("/api/state", (req, res) => res.json(state));
app.get("/api/logs", (req, res) => res.json(logs.slice(0, 10)));

app.post("/api/gate/open", (req, res) => {
  state.gate = "OPENED";
  console.log("[MOCK] BARRIER: OPEN");
  pushLog("Barrier OPEN requested");
  broadcast("state", state);
  res.json({ ok: true, gate: state.gate });
});

app.post("/api/gate/close", (req, res) => {
  state.gate = "CLOSED";
  console.log("[MOCK] BARRIER: CLOSE");
  pushLog("Barrier CLOSE requested");
  broadcast("state", state);
  res.json({ ok: true, gate: state.gate });
});

app.post("/api/vms", (req, res) => {
  const text = String(req.body?.text ?? "").slice(0, 80);
  state.vmsLast = text;
  console.log(`[MOCK] VMS TEXT: ${text}`);
  pushLog(`VMS requested: ${text || "(empty)"}`);
  broadcast("state", state);
  res.json({ ok: true, vmsLast: state.vmsLast });
});

// ------------------------------
// ITS CCTV API Proxy
// ------------------------------
app.get("/api/cctv", async (req, res) => {
  try {
    const { itsApiKey, cctvConfig } = config;

    if (!itsApiKey || itsApiKey === "YOUR_ITS_API_KEY_HERE" || itsApiKey.length < 10) {
      return res.status(401).json({
        ok: false,
        error: "ITS API Key is missing or invalid in config.json"
      });
    }

    const params = new URLSearchParams({
      apiKey: itsApiKey,
      type: req.query.type || cctvConfig.type,
      cctvType: req.query.cctvType || cctvConfig.cctvType,
      minX: req.query.minX || cctvConfig.minX,
      maxX: req.query.maxX || cctvConfig.maxX,
      minY: req.query.minY || cctvConfig.minY,
      maxY: req.query.maxY || cctvConfig.maxY,
      getType: "json"
    });

    const url = `https://openapi.its.go.kr:9443/cctvInfo?${params.toString()}`;
    console.log(`[CCTV] Requesting: ${url}`);

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.message || `ITS API responded with status ${response.status}`);
    }

    res.json({ ok: true, data });
  } catch (err) {
    console.error("[CCTV Error]", err);
    res.status(502).json({ ok: false, error: String(err.message || err) });
  }
});

// 실장비/리플레이 라이다px-> 대시보드pc 이벤트 전송 수신
app.post("/api/wrongway", (req, res) => {
  const body = req.body || {};
  console.log("[wrongway hit]", new Date().toISOString(), body);

  //라이다 pc가 보내는 표준(필드 일부만 와도 동작)
  const alert = {
    id: body.id || `evt-${Date.now()}`,
    type: "wrong-way",
    stage: Number(body.stage) || 1,
    message: "WRONG WAY DETECTION",
    subMessage: body.message || `Zone: ${body.zone_id || "UNKNOWN"}`,
    timestamp: body.timestamp ? new Date(body.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : nowTime(),
    zone_id: body.zone_id,
    track_id: body.track_id,
    confidence: body.confidence,
    video_ts_ms: body.video_ts_ms,
    device_id: body.device_id,
    serial_no: body.serial_no,
  };

  console.log("[broadcast alert", alert);

  //kpi/로그반영
  applyAlertEffects(alert);
  broadcast("alert", alert);
  broadcast("state", state);
  pushLog(`[WRONGWAY] ${alert.subMessage}`);

  res.json({ ok: true });
});

// ------------------------------ 
// WebSocket (실시간 수신 구조 확인)
// ------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, ts: Date.now(), payload });
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(msg);
  });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "state", ts: Date.now(), payload: state }));
  ws.send(JSON.stringify({ type: "logs", ts: Date.now(), payload: logs.slice(0, 10) }));
});

// ------------------------------
// 시뮬레이터: KPI가 1초마다 변동 
// ------------------------------
function makeAlert(type) {
  if (type === "unidentified") {
    return {
      id: `alert-${Math.floor(Math.random() * 900 + 100)}`,
      type: "unidentified",
      message: "UNIDENTIFIED OBJECT",
      subMessage: "Low confidence classification",
      timestamp: nowTime(),
    };
  }
  if (type === "system") {
    return {
      id: `alert-${Math.floor(Math.random() * 900 + 100)}`,
      type: "system",
      message: "SENSOR SYNC WARNING",
      subMessage: "Heartbeat jitter detected",
      timestamp: nowTime(),
    };
  }
  return {
    id: `alert-${Math.floor(Math.random() * 900 + 100)}`,
    type: "wrong-way",
    message: "WRONG WAY DETECTED",
    subMessage: "Vehicle detected on Exit Ramp B",
    timestamp: nowTime(),
  };
}

function applyAlertEffects(alert) {
  state.todaysEvents += 1;
  state.vehiclesPassed += Math.floor(Math.random() * 9 + 1); // 1~9

  if (alert.type === "wrong-way") state.wrongWayEvents += 1;
  if (alert.type === "unidentified") state.unidentified += 1;
}

setInterval(() => {
  // 1) KPI 주기 변동(캡처용)
  state.vehiclesPassed += Math.floor(Math.random() * 5); // 0~4
  state.lidar.pts += Math.floor(Math.random() * 11) - 5; // -5~+5
  state.lidar.pts = clamp(state.lidar.pts, 0, 999999);

  // HZ가 10/11 왔다갔다하는 느낌
  state.lidar.hz = 10 + (Math.random() < 0.5 ? 0 : 1);

  broadcast("state", state);

}, 1000);

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(DIST_PATH, "index.html"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server started and listening on port ${PORT}`);
  console.log(`REST  http://${config.dashboardIP}:${PORT}/api/state`);
  console.log(`WS    ws://${config.dashboardIP}:${PORT}`);
});
