# MusePilot 공개 배포 메모

## 현재 공개 위치

- GitHub 저장소: https://github.com/samadi81/volumio-ai-autopilot
- 작업 브랜치: https://github.com/samadi81/volumio-ai-autopilot/tree/claude/gemini-llm-issues-2ATXy
- 피드백/버그 제보: https://github.com/samadi81/volumio-ai-autopilot/issues/new/choose

## 설치 안내

Qobuz 로컬 캐시 기능은 아직 작업 브랜치에 있습니다. `main`에 병합하기 전에는 아래처럼 브랜치를 직접 받아 설치합니다.

```sh
git clone -b claude/gemini-llm-issues-2ATXy https://github.com/samadi81/volumio-ai-autopilot.git
cd volumio-ai-autopilot
rsync -avz --exclude node_modules ./ volumio@<volumio-ip>:/home/volumio/ai_autopilot/
ssh -t volumio@<volumio-ip> "cd /home/volumio/ai_autopilot && volumio plugin install"
```

## LLM API 키 안내

MusePilot에는 제작자의 LLM API 키가 포함되어 있지 않습니다. 사용자는 본인이 선택한 공급자에서 직접 API 키를 발급받아 입력해야 합니다.

- OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, xAI, Mistral, OpenRouter, Perplexity, Together AI: 사용자 본인 키 필요
- Ollama: API 키 없이 사용 가능, 대신 Ollama 서버 주소 필요

키는 Volumio 기기의 플러그인 설정에 저장되고, 선택한 공급자 요청에만 사용됩니다.

## Volumio 플러그인 스토어

Volumio 스토어 등록은 GitHub에 코드를 올리는 것만으로 끝나지 않습니다. Volumio 공식 절차상 다음이 필요합니다.

1. Volumio 제출 체크리스트 통과
2. plugin-sources 저장소 fork에 코드 커밋/푸시
3. MyVolumio 로그인 상태의 Volumio 기기에서 `volumio plugin submit`
4. Volumio 팀 검수
5. 베타 채널 등록 후 안정화되면 stable 채널 승격

공식 문서:

- https://developers.volumio.com/plugins/plugin-publishing
- https://developers.volumio.com/plugins/submission-checklist
- https://github.com/volumio/volumio-plugins-sources-bookworm

## 피드백 자동 반영 방향

완전 자동 병합은 위험하므로 권장하지 않습니다. 대신 아래 흐름으로 운영합니다.

1. 플러그인 설정/리모컨/GitHub에서 피드백을 GitHub Issues로 모음
2. 이슈 라벨링과 재현 절차 정리
3. 테스트 또는 수동 검증 항목 추가
4. 수정 브랜치와 PR 생성
5. 테스트와 Volumio 기기 검증
6. 검토 후 릴리스/스토어 재제출

이렇게 하면 피드백을 자동으로 모으고 업데이트 후보로 만들 수 있지만, 사용자 기기에 배포되는 코드는 사람이 검토한 것만 나갑니다.
