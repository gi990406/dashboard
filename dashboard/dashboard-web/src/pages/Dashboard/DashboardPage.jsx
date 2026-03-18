// /src/pages/Dashboard/Dashboard.jsx
import { useState, useEffect, useRef } from "react";
import { Card } from "../../components/dashboard/Card";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowDownRight,
  MoreHorizontal,
  Calendar,
  Activity,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Megaphone,
  Siren,
  AlertTriangle,
  X,
} from "lucide-react";

// ------------------------------
// DachboardPage Component
// ------------------------------
export default function DashboardPage({
  onNavigateToEvent,
  onNavigateToVehiclesPassed,
  onNavigateToTotalVehicles,
  onNavigateToUnidentified,
}) {
  const API_BASE = `http://${window.location.hostname}:5000`;
  const [activeAlert, setActiveAlert] = useState(null); // 긴급 팝업 데이터
  const [alertsEnabled, setAlertsEnabled] = useState(true); // 팝업 허용 토글(ON/OFF)
  const [vmsText, setVmsText] = useState(""); // 전광판 입력
  const [recentLogs, setRecentLogs] = useState([ // 최근 로그 목록
    { msg: "차량 진출로 B 통과", time: "10:42" },
    { msg: "LIDAR_01 동기화 정상", time: "10:41" },
    { msg: "차단기 A 열림", time: "10:38" },
  ]);

  const [serverAlive, setServerAlive] = useState(false); // 서버 alive 표시 => /api/health
  const [cctvData, setCctvData] = useState(null); // CCTV 데이터
  const cctvVideoRef = useRef(null); // CCTV 비디오 레프

  // kpi 페이지 이동 함수
  const navigate = useNavigate();
  const goEvents = (tab) => navigate(`/events?tab=${tab}`);

  // websocket onmessage의 항상 최신값 유지
  const alertsEnabledRef = useRef(alertsEnabled);
  useEffect(() => {
    alertsEnabledRef.current = alertsEnabled;
  }, [alertsEnabled]);

  // 팝업 버튼 핸들러
  const handleDismissAlert = () => {
    setActiveAlert(null);
  };


  const handleViewAlert = () => { // 즉시 조치화면 보기 -> 추후 구현
    if (activeAlert?.type === "wrong-way" && onNavigateToTotalVehicles) {
      onNavigateToTotalVehicles();
    } else if (activeAlert?.type === "unidentified" && onNavigateToUnidentified) {
      onNavigateToUnidentified();
    }
    setActiveAlert(null);
  };

  const MAX_RECENT_LOGS = 5;

  const pushLog = (msg) => {
    const t = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    setRecentLogs((prev) => [
      { msg, time: t },
      ...prev]);
  };

  // demo start-end 지점
  const videoRef = useRef(null);
  const DEMO_START_SEC = 17.496; // 시작 시점
  const DEMO_END_SEC = 62.226; // 종료 시점
  //

  //
  const handleDemoTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;

    if (v.currentTime >= DEMO_END_SEC) {
      v.pause();
      v.currentTime = DEMO_START_SEC;
      pushLog("Demo 영상 종료");
    }
  };
  //

  // ------------------------------
  // /api/demo/start
  // ------------------------------

  const startDemo = async () => {
    try {
      pushLog("Demo START 요청");

      // demo 영상 
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.currentTime = DEMO_START_SEC;
        await v.play();
      }

      //

      const r = await fetch(`${API_BASE}/api/demo/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || "start failed");
      pushLog("Demo START 성공");
    } catch (e) {
      pushLog(`Demo START 실패: ${String(e.message || e)}`);
    }
  };

  // ------------------------------
  // 전광판 차단기 ui용 함수
  // ------------------------------
  const sendVms = () => {
    const text = vmsText.trim();
    if (!text) return;
    pushLog(`전광판 송신: ${text}`);
    setVmsText("");
  };

  const quickVms = (text) => {
    setVmsText(text);
    pushLog(`전광판 문구 선택: ${text}`);
  };

  const openGate = () => pushLog("차단기 열기 요청");
  const closeGate = () => pushLog("차단기 닫기 요청");

  // ------------------------------
  // websocket 수신 로직
  // ------------------------------
  const WS_URL = `ws://${window.location.hostname}:5000`;

  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => pushLog("WS연결됨");
    ws.onclose = () => pushLog("WS 연결 종료");
    ws.onerror = () => pushLog("WS 에러");

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);


        //Logs/state는 원하면 반영
        if (msg.type === "log" && msg.payload?.msg) {
          setRecentLogs((prev) => [{ msg: msg.payload.msg, time: msg.payload.time || "" }, ...prev].slice(0, 10));
        }
        if (msg.type === "logs" && Array.isArray(msg.payload)) {
          setRecentLogs(msg.payload.slice(0, 10));
        }

        // 팝업은 wrong-way만, 토글 on일 때만
        if (msg.type === "alert") {
          const alert = msg.payload;

          //토글 off면 팝업 금지, 로그만
          if (!alertsEnabledRef.current) {
            if (alert?.subMessage) {
              setRecentLogs((prev) => [{ msg: `(Muted) ${alert.subMessage}`, time: alert.timestamp || "" }, ...prev].slice(0, 10));
            }
            return;
          }

          if (alert?.type === "wrong-way") {
            setActiveAlert(alert); // 여기서 팝업 뜸
          } else {
            // 다른 타입은 로그만
            if (alert?.subMessage) {
              setRecentLogs((prev) => [{ msg: alert.subMessage, time: alert.timestamp || "" }, ...prev].slice(0, 10));
            }
          }
        }
      } catch {
        // ignore
      }
    };

    return () => ws.close();
  }, []);

  // ------------------------------
  // stage별 스타일 함수 
  // ------------------------------
  const isCritical = Number(activeAlert?.stage) === 2;

  const alertTheme = isCritical
    ? {
      frame: "border-red-600",
      header: "bg-red-600",
      headerText: "text-white",
      subText: "text-red-100",
      badge: "bg-red-50 text-red-600 border-red-100",
      primaryBtn: "bg-red-600 hover:bg-red-700 text-white hover:shadow-red-500/30",
      secondaryBtn: "bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200",
      stripe:
        "bg-[linear-gradient(45deg,rgba(220,38,38,0.25)_25%,transparent_25%,transparent_50%,rgba(220,38,38,0.25)_50%,rgba(220,38,38,0.25)_75%,transparent_75%,transparent)]",
      title: "역주행 위험",
      priority: "우선순위: 최상",
      iconBox: "bg-white/20 border-white/30",
    }
    : {
      frame: "border-yellow-500",
      header: "bg-yellow-400",
      headerText: "text-gray-900",
      subText: "text-yellow-900",
      badge: "bg-yellow-50 text-yellow-700 border-yellow-200",
      primaryBtn: "bg-yellow-400 hover:bg-yellow-500 text-gray-900 hover:shadow-yellow-400/30",
      secondaryBtn: "bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200",
      stripe:
        "bg-[linear-gradient(45deg,rgba(234,179,8,0.22)_25%,transparent_25%,transparent_50%,rgba(234,179,8,0.22)_50%,rgba(234,179,8,0.22)_75%,transparent_75%,transparent)]",
      title: "역주행 감지",
      priority: "우선순위: 보통",
      iconBox: "bg-white/30 border-white/40",
    };


  // ------------------------------
  // 헬스체크
  // ------------------------------
  useEffect(() => {
    let timer;

    const ping = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
        setServerAlive(res.ok);
      } catch {
        setServerAlive(false);
      }
    };

    ping();
    timer = setInterval(ping, 3000); //3초마다
    return () => clearInterval(timer);
  }, []);

  // ------------------------------
  // CCTV 데이터 가져오기 및 HLS 연결
  // ------------------------------
  useEffect(() => {
    const fetchCctv = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/cctv`);
        const result = await r.json();
        if (result.ok && result.data?.response?.data?.length > 0) {
          // 가장 첫 번째 CCTV 정보를 가져옴
          const cctv = result.data.response.data[0];
          setCctvData(cctv);
        }
      } catch (e) {
        console.error("CCTV fetch error", e);
      }
    };
    fetchCctv();
  }, [API_BASE]);

  useEffect(() => {
    if (cctvData?.cctvurl && cctvVideoRef.current) {
      const video = cctvVideoRef.current;
      const hlsUrl = cctvData.cctvurl;

      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls();
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(e => console.log("Auto-play blocked:", e));
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
      }
    }
  }, [cctvData]);


  return (
    <div className="p-6 space-y-6 bg-white min-h-screen relative">
      {/* 실시간 알림 오버레이 */}
      {activeAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-in fade-in duration-200">
          <div className={`bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-300 relative border-2 ${alertTheme.frame}`}>
            {/* 헤더 */}
            <div className={`${alertTheme.header} p-6 flex items-center justify-between relative overflow-hidden`}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/10 to-black/10 opacity-100" />
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Siren className={`w-32 h-32 ${alertTheme.headerText} transform rotate-12`} />
              </div>

              <div className="relative z-10 flex items-center space-x-4">
                <div className={`p-3 backdrop-blur-md rounded-full shadow-inner ${alertTheme.iconBox}`}>
                  <Siren className={`w-8 h-8 ${alertTheme.headerText}`} />
                </div>
                <div>
                  <h2 className={`text-2xl font-black tracking-wider italic ${alertTheme.headerText}`}>
                    {alertTheme.title}
                  </h2>
                  <p className={`font-mono text-sm ${alertTheme.subText}`}>
                    {alertTheme.priority}
                  </p>
                </div>
              </div>

              <button
                onClick={handleDismissAlert}
                className={`relative z-10 transition-colors ${isCritical ? "text-white/70 hover:text-white" : "text-gray-700/70 hover:text-gray-900"}`}
                aria-label="닫기"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* 본문 */}
            <div className="p-8 text-center space-y-4">
              <div className={`inline-block px-4 py-1 rounded-full font-bold text-xs tracking-widest border mb-2 ${alertTheme.badge}`}>
                {activeAlert.timestamp} • 실시간 이벤트
              </div>

              <div>
                <h3 className="text-3xl font-black text-gray-900 mb-2 tracking-tight leading-none">
                  {isCritical ? "역주행 위험 단계" : "역주행 경고 단계"}
                </h3>
                <p className="text-lg text-gray-600 font-medium">{activeAlert.subMessage}</p>
              </div>

              <div className="w-full h-px bg-gray-100 my-4" />

              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={handleViewAlert}
                  className={`flex-1 py-4 font-black tracking-wider rounded-lg shadow-lg transition-all transform hover:-translate-y-0.5 flex items-center justify-center space-x-2 ${alertTheme.primaryBtn}`}
                >
                  <AlertTriangle className="w-5 h-5" />
                  <span>즉시 조치 화면 보기</span>
                </button>
                <button
                  onClick={handleDismissAlert}
                  className={`flex-1 py-4 font-bold tracking-wider rounded-lg border transition-colors ${alertTheme.secondaryBtn}`}
                >
                  닫기
                </button>
              </div>
            </div>

            {/* 하단 스트라이프 */}
            <div className={`h-2 w-full bg-[length:20px_20px] ${alertTheme.stripe}`} />
          </div>
        </div>
      )}

      {/* 상단 헤더 */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 font-mono tracking-tight">
            역주행 방지 실시간 관제 대시보드
          </h1>
          <div className="flex items-center space-x-2 mt-1">
            <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              현장-01
            </span>
            <span className="text-gray-300">•</span>
            <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              LIDAR-01
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* ✅ 서버 상태 점 */}
          <div className="flex items-center gap-2 bg-gray-100 border border-gray-300 rounded px-3 h-10">
            <span
              className={`w-2.5 h-2.5 rounded-full ${serverAlive ? "bg-green-500" : "bg-red-500"
                }`}
              title={serverAlive ? "SERVER OK" : "SERVER DOWN"}
            />
            <span className="font-mono text-xs text-gray-600">
              {serverAlive ? "SERVER" : "OFFLINE"}
            </span>
          </div>
          <button
            onClick={startDemo}
            className="h-10 px-4 rounded bg-gray-900 text-white text-xs font-bold hover:bg-gray-700"
          >
            DEMO START
          </button>
        </div>


      </div>

      {/* 시스템 알림 배너 + 토글 */}
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-red-100 rounded-full">
            <Siren className="w-5 h-5 text-red-600" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-red-800 tracking-wide">시스템 경보 활성</span>
            <span className="text-xs text-red-600">역주행 감지 모니터링 중</span>
          </div>
        </div>

        <button
          onClick={() => setAlertsEnabled((v) => !v)}
          className="flex items-center space-x-3 bg-white px-3 py-1.5 rounded border border-red-100 shadow-sm"
          aria-label="알림 토글"
        >
          <span className="text-xs font-bold text-gray-600">알림</span>
          <div
            className={`w-10 h-5 rounded-full relative transition-colors ${alertsEnabled ? "bg-red-500" : "bg-gray-300"
              }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${alertsEnabled ? "right-0.5" : "left-0.5"
                }`}
            />
          </div>
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="flex flex-col justify-between h-32 cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-colors group">
          <div className="flex justify-between items-start" onClick={() => goEvents("analytics")}
          >
            <div className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-blue-500" />
            </div>
            <MoreHorizontal className="text-gray-300 w-5 h-5 group-hover:text-blue-400" />
          </div>
          <div onClick={() => goEvents("analytics")}>
            <div className="font-mono text-sm font-bold text-gray-700 mb-1">오늘 이벤트</div>
            <div className="flex items-center space-x-2">
              <span className="text-2xl font-bold text-gray-900">3</span>
              <span className="text-xs text-green-600 bg-green-100 px-1 rounded">+1 신규</span>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between h-32 cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-colors group">
          <div className="flex justify-between items-start" onClick={() => goEvents("vehicles")}>
            <div className="w-8 h-8 rounded bg-gray-200 flex items-center justify-center">
              <Activity className="w-4 h-4 text-gray-600" />
            </div>
            <MoreHorizontal className="text-gray-300 w-5 h-5 group-hover:text-blue-400" />
          </div>
          <div onClick={() => goEvents("vehicles")}>
            <div className="font-mono text-sm font-bold text-gray-700 mb-1">통과 차량 수</div>
            <div className="flex items-center space-x-2">
              <span className="text-2xl font-bold text-gray-900">12,842</span>
              <div className="flex items-center text-xs text-green-600 bg-green-100 px-1 rounded">
                <ArrowUpRight className="w-3 h-3 mr-1" />
                <span>12%</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between h-32 cursor-pointer hover:bg-red-50 hover:border-red-400 transition-colors group">
          <div className="flex justify-between items-start" onClick={() => navigate("/dashboard/wrongway")}>
            <div className="w-8 h-8 rounded bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
            <MoreHorizontal className="text-gray-300 w-5 h-5 group-hover:text-red-400" />
          </div>
          <div onClick={() => navigate("/dashboard/wrongway")}>
            <div className="font-mono text-sm font-bold text-gray-700 mb-1">역주행 이벤트</div>
            <div className="flex items-center space-x-2">
              <span className="text-2xl font-bold text-gray-900">2</span>
              <div className="flex items-center text-xs text-red-600 bg-red-100 px-1 rounded">
                <span className="animate-pulse mr-1">●</span>
                <span>조치 필요</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between h-32 cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-colors group">
          <div className="flex justify-between items-start" onClick={() => goEvents("unidentified")}>
            <div className="w-8 h-8 rounded bg-gray-200 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-gray-600" />
            </div>
            <MoreHorizontal className="text-gray-300 w-5 h-5 group-hover:text-blue-400" />
          </div>
          <div onClick={() => goEvents("unidentified")}>
            <div className="font-mono text-sm font-bold text-gray-700 mb-1">미식별</div>
            <div className="flex items-center space-x-2">
              <span className="text-2xl font-bold text-gray-900">24</span>
              <div className="flex items-center text-xs text-red-600 bg-red-100 px-1 rounded">
                <ArrowDownRight className="w-3 h-3 mr-1" />
                <span>2%</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 메인 모니터링 */}
        <Card className="lg:col-span-2 h-[28rem]" title="실시간 모니터링">
          {/* <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full pb-8"> 맨처음*/}
          {/* <div className="bg-black rounded border border-gray-700 relative overflow-hidden h-[23rem]"> 라이다만 */}
          <div className="grid grid-cols-3 gap-4 h-[23rem]">
            {/* 카메라 영역 (1칸) */}
            <div className="bg-gray-200 rounded border border-gray-300 relative overflow-hidden flex items-center justify-center">

              <div className="absolute top-3 left-3 px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded flex items-center z-10">
                <span className="w-1.5 h-1.5 bg-white rounded-full mr-1.5 animate-pulse" />
                실시간 카메라
              </div>

              <img
                src={`http://${window.location.hostname}:5001/cctv_feed`}
                alt="CCTV Feed"
                className="w-full h-full object-cover"
                onError={(e) => { 
                  setTimeout(() => {
                    const baseUrl = e.target.src.split('?')[0];
                    e.target.src = `${baseUrl}?retry=${new Date().getTime()}`;
                  }, 3000); 
                }}
              />

              <div className="absolute bottom-2 left-2 text-[10px] text-gray-600 font-mono">
                CAM_01_ENTRANCE
              </div>
            </div>


            {/* 라이다 영역 (2칸) */}
            <div className="col-span-2 bg-black rounded border border-gray-700 relative overflow-hidden flex">

              <div className="absolute top-3 left-3 px-2 py-0.5 bg-blue-900/80 border border-blue-500/50 text-blue-200 text-[10px] font-bold rounded font-mono z-10">
                라이다 센서 (AI Track)
              </div>

              <img
                src={`http://${window.location.hostname}:5001/lidar_feed`}
                alt="LiDAR Feed"
                className="w-full h-full object-contain"
                onError={(e) => { 
                  e.target.style.display = 'none'; 
                  if(videoRef.current) videoRef.current.style.display = 'block'; 
                  setTimeout(() => {
                    const baseUrl = e.target.src.split('?')[0];
                    e.target.src = `${baseUrl}?retry=${new Date().getTime()}`;
                  }, 3000); 
                }}
                onLoad={(e) => { 
                  e.target.style.display = 'block'; 
                  if(videoRef.current) videoRef.current.style.display = 'none'; 
                }}
              />

              <video
                ref={videoRef}
                src="/demo.mp4"
                className="w-full h-full object-cover -rotate-12 scale-[1.42] -translate-y-3"
                style={{ display: 'none' }}
                muted
                playsInline
                preload="auto"
                onTimeUpdate={handleDemoTimeUpdate}
              />

              <div className="absolute bottom-2 right-2 text-[10px] font-mono text-green-500">
                포인트: 2,405 | 주기: 10Hz
              </div>

            </div>

          </div>
        </Card>

        {/* 우측 위젯 */}
        <Card className="h-[28rem] flex flex-col" title="제어 및 활동">
          <div className="flex-1 space-y-6">
            {/* 차단기 제어 */}
            <div>
              <div className="text-xs font-bold text-gray-400 mb-2 tracking-wider">차단기 제어</div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={openGate}
                  className="flex flex-col items-center justify-center p-3 border border-gray-200 rounded hover:bg-green-50 hover:border-green-300 transition-colors group bg-white"
                >
                  <ArrowUp className="w-5 h-5 text-gray-500 group-hover:text-green-600 mb-1" />
                  <span className="text-xs font-bold text-gray-700">열기</span>
                </button>
                <button
                  onClick={closeGate}
                  className="flex flex-col items-center justify-center p-3 border border-gray-200 rounded hover:bg-red-50 hover:border-red-300 transition-colors group bg-white"
                >
                  <ArrowDown className="w-5 h-5 text-gray-500 group-hover:text-red-600 mb-1" />
                  <span className="text-xs font-bold text-gray-700">닫기</span>
                </button>
              </div>
            </div>

            {/* 전광판 문구 */}
            <div>
              <div className="text-xs font-bold text-gray-400 mb-2 tracking-wider">전광판 문구</div>
              <div className="flex space-x-2 mb-2">
                <div className="flex-1 relative">
                  <Megaphone className="w-3 h-3 text-gray-400 absolute left-2 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="text"
                    value={vmsText}
                    onChange={(e) => setVmsText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendVms()}
                    placeholder="문구 입력..."
                    className="w-full bg-gray-50 border border-gray-200 rounded py-1.5 pl-7 pr-2 text-xs font-mono focus:outline-none focus:border-blue-400"
                  />
                </div>
                <button
                  onClick={sendVms}
                  className="bg-gray-800 text-white px-3 rounded text-xs font-bold hover:bg-gray-700 transition-colors"
                >
                  전송
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => quickVms("정지")}
                  className="px-2 py-1 bg-gray-100 text-gray-500 text-[10px] font-bold rounded hover:bg-gray-200 border border-gray-200"
                >
                  정지
                </button>
                <button
                  type="button"
                  onClick={() => quickVms("서행")}
                  className="px-2 py-1 bg-gray-100 text-gray-500 text-[10px] font-bold rounded hover:bg-gray-200 border border-gray-200"
                >
                  서행
                </button>
                <button
                  type="button"
                  onClick={() => quickVms("역주행 주의")}
                  className="px-2 py-1 bg-gray-100 text-gray-500 text-[10px] font-bold rounded hover:bg-gray-200 border border-gray-200"
                >
                  역주행 주의
                </button>
              </div>
            </div>

            {/* 최근 로그 */}
            <div>
              <div className="text-xs font-bold text-gray-400 mb-2 tracking-wider">최근 이벤트</div>
              <div className="space-y-2 bg-gray-50 p-2 rounded border border-gray-100 max-h-[117px] ">

                {recentLogs.slice(0, 4).map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs pb-1 border-b border-gray-200 border-dashed last:border-0 last:pb-0"
                  >
                    <span className="text-gray-600 truncate mr-2">{item.msg}</span>
                    <span className="text-gray-400 font-mono text-[10px]">{item.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

