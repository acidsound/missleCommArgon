# AEGIS DOME // 3D Missile Command

[![Live Demo](https://img.shields.io/badge/Demo-Play%20Online-00ffcc?style=for-the-badge&logo=googlechrome&logoColor=black)](https://acidsound.github.io/missleCommArgon/)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github)](https://github.com/acidsound/missleCommArgon)
[![Three.js](https://img.shields.io/badge/Three.js-r180-black?style=for-the-badge&logo=threedotjs)](https://threejs.org/)
[![WebXR](https://img.shields.io/badge/WebXR-VR%20%2F%20AR%20Ready-ff0077?style=for-the-badge&logo=webxr)](https://immersiveweb.dev/)

> **AEGIS DOME**은 클래식 아케이드 명작 *Missile Command*를 현대적인 3D 사이버-벡터(Cyber-Vector) 스타일과 몰입형 WebXR(VR/AR) 지원으로 재해석한 전략 방공 시뮬레이션 웹 게임입니다.

---

## 🎮 라이브 플레이 (Live Demo)

별도의 설치나 빌드 과정 없이 웹 브라우저에서 바로 실행할 수 있습니다:

🔗 **[https://acidsound.github.io/missleCommArgon/](https://acidsound.github.io/missleCommArgon/)**

> **권장 환경:** Chrome, Edge 등 WebGL/WebXR을 지원하는 모던 브라우저 (데스크톱, 모바일, Meta Quest 등의 VR/AR 헤드셋 지원)

---

## ✨ 주요 특징 (Key Features)

### 1. 3D 전략 방공 시뮬레이션
- **예측 요격 시스템:** 탄도 미사일의 궤적 및 도달 지점을 계산하여 인터셉터 요격 미사일 발사.
- **플라즈마 폭발 구체 연쇄 반응:** 폭발 반경(AoE) 내 다수의 미적 탄두를 동시에 격추하는 체인 리액션 메커니즘.
- **다양한 적 위협:**
  - `ICBM`: 고속 하강 대륙간 탄도 미사일
  - `MIRV`: 비행 도중 다탄두로 분열하는 다탄두 재돌입체
  - `SMART`: 방공망과 요격탄을 회피 기동하는 유도 미사일
  - `Orbital Bomber`: 상공을 횡단하며 연속 폭격을 투하하는 전략 폭격기

### 2. 기지 및 방공 포대 관리
- **6개 바이오-돔 도시 (Cities):** 방어 대상 기지 보호.
- **3개 방공 미사일 포대 (ALPHA, BRAVO, CHARLIE):**
  - 각 포대별 독립 탄약 수량 관리 및 장전 상태 확인
  - 목표 지점과의 거리에 따른 최적 포대 자동/수동 선택

### 3. 몰입형 WebXR 지원 (VR & AR)
- **VR (`immersive-vr`) & AR (`immersive-ar` Passthrough):** Meta Quest 등 6DoF XR 헤드셋 완벽 지원.
- **XR 컨트롤러 레이저 포인팅 & 햅틱 진동 피드백.**
- **3가지 스케일 모드 지원:**
  - `TABLETOP`: 탁상형 디오라마 모드
  - `COMMANDER`: 지휘관 시점 모드
  - `CITADEL`: 실물 스케일 거대 요새 모드
- **3D 홀로그래픽 커맨드 콘솔:** 가상 공간 내 입체 인터랙티브 컨트롤 패널.

### 4. 사운드 & 비주얼
- **순수 절차적 Web Audio API 합성:** 외부 음원 파일 의존 없이 실시간 합성음(사이렌, 미사일 추진음, 레이저, 플라즈마 폭발음) 생성.
- **레트로-퓨처리즘 NORAD 텍티컬 HUD:** 그린/시안 벡터 와이어프레임 UI, 전술 레이더 미니맵.

---

## 🕹️ 조작법 (Controls)

### 데스크톱 (PC)
| 키 / 입력 | 동작 |
| :--- | :--- |
| **마우스 좌클릭** | 목표 지점 조준 및 최적 포대 자동 요격 발사 |
| **A / S / D** | ALPHA / BRAVO / CHARLIE 포대 지정 발사 |
| **숫자 1 ~ 4** | 전술 카메라 뷰 전환 (OVERVIEW, TACTICAL, ALPHA TURRET, CINEMATIC) |
| **우클릭 드래그** | 자유 시점 궤도 회전 (Orbit View) |
| **마우스 휠** | 줌 인 / 줌 아웃 |
| **P / ESC** | 일시정지 (PAUSE) |

### 모바일 & 태블릿
- **화면 탭:** 요격 지점 타격 및 미사일 발사
- **핀치 투 줌 / 터치 드래그:** 카메라 시점 조작

### WebXR (VR / AR)
- **컨트롤러 트리거(Trigger):** 조준 빔을 이용한 요격 지점 지정 발사
- **그립(Grip) / 메뉴(Menu):** XR 스케일 모드 변경 및 콘솔 상호작용

---

## 🛠️ 기술 스택 (Tech Stack)

- **Engine & Graphics:** [Three.js](https://threejs.org/) (r180) WebGL
- **Audio:** Web Audio API (Procedural Synthesizer)
- **XR:** WebXR Device API
- **Deployment:** GitHub Pages & GitHub Actions

---

## 📂 프로젝트 구조 (Project Structure)

```text
missleCommArgon/
├── index.html              # 메인 엔트리 및 NORAD 전술 HUD
├── css/
│   └── style.css           # 전술 인터페이스 및 반응형 스타일
├── js/
│   ├── main.js             # 게임 루프, 웨이브 관리자, 타겟팅 시스템
│   ├── world.js            # 방어 기지(City, Battery), 지형 및 레이더 스윕
│   ├── entities.js         # 미사일(ICBM, MIRV, SMART), 폭격기, 플라즈마 파티클
│   ├── xr.js               # WebXR (VR/AR) 컨트롤러 및 홀로그래픽 콘솔
│   └── audio.js            # 절차적 Web Audio API 사운드 합성기
├── vendor/three/           # Three.js r180 코어 및 애드온
└── .agent/
    └── PROJECT_CONTEXT.md  # 프로젝트 아키텍처 및 상세 명세
```

---

## 📄 라이선스 (License)

This project is open-source. Three.js is licensed under the [MIT License](vendor/three/LICENSE).
