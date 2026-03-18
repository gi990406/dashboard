import cv2
import requests
import numpy as np
import threading
import time
from ultralytics import YOLO
from collections import defaultdict

# 1. 로컬 대시보드 백엔드 API 호출을 통해 CCTV URL 가져오기
api_url = "http://localhost:5000/api/cctv"
print(f"로컬 대시보드 API({api_url})를 호출하는 중...")

try:
    response = requests.get(api_url)
    data = response.json()
    
    if data.get("ok") and data.get("data", {}).get("response", {}).get("data"):
        cctv_data = data["data"]["response"]["data"]
        # 결과가 1개일 때는 배열(list)이 아니라 딕셔너리(dict)로 반환될 수 있음
        if isinstance(cctv_data, list) and len(cctv_data) > 0:
            cctv_url = cctv_data[0]["cctvurl"]
        elif isinstance(cctv_data, dict):
            cctv_url = cctv_data.get("cctvurl")
        else:
            raise ValueError("CCTV 데이터 형식이 올바르지 않습니다.")
    else:
        print("API 응답에서 CCTV URL을 찾을 수 없습니다. (config.json의 API 키를 확인해주세요)")
        exit(1)
except Exception as e:
    print(f"API 호출 실패: {e}")
    exit(1)

class ThreadedCamera:
    def __init__(self, src):
        self.cap = cv2.VideoCapture(src)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.ret, self.frame = self.cap.read()
        self.running = True
        self.thread = threading.Thread(target=self.update, args=())
        self.thread.daemon = True
        self.thread.start()

    def update(self):
        while self.running:
            if self.cap.isOpened():
                self.ret, self.frame = self.cap.read()
            time.sleep(0.01)

    def read(self):
        return self.ret, self.frame
        
    def isOpened(self):
        return self.cap.isOpened()

    def release(self):
        self.running = False
        self.thread.join(timeout=1.0)
        self.cap.release()

print(f"선택된 CCTV Streaming URL: {cctv_url}")
print("YOLO 모델(추적 상향 버전)을 로드하는 중...")

# 2. YOLOv8 Small 모델 로드 (인식률 우선)
model = YOLO('yolov8s.pt') 

# 3. 비디오 스트림 캡처 시작
cap = ThreadedCamera(cctv_url)

# 궤적(Trajectory) 저장용 딕셔너리
track_history = defaultdict(lambda: [])

def draw_perspective_grid(img, width, height):
    # 라이다 센서풍 바닥 그리드 그리기
    color = (40, 40, 40) # 어두운 회색 선
    thickness = 1
    # 소실점을 상단 중앙에 설정
    vp_x, vp_y = width // 2, int(height * 0.2)
    
    # 방사형 선 그리기
    for x in range(-width * 3, width * 4, 80):
        cv2.line(img, (vp_x, vp_y), (x, height), color, thickness)
        
    # 가로 선 그리기 (원근감에 따라 간격 증가)
    y = vp_y + 10
    gap = 2
    while y < height:
        cv2.line(img, (0, int(y)), (width, int(y)), color, thickness)
        y += gap
        gap *= 1.25

print("영상을 재생합니다. 종료하려면 'q' 키를 누르세요.")

# 정적 배경(도로, 건물 등) 추출을 위한 배경 차분기 생성
bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=25, detectShadows=False)

while True:
    if cap is None:
        cctv_url = get_cctv_url() if 'get_cctv_url' in globals() else cctv_url
        if not cctv_url:
            cv2.waitKey(2000)
            continue
        cap = ThreadedCamera(cctv_url)
        
    ret, frame = cap.read()
    
    # 기본 라이다 뷰 캔버스 (검은 배경)
    lidar_view = np.zeros((480, 640, 3), dtype=np.uint8)
    
    if not ret or frame is None: 
        print("CCTV 스트림 일시 끊김 또는 준비 중...")
        cap.release()
        cap = None
        cv2.putText(lidar_view, "RECONNECTING CCTV...", (150, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
        combined_view = np.hstack((np.zeros((480, 640, 3), dtype=np.uint8), lidar_view))
        cv2.imshow("CCTV View | LiDAR-style View (Press 'q' to Quit)", combined_view)
        time.sleep(0.5)
        if cv2.waitKey(2000) & 0xFF == ord('q'):
            break
        continue

    # 디스플레이 크기 조정 (너무 크면 화면 밖으로 나감)
    frame = cv2.resize(frame, (640, 480))
    
    # 도로 및 정적 배경 구성을 위한 배경 모델링 학습
    bg_subtractor.apply(frame)
    bg_img = bg_subtractor.getBackgroundImage()

    # 1. 바닥 3D 원근 그리드 그리기
    draw_perspective_grid(lidar_view, 640, 480)
    
    # 2. 추출된 배경 이미지가 있으면 엣지를 찾아 라이다 지형처럼 은은하게 표시
    if bg_img is not None:
        gray_bg = cv2.cvtColor(bg_img, cv2.COLOR_BGR2GRAY)
        # Canny 엣지 추출
        edges = cv2.Canny(gray_bg, 30, 100)
        # 녹색(어두운)으로 지형 윤곽 매핑 (포인트 클라우드 환경 매핑 느낌)
        lidar_view[edges > 0] = (0, 60, 0)

    # 3. 객체 감지 진행 (Small 모델 상향, conf를 0.1까지 극단적으로 낮춰서 최대한 모든 차량을 캐치)
    results = model.track(frame, persist=True, classes=[2, 3, 5, 7], tracker="bytetrack.yaml", conf=0.1, imgsz=640, verbose=False)

    # 추적된 객체가 있는 경우 시각화 처리
    if results[0].boxes.id is not None:
        boxes = results[0].boxes.xywh.cpu()
        track_ids = results[0].boxes.id.int().cpu().tolist()

        for box, track_id in zip(boxes, track_ids):
            x, y, w, h = box
            center = (int(x), int(y))
            
            # 궤적 길이 유지 (최대 30프레임)
            track = track_history[track_id]
            track.append(center)
            if len(track) > 30: 
                track.pop(0)

            # --- 원본 영상에 바운딩 박스 시각화 ---
            cv2.rectangle(frame, (int(x-w/2), int(y-h/2)), (int(x+w/2), int(y+h/2)), (0, 255, 0), 2)
            cv2.putText(frame, f"ID:{track_id}", (int(x-w/2), int(y-h/2)-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,0), 2)

            # --- 라이다(센서)풍 시각화 ---
            # 1. 점(객체 중심) 표시
            cv2.circle(lidar_view, center, 4, (0, 0, 255), -1)
            
            # 2. 크로스 마커 표시
            cv2.drawMarker(lidar_view, center, (0, 255, 255), markerType=cv2.MARKER_CROSS, markerSize=15, thickness=2)
            
            # 3. 객체 고유 트래킹 ID
            cv2.putText(lidar_view, f"#{track_id}", (center[0]+10, center[1]-10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
            
            # 4. 객체 이동 궤적 선(Polyline) 그리기
            points = np.hstack(track).astype(np.int32).reshape((-1, 1, 2))
            cv2.polylines(lidar_view, [points], isClosed=False, color=(255, 0, 0), thickness=2)

    # 원본 CCTV와 라이다 뷰를 좌우로 이어붙이기
    combined_view = np.hstack((frame, lidar_view))
    
    cv2.imshow("CCTV View | LiDAR-style View (Press 'q' to Quit)", combined_view)

    # 'q' 입력 시 종료
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

if cap is not None:
    cap.release()
cv2.destroyAllWindows()
