# MusePilot for Volumio 한국어 사용 설명서

MusePilot은 Volumio에서 최근 재생 기록과 좋아요/싫어요 피드백을 바탕으로 다음 곡을 자동으로 골라 큐에 넣는 플러그인입니다. TIDAL, Qobuz, 로컬 MPD 라이브러리를 음악 소스로 사용할 수 있습니다.

## 꼭 알아야 할 점: LLM API 키

MusePilot 배포판에는 제작자의 LLM API 키가 들어 있지 않습니다. 각 사용자가 직접 키를 발급받아 입력해야 합니다.

- Anthropic, OpenAI, Google Gemini, Groq, DeepSeek, xAI, Mistral, OpenRouter, Perplexity, Together AI 중 하나를 고른 경우: 해당 서비스에서 본인 API 키를 발급받아 MusePilot 설정에 붙여넣으세요.
- Ollama를 쓰는 경우: API 키는 비워두고, Ollama가 실행 중인 주소를 Base URL로 넣으세요. 예: `http://127.0.0.1:11434/v1` 또는 `http://192.168.1.50:11434/v1`
- 입력한 키는 Volumio 기기의 플러그인 설정에 로컬 저장됩니다.
- 키는 사용자가 선택한 LLM 공급자에게 요청을 보낼 때만 사용됩니다.
- 과금, 사용량 제한, 모델 제공 여부는 각 LLM 공급자 정책을 따릅니다.

## 빠른 시작

1. Volumio에 MusePilot을 설치하고 플러그인을 켭니다.
2. 플러그인 설정의 `추천기` 섹션으로 갑니다.
3. LLM 공급자를 선택합니다.
4. `키 받기` 버튼으로 공급자 사이트를 열고 본인 API 키를 만듭니다.
5. API 키 칸에 본인 키를 붙여넣습니다. Ollama는 비워둡니다.
6. 모델은 잘 모르겠으면 기본값으로 둡니다.
7. 프롬프트 프리셋과 취향 힌트를 고르고 저장합니다.
8. `일반` 섹션에서 트리거 모드를 `N곡 미리 채우기`로 두고, 예를 들어 3곡으로 설정합니다.
9. Qobuz/TIDAL/로컬 라이브러리에서 몇 곡을 재생해 기록을 쌓으면 MusePilot이 다음 곡을 추천하기 시작합니다.

## 리모컨 패널

브라우저에서 아래 주소를 열면 MusePilot 리모컨을 사용할 수 있습니다.

```text
http://<volumio-ip>:8488/
```

여기서 할 수 있는 일:

- 현재 재생 곡 확인
- 큐 확인과 큐 항목 재생
- 좋아요/싫어요 피드백
- AI 추천 즉시 실행
- Qobuz 곡 로컬 저장과 로컬 파일 재생
- LLM 공급자, 모델, 프롬프트, 힌트, 에너지 범위 빠른 수정

iPhone에서는 Safari로 열고 `공유 > 홈 화면에 추가`를 누르면 앱처럼 쓸 수 있습니다.

## Qobuz 로컬 캐시

Qobuz 곡을 로컬 파일로 저장하면 네트워크 상태와 상관없이 MPD 로컬 파일로 재생할 수 있습니다.

- `저장`: Qobuz 큐의 곡을 로컬 파일로 다운로드
- `저장▶`: 다운로드 후 로컬 파일로 재생
- `파일▶`: 이미 받은 파일을 재생

Qobuz 다운로드 토큰은 사용자가 직접 입력해야 합니다. 한국처럼 Qobuz 웹 로그인이 막히는 지역에서는 VPN으로 웹 로그인하거나, 사용자가 직접 `local user` JSON을 복사해 `Qobuz local user JSON 붙여넣기` 칸에 넣을 수 있습니다.

## 피드백

- 좋아요/싫어요는 다음 추천 프롬프트에 반영됩니다.
- 설정에서 켜면 곡을 일찍 스킵한 경우 자동 싫어요로 기록할 수 있습니다.
- 피드백과 히스토리는 Volumio 기기 안에 저장됩니다.

## 버그 제보 / 기능 요청

GitHub Issues에 남겨주세요.

```text
https://github.com/samadi81/volumio-ai-autopilot/issues/new/choose
```

플러그인 설정 화면과 리모컨 패널에도 같은 링크가 들어 있습니다.

제보할 때는 아래를 적어주면 도움이 됩니다.

- Volumio 버전
- 기기 모델과 아키텍처
- MusePilot 버전 또는 Git 커밋
- 사용하는 음원 소스
- 재현 순서
- 기대한 동작과 실제 동작
- 민감정보를 지운 로그

절대 올리면 안 되는 것:

- LLM API 키
- Qobuz 비밀번호
- Qobuz 토큰
- 브라우저 쿠키 또는 Local Storage 원문
- signed stream URL

## 개인정보

- MusePilot은 별도 서버로 telemetry를 보내지 않습니다.
- 히스토리와 피드백은 Volumio 기기에 저장됩니다.
- LLM 추천을 사용할 때는 최근 히스토리와 피드백 일부가 선택한 LLM 공급자에게 프롬프트로 전송됩니다.
- 로컬 처리를 원하면 Ollama를 사용하세요.
