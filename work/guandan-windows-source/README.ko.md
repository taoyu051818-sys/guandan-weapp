# Guandan Master

**언어**

- 한국어(현재): `README.ko.md`
- 简体中文: [README.md](./README.md)
- English: [README.en.md](./README.en.md)
- Русский: [README.ru.md](./README.ru.md)
- 日本語: [README.ja.md](./README.ja.md)

Guandan Master는 로컬 플레이 중심이며 LAN 멀티플레이를 지원하는 관단(Guandan) 카드 게임 프로젝트입니다.

## 주요 기능

- 배포, 출패, 패스, 선공 리셋, 정산, 레벨 진행, 공물/반공물(tribute/return tribute) 전체 흐름 지원.
- A 레벨 도전 규칙(성공/실패, 연속 실패 강등) 구현.
- `easy / medium / hard / master` 4단계 AI 제공.
- Electron 기반 Windows 데스크톱 빌드 지원.

## 게임 개요

- 4인 2팀(파트너는 맞은편).
- 같은 유형의 더 강한 패로 응수합니다.
- 나머지 3명이 패스하면 마지막 유효 출패자가 다음 라운드 선공을 가집니다.
- 핵심 목표는 `A` 도달 후 A 관문을 통과하는 것입니다.

## AI 전략

- `easy`: 규칙 준수 중심의 기본 플레이.
- `medium`: 팀 연계 + 저효율 폭탄 사용 억제.
- `hard`: 1~2수 전술 예측 강화.
- `master`: 종반 탐색 및 상대 모델 기반 의사결정.

## 빠른 시작

```bash
npm install
npm run dev
```

LAN 서버(선택):

```bash
node server/index.js
```

## 라이선스

이 프로젝트는 [Apache-2.0](./LICENSE) 라이선스를 사용합니다.
