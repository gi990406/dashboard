import cv2
import requests
import numpy as np
import threading
import time
from ultralytics import YOLO
from collections import defaultdict
from flask import Flask, Response
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

print("YOLO 모델(초고속 추적 최적화 버전)을 로드하는 중...")
model = YOLO('yolov8n.pt') 

latest_cctv_jpg = None
latest_lidar_jpg = None

def get_cctv_url():
    api_url = "http://localhost:5000/api/cctv"
    try:
        response = requests.get(api_url, timeout=5)
        data = response.json()
        if data.get("ok") and data.get("data", {}).get("response", {}).get("data"):
            cctv_data = data["data"]["response"]["data"]
            if isinstance(cctv_data, list) and len(cctv_data) > 0:
                return cctv_data[0]["cctvurl"]
            elif isinstance(cctv_data, dict):
                return cctv_data.get("cctvurl")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"API 호출 실패: {e}")
    return None

class ThreadedCamera:
    def __init__(self, src):
        self.src = src
        self.cap = None
        self.ret = False
        self.frame = None
        self.running = True
        self.connecting = True
        self.thread = threading.Thread(target=self.update, args=())
        self.thread.daemon = True
        self.thread.start()

    def update(self):
        self.cap = cv2.VideoCapture(self.src)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        
        # 첫 번째 프레임을 완전히 읽어올 때까지 connecting 상태 유지
        while self.running and self.connecting:
            if self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret and frame is not None:
                    self.ret = ret
                    self.frame = frame
                    self.connecting = False
                    break
            time.sleep(0.1)
            
        while self.running:
            if self.cap.isOpened():
                self.ret, self.frame = self.cap.read()
            else:
                self.ret = False
                self.frame = None
            time.sleep(0.01)

    def read(self):
        return self.ret, self.frame

    def release(self):
        self.running = False
        self.thread.join(timeout=1.0)
        if self.cap is not None:
            self.cap.release()

def draw_perspective_grid(img, width, height):
    color = (40, 40, 40)
    thickness = 1
    vp_x, vp_y = width // 2, int(height * 0.2)
    for x in range(-width * 3, width * 4, 80):
        cv2.line(img, (vp_x, vp_y), (x, height), color, thickness)
    y = vp_y + 10
    gap = 2
    while y < height:
        cv2.line(img, (0, int(y)), (width, int(y)), color, thickness)
        y += gap
        gap *= 1.25

def processing_thread():
    global latest_cctv_jpg, latest_lidar_jpg
    track_history = defaultdict(lambda: [])
    cap = None
    bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=25, detectShadows=False)
    
    while True:
        if cap is None:
            cctv_url = get_cctv_url()
            if not cctv_url:
                time.sleep(2)
                continue
            cap = ThreadedCamera(cctv_url)
            
        ret, frame = cap.read()
        lidar_view = np.zeros((480, 640, 3), dtype=np.uint8)
        
        if cap.connecting:
            cv2.putText(lidar_view, "INITIALIZING STREAM (WAIT 10-30s)...", (80, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            cctv_view = lidar_view.copy()
            time.sleep(0.5)
        elif not ret or frame is None: 
            cap.release()
            cap = None
            cv2.putText(lidar_view, "RECONNECTING CCTV...", (150, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            cctv_view = lidar_view.copy()
            time.sleep(0.5)
        else:
            frame = cv2.resize(frame, (640, 480))
            cctv_view = frame.copy()
            
            bg_subtractor.apply(frame)
            bg_img = bg_subtractor.getBackgroundImage()
            draw_perspective_grid(lidar_view, 640, 480)
            
            if bg_img is not None:
                gray_bg = cv2.cvtColor(bg_img, cv2.COLOR_BGR2GRAY)
                edges = cv2.Canny(gray_bg, 30, 100)
                lidar_view[edges > 0] = (0, 60, 0)
                
            # 해상도를 320까지 극한으로 낮춰서 초당 프레임(FPS)을 최대한 확보하여 고속 차량도 놓치지 않게 함
            # IoU 기반 추적기(ByteTrack)는 프레임이 끊기면 고속 객체 ID를 유지하지 못하므로 속도가 생명임
            results = model.track(frame, persist=True, classes=[2, 3, 5, 7], tracker="bytetrack.yaml", conf=0.1, imgsz=320, verbose=False)

            if results[0].boxes.id is not None:
                boxes = results[0].boxes.xywh.cpu()
                track_ids = results[0].boxes.id.int().cpu().tolist()

                for box, track_id in zip(boxes, track_ids):
                    x, y, w, h = box
                    center = (int(x), int(y))
                    
                    track = track_history[track_id]
                    track.append(center)
                    if len(track) > 30: 
                        track.pop(0)

                    # CCTV 화면 바운딩 박스
                    cv2.rectangle(cctv_view, (int(x-w/2), int(y-h/2)), (int(x+w/2), int(y+h/2)), (0, 255, 0), 2)
                    cv2.putText(cctv_view, f"ID:{track_id}", (int(x-w/2), int(y-h/2)-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,0), 2)

                    # 라이다 객체 점묘
                    cv2.circle(lidar_view, center, 4, (0, 0, 255), -1)
                    cv2.drawMarker(lidar_view, center, (0, 255, 255), markerType=cv2.MARKER_CROSS, markerSize=15, thickness=2)
                    cv2.putText(lidar_view, f"#{track_id}", (center[0]+10, center[1]-10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
                    
                    points = np.hstack(track).astype(np.int32).reshape((-1, 1, 2))
                    cv2.polylines(lidar_view, [points], isClosed=False, color=(255, 0, 0), thickness=2)

        ret1, buf1 = cv2.imencode('.jpg', cctv_view)
        ret2, buf2 = cv2.imencode('.jpg', lidar_view)
        
        if ret1 and ret2:
            latest_cctv_jpg = buf1.tobytes()
            latest_lidar_jpg = buf2.tobytes()

threading.Thread(target=processing_thread, daemon=True).start()

def stream_gen(stream_type):
    global latest_cctv_jpg, latest_lidar_jpg
    
    # 초기 로딩 화면
    loading_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(loading_frame, f"LOADING {stream_type.upper()} SENSOR...", (120, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
    ret, buffer = cv2.imencode('.jpg', loading_frame)
    if ret:
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        
    while True:
        jpg = latest_cctv_jpg if stream_type == "cctv" else latest_lidar_jpg
        if jpg is None:
            time.sleep(0.1)
            continue
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpg + b'\r\n')
        time.sleep(0.03) # 약 30fps 제한

@app.route('/cctv_feed')
def cctv_feed():
    return Response(stream_gen("cctv"), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/lidar_feed')
def lidar_feed():
    return Response(stream_gen("lidar"), mimetype='multipart/x-mixed-replace; boundary=frame')

if __name__ == '__main__':
    print("통합 듀얼 스트리밍 서버가 포트 5001에서 시작되었습니다.")
    app.run(host='0.0.0.0', port=5001, threaded=True)
